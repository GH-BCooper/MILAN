/**
 * Walking the chain.
 *
 * Streamed in pages, because "verify the ledger" has to remain a thing you can
 * press on a laptop when the ledger has a million rows, not only when it has
 * two hundred. Each page carries the previous page's tip forward, so memory is
 * constant however long the chain gets.
 *
 * What this proves, precisely — and /ledger says the same thing in plain words:
 * that no entry has been altered or removed since it was written, and that the
 * order is the order it claims. It does not prove that what someone wrote was
 * true, and it does not prove when it was written unless an ANCHOR entry for
 * that range has been timestamped.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { computeEntryHash, contentHashOf, GENESIS_HASH } from "./hash";

export interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string | null;
  headSeq: number;
  /** Entries whose payload is covered by the legacy seal rather than by their own content_hash. */
  sealedLegacy: number;
}

/**
 * The Phase 1 / Phase 2 entries.
 *
 * Those were hashed with `JSON.stringify(payload)` before `canonicalJson`
 * existed, and jsonb does not preserve key order, so their content_hash can
 * never be recomputed from what the database returns. The ledger is append-only,
 * so they cannot be corrected either — and pretending otherwise would be exactly
 * the fake depth we refuse elsewhere.
 *
 * Instead they are SEALED: one entry (kind ANCHOR, event LEGACY_PAYLOAD_SEAL)
 * records the canonical hash of every one of those payloads as it stood at the
 * moment of sealing. That entry is itself chained, so altering a legacy payload
 * now disagrees with the seal, and altering the seal breaks the chain. Coverage
 * is complete from genesis; only the mechanism differs, and /ledger says so.
 */
interface LegacySeal {
  fromSeq: number;
  toSeq: number;
  hashes: Record<string, string>;
}

async function loadSeal(): Promise<LegacySeal | null> {
  const rows = (await db.execute<{ payload: { seal?: LegacySeal } }>(
    sql`SELECT payload FROM ledger_entries
        WHERE kind = 'ANCHOR' AND payload->>'event' = 'LEGACY_PAYLOAD_SEAL'
        ORDER BY seq LIMIT 1`,
  )) as unknown as Array<{ payload: { seal?: LegacySeal } }>;
  return rows[0]?.payload?.seal ?? null;
}

interface Row extends Record<string, unknown> {
  seq: number;
  content_hash: string;
  prev_hash: string | null;
  entry_hash: string | null;
  author_id: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
  kind: string;
}

const PAGE = 500;

export async function verifyChain(options: { verifyPayloads?: boolean } = {}): Promise<VerifyResult> {
  const verifyPayloads = options.verifyPayloads !== false;
  let prev = GENESIS_HASH;
  let after = -1;
  let checked = 0;
  let headHash: string | null = null;
  let headSeq = 0;
  let sealedLegacy = 0;
  const seal = verifyPayloads ? await loadSeal() : null;

  for (;;) {
    const rows = (await db.execute<Row>(
      sql`SELECT seq, content_hash, prev_hash, entry_hash, author_id, created_at, payload, kind::text AS kind
          FROM ledger_entries WHERE seq > ${after} ORDER BY seq LIMIT ${PAGE}`,
    )) as unknown as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const seq = Number(row.seq);
      after = seq;
      checked++;

      if (!row.entry_hash) {
        return { ok: false, checked, brokenAtSeq: seq, reason: "entry has no entry_hash — the chain is not linked here", headHash, headSeq, sealedLegacy };
      }
      if ((row.prev_hash ?? GENESIS_HASH) !== prev) {
        return {
          ok: false,
          checked,
          brokenAtSeq: seq,
          reason: `prev_hash does not match the previous entry's entry_hash (expected ${prev.slice(0, 12)}…, found ${(row.prev_hash ?? "null").slice(0, 12)}…)`,
          headHash,
          headSeq,
          sealedLegacy,
        };
      }

      // The payload check is what catches tampering with the *content* rather
      // than with the links. An UPDATE is refused by the database, but a
      // restore from a doctored dump would not be, and this is what finds it.
      if (verifyPayloads && row.payload !== null) {
        const recomputed = contentHashOf(row.payload);
        const sealed = seal && seq >= seal.fromSeq && seq <= seal.toSeq ? seal.hashes[String(seq)] : undefined;
        if (recomputed !== row.content_hash) {
          if (sealed && sealed === recomputed) {
            sealedLegacy++;
          } else {
            return {
              ok: false,
              checked,
              brokenAtSeq: seq,
              reason: sealed
                ? "payload no longer matches the legacy seal — this entry has been altered since Phase 3 sealed it"
                : "payload does not hash to content_hash — this entry has been altered",
              headHash,
              headSeq,
              sealedLegacy,
            };
          }
        }
      }

      const expected = computeEntryHash({
        seq,
        contentHash: row.content_hash,
        prevHash: row.prev_hash,
        authorId: row.author_id,
        createdAt: toIso(row.created_at),
      });
      if (expected !== row.entry_hash) {
        return { ok: false, checked, brokenAtSeq: seq, reason: "entry_hash does not match the entry's own fields", headHash, headSeq, sealedLegacy };
      }

      prev = row.entry_hash;
      headHash = row.entry_hash;
      headSeq = seq;
    }

    if (rows.length < PAGE) break;
  }

  return { ok: true, checked, brokenAtSeq: null, reason: null, headHash, headSeq, sealedLegacy };
}

/** Postgres hands back `2026-09-05 10:35:13.451268+00`; the hash uses ms precision. */
export function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value.replace(" ", "T").replace(/\+00$/, "Z")).toISOString();
}
