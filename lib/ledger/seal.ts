/**
 * Sealing the pre-Phase-3 entries. Idempotent: a second call is a no-op.
 *
 * See the long comment in `verify.ts` for why this exists. In one sentence:
 * entries written before `canonicalJson` cannot have their own content_hash
 * recomputed, so their canonical hashes are recorded once, inside the chain,
 * and verified against that record from then on.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { appendEntry } from "./append";
import { contentHashOf } from "./hash";

export async function sealLegacyPayloads(): Promise<{ sealed: number; alreadySealed: boolean; fromSeq: number; toSeq: number }> {
  const existing = (await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ledger_entries WHERE kind = 'ANCHOR' AND payload->>'event' = 'LEGACY_PAYLOAD_SEAL'`,
  )) as unknown as Array<{ n: number }>;
  if (Number(existing[0]?.n ?? 0) > 0) {
    return { sealed: 0, alreadySealed: true, fromSeq: 0, toSeq: 0 };
  }

  const rows = (await db.execute<{ seq: number; payload: Record<string, unknown> | null; content_hash: string }>(
    sql`SELECT seq, payload, content_hash FROM ledger_entries ORDER BY seq`,
  )) as unknown as Array<{ seq: number; payload: Record<string, unknown> | null; content_hash: string }>;

  const hashes: Record<string, string> = {};
  let fromSeq = Number.POSITIVE_INFINITY;
  let toSeq = 0;
  for (const row of rows) {
    if (row.payload === null) continue;
    const canonical = contentHashOf(row.payload);
    if (canonical === row.content_hash) continue; // already canonical; needs no seal
    hashes[String(row.seq)] = canonical;
    fromSeq = Math.min(fromSeq, Number(row.seq));
    toSeq = Math.max(toSeq, Number(row.seq));
  }

  const count = Object.keys(hashes).length;
  if (count === 0) return { sealed: 0, alreadySealed: false, fromSeq: 0, toSeq: 0 };

  const at = clockNow();
  await db.transaction((tx) =>
    appendEntry(tx, {
      kind: "ANCHOR",
      at,
      payload: {
        event: "LEGACY_PAYLOAD_SEAL",
        note:
          "Entries written before Phase 3 were hashed with JSON.stringify, and jsonb does not preserve key order, " +
          "so their own content_hash can no longer be recomputed. This entry records the canonical hash of each of " +
          "those payloads as it stood when Phase 3 sealed them. It is itself chained: altering a legacy payload now " +
          "disagrees with this record, and altering this record breaks the chain.",
        seal: { fromSeq, toSeq, hashes },
        at: at.toISOString(),
      },
    }),
  );

  return { sealed: count, alreadySealed: false, fromSeq, toSeq };
}
