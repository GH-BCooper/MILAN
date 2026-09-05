/**
 * The daily anchor.
 *
 * Once a day the head of the chain is hashed into an `ANCHOR` entry. That single
 * hash commits to every entry before it, so publishing it — to OpenTimestamps,
 * to a newspaper, to a tweet — timestamps the entire history at once. This is
 * the whole of what a blockchain would have bought us, at zero cost and zero
 * latency, and it is why "no blockchain" is a line on the slide rather than an
 * omission.
 *
 * The timestamping provider sits behind an interface with a local no-op
 * implementation (invariant 8). `OPENTIMESTAMPS_ENABLED=true` swaps it for the
 * real calendar server; unset, the anchor is still written and still commits to
 * the chain — it simply has no third-party receipt, and the /ledger page says
 * exactly that rather than implying one.
 */
import "server-only";

import { db } from "@/lib/db";
import { clockNow } from "@/lib/clock";
import { appendEntry, chainHead } from "./append";
import { sha256Hex } from "./hash";

export interface TimestampReceipt {
  provider: string;
  status: "anchored" | "pending" | "unavailable";
  detail: string;
  receipt?: string;
}

export interface TimestampProvider {
  readonly name: string;
  stamp(digestHex: string): Promise<TimestampReceipt>;
}

/** The default. Honest about being local: it claims nothing it cannot prove. */
export const localProvider: TimestampProvider = {
  name: "local",
  async stamp(digestHex) {
    return {
      provider: "local",
      status: "unavailable",
      detail:
        "No third-party timestamp. The anchor commits to every prior entry; only its publication date is unattested. " +
        "Set OPENTIMESTAMPS_ENABLED=true to submit it to a Bitcoin calendar server.",
      receipt: digestHex,
    };
  },
};

/** OpenTimestamps, submitted to a public calendar server. Off unless asked for. */
export const openTimestampsProvider: TimestampProvider = {
  name: "opentimestamps",
  async stamp(digestHex) {
    const digest = Buffer.from(digestHex, "hex");
    const res = await fetch("https://a.pool.opentimestamps.org/digest", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: digest,
    });
    if (!res.ok) throw new Error(`opentimestamps HTTP ${res.status}`);
    const receipt = Buffer.from(await res.arrayBuffer()).toString("base64");
    return {
      provider: "opentimestamps",
      status: "pending",
      detail: "Submitted to an OpenTimestamps calendar server. Bitcoin confirmation follows within a few hours.",
      receipt,
    };
  },
};

export function timestampProvider(): TimestampProvider {
  return process.env.OPENTIMESTAMPS_ENABLED === "true" ? openTimestampsProvider : localProvider;
}

export interface AnchorResult {
  anchoredSeq: number;
  headHash: string | null;
  anchorHash: string;
  entries: number;
  receipt: TimestampReceipt;
}

export async function anchorLedger(): Promise<AnchorResult> {
  const head = await chainHead();
  const at = clockNow();
  const digest = sha256Hex(`${head.entryHash ?? ""}:${head.seq}`);

  let receipt: TimestampReceipt;
  try {
    receipt = await timestampProvider().stamp(digest);
  } catch (e) {
    // Invariant 8: a third-party failure degrades to the local provider rather
    // than costing us the anchor.
    receipt = {
      provider: timestampProvider().name,
      status: "unavailable",
      detail: `Timestamp submission failed (${(e as Error).message}). The anchor entry was still written.`,
      receipt: digest,
    };
  }

  const payload = {
    event: "ANCHOR",
    anchoredSeq: head.seq,
    headHash: head.entryHash,
    entries: head.count,
    digest,
    at: at.toISOString(),
    receipt,
  };

  const entry = await db.transaction((tx) =>
    appendEntry(tx, { kind: "ANCHOR", payload, at, authorId: null }),
  );

  return { anchoredSeq: head.seq, headHash: head.entryHash, anchorHash: entry.entryHash, entries: head.count, receipt };
}

/** The most recent anchor, for the prior-art panel and /ledger. */
export async function latestAnchor(): Promise<{ seq: number; at: Date; payload: Record<string, unknown> } | null> {
  const { sql } = await import("drizzle-orm");
  const rows = (await db.execute<{ seq: number; created_at: string; payload: Record<string, unknown> }>(
    sql`SELECT seq, created_at, payload FROM ledger_entries WHERE kind = 'ANCHOR' ORDER BY seq DESC LIMIT 1`,
  )) as unknown as Array<{ seq: number; created_at: string; payload: Record<string, unknown> }>;
  if (rows.length === 0) return null;
  return { seq: Number(rows[0].seq), at: new Date(rows[0].created_at.replace(" ", "T").replace(/\+00$/, "Z")), payload: rows[0].payload };
}
