/**
 * Link any ledger entry that was written without a chain link.
 *
 * Migration 0009 did this once for the Phase 1/2 backlog. This is the same SQL,
 * repeatable, for the case that matters more: a code path that inserted into
 * `ledger_entries` directly instead of going through `appendEntry`. Phase 3
 * found six of those and converted them; `tests/ledger.test.ts` now fails the
 * build if a seventh appears, and this repairs the rows the six left behind.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
const { verifyChain } = await import("@/lib/ledger/verify");
const { sealLegacyPayloads } = await import("@/lib/ledger/seal");

const before = (await db.execute<{ n: number }>(
  sql`SELECT count(*)::int AS n FROM ledger_entries WHERE entry_hash IS NULL`,
)) as unknown as Array<{ n: number }>;
console.log(`${before[0].n} unlinked entry(ies)`);

await db.execute(sql`
  DO $$
  DECLARE
    r RECORD;
    prev text := repeat('0', 64);
    h text;
    n int := 0;
  BEGIN
    FOR r IN SELECT seq, id, content_hash, author_id, created_at, entry_hash
             FROM ledger_entries ORDER BY seq
    LOOP
      IF r.entry_hash IS NOT NULL THEN
        prev := r.entry_hash;
        CONTINUE;
      END IF;
      h := milan_entry_hash(r.seq, r.content_hash, prev, r.author_id, r.created_at);
      UPDATE ledger_entries SET prev_hash = prev, entry_hash = h WHERE id = r.id;
      prev := h;
      n := n + 1;
    END LOOP;
    -- No RAISE: postgres.js surfaces a NOTICE as an error object, which made a
    -- successful repair look like a failure. The count is reported below instead.
  END $$;
`);

const after = (await db.execute<{ n: number }>(
  sql`SELECT count(*)::int AS n FROM ledger_entries WHERE entry_hash IS NULL`,
)) as unknown as Array<{ n: number }>;
console.log(`${Number(before[0].n) - Number(after[0].n)} linked, ${after[0].n} still unlinked`);

// Entries written by the six converted call sites hashed a subset of their
// payload, so they need the same seal the Phase 1/2 backlog got.
const seal = await sealLegacyPayloads();
console.log("seal:", seal);

const result = await verifyChain();
console.log(result);
process.exit(result.ok ? 0 : 1);
