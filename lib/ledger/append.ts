/**
 * Appending to the chain.
 *
 * Two rules, both of which exist because getting them wrong is silent:
 *
 *  1. This runs inside the CALLER's transaction. A state change, its ledger
 *     entry, its deadlines and its outbox event are one atomic fact; opening a
 *     second connection here would let the ledger commit while the state change
 *     rolled back, and the ledger cannot be corrected afterwards — it is
 *     append-only by database rule.
 *  2. It takes a Postgres advisory lock first. `seq` is a bigserial, so two
 *     concurrent appends get distinct sequence numbers, but without the lock
 *     both could read the same tip and write the same `prev_hash`, forking the
 *     chain. The lock is transaction-scoped and released at commit.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import type { Tx } from "@/lib/db";
import { ledgerEntries, type LedgerKind } from "@/lib/db/schema";
import { computeEntryHash, contentHashOf, GENESIS_HASH } from "./hash";

/** One arbitrary but fixed key, so every appender queues on the same lock. */
const LEDGER_LOCK_KEY = 0x4d494c41; // "MILA"

export interface AppendInput {
  challengeId?: string | null;
  projectId?: string | null;
  kind: LedgerKind;
  authorId?: string | null;
  payload: Record<string, unknown>;
  /** Milan time. Defaults to `clockNow()`; passed in when several rows share one instant. */
  at?: Date;
  /** Set when the entry is about a file rather than a payload — the file's own SHA-256. */
  contentHash?: string;
}

export interface AppendedEntry {
  id: string;
  seq: number;
  contentHash: string;
  prevHash: string;
  entryHash: string;
  createdAt: Date;
}

export async function appendEntry(tx: Tx, input: AppendInput): Promise<AppendedEntry> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);

  const at = input.at ?? clockNow();
  const contentHash = input.contentHash ?? contentHashOf(input.payload);

  /**
   * The tip is the last entry that actually HAS a hash, not simply the last row.
   *
   * This was a real break. A code path that inserted into `ledger_entries`
   * directly left a row with a null `entry_hash`; the next append read that row
   * as the tip, found null, and chained itself to genesis — forking the chain
   * at a point that could never be repaired, because `prev_hash` seals on first
   * write. `tests/ledger.test.ts` now fails the build if any module outside this
   * file inserts into the table, and this query means an unlinked row can no
   * longer poison the append that follows it.
   */
  const tip = (await tx.execute<{ entry_hash: string | null }>(
    sql`SELECT entry_hash FROM ledger_entries WHERE entry_hash IS NOT NULL ORDER BY seq DESC LIMIT 1`,
  )) as unknown as Array<{ entry_hash: string | null }>;
  const prevHash = tip[0]?.entry_hash ?? GENESIS_HASH;

  const [row] = await tx
    .insert(ledgerEntries)
    .values({
      challengeId: input.challengeId ?? null,
      projectId: input.projectId ?? null,
      kind: input.kind,
      contentHash,
      prevHash,
      authorId: input.authorId ?? null,
      payload: input.payload,
      createdAt: at,
    })
    .returning({ id: ledgerEntries.id, seq: ledgerEntries.seq, createdAt: ledgerEntries.createdAt });

  const entryHash = computeEntryHash({
    seq: Number(row.seq),
    contentHash,
    prevHash,
    authorId: input.authorId ?? null,
    createdAt: at,
  });

  // The one-way seal from migration 0002: entry_hash is writable exactly once,
  // from NULL. This is that once.
  await tx.execute(sql`UPDATE ledger_entries SET entry_hash = ${entryHash} WHERE id = ${row.id}`);

  return { id: row.id, seq: Number(row.seq), contentHash, prevHash, entryHash, createdAt: at };
}

/** The head of the chain, for the /demo health strip and the daily anchor. */
export async function chainHead(): Promise<{ seq: number; entryHash: string | null; count: number }> {
  const { db } = await import("@/lib/db");
  const rows = (await db.execute<{ seq: number; entry_hash: string | null; n: number }>(
    sql`SELECT (SELECT seq FROM ledger_entries ORDER BY seq DESC LIMIT 1) AS seq,
               (SELECT entry_hash FROM ledger_entries ORDER BY seq DESC LIMIT 1) AS entry_hash,
               (SELECT count(*)::int FROM ledger_entries) AS n`,
  )) as unknown as Array<{ seq: number; entry_hash: string | null; n: number }>;
  return { seq: Number(rows[0]?.seq ?? 0), entryHash: rows[0]?.entry_hash ?? null, count: Number(rows[0]?.n ?? 0) };
}
