-- PHASE_3_BUILD.md Task 3.4 steps 3 and 4.
--
-- Phase 1 and Phase 2 wrote ledger entries with a content_hash and a null
-- prev_hash. This links them, in seq order, into one chain, and then closes the
-- door behind them.
--
-- The hash is computed here in SQL rather than by a script, so that the chain a
-- fresh database gets is produced by the migration itself and cannot drift from
-- the one this database has. It reproduces `computeEntryHash` in
-- lib/ledger/hash.ts exactly: sha256 of the canonical JSON of
-- {authorId, contentHash, createdAt, prevHash, seq} with keys sorted, no
-- whitespace, and createdAt as an ISO-8601 UTC string truncated to milliseconds
-- (which is what JavaScript's Date.toISOString() produces).

CREATE OR REPLACE FUNCTION milan_entry_hash(
  p_seq bigint,
  p_content_hash text,
  p_prev_hash text,
  p_author_id text,
  p_created_at timestamptz
) RETURNS text AS $$
  SELECT encode(
    digest(
      '{"authorId":' ||
        CASE WHEN p_author_id IS NULL THEN 'null' ELSE to_json(p_author_id)::text END ||
      ',"contentHash":' || to_json(p_content_hash)::text ||
      ',"createdAt":' || to_json(
          to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )::text ||
      ',"prevHash":' || to_json(COALESCE(p_prev_hash, repeat('0', 64)))::text ||
      ',"seq":' || p_seq::text ||
      '}',
      'sha256'
    ),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
COMMENT ON FUNCTION milan_entry_hash IS
  'The SQL twin of computeEntryHash() in lib/ledger/hash.ts. Used by the Phase 3 backfill and available to anyone who wants to recompute the chain without leaving psql.';
--> statement-breakpoint

-- The backfill. One pass in seq order, carrying the previous entry_hash forward.
DO $$
DECLARE
  r RECORD;
  prev text := repeat('0', 64);
  h text;
  n int := 0;
BEGIN
  FOR r IN SELECT seq, id, content_hash, author_id, created_at, prev_hash, entry_hash
           FROM ledger_entries ORDER BY seq
  LOOP
    IF r.entry_hash IS NOT NULL THEN
      -- Already linked (written by lib/ledger/append.ts). Carry it forward.
      prev := r.entry_hash;
      CONTINUE;
    END IF;

    h := milan_entry_hash(r.seq, r.content_hash, prev, r.author_id, r.created_at);
    UPDATE ledger_entries SET prev_hash = prev, entry_hash = h WHERE id = r.id;
    prev := h;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'ledger backfill: % entries linked, head = %', n, prev;
END $$;
--> statement-breakpoint

-- Now that every row is linked, the seal becomes absolute: prev_hash and
-- entry_hash may still be written exactly once from NULL (a new entry needs
-- that), but nothing else about an entry may ever change, and DELETE is refused
-- unconditionally. Both are already enforced by the trigger from migration 0002.
--
-- The rules below are belt and braces required by Task 3.4 step 4. A rule that
-- silently does nothing would be worse than no rule at all -- a caller would
-- read "UPDATE 0" as success -- so the trigger, which RAISEs, runs FIRST and
-- the rules only ever apply to statements the trigger allowed through.
CREATE OR REPLACE FUNCTION milan_ledger_reject_bulk() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted on this table', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
--> statement-breakpoint
COMMENT ON TABLE ledger_entries IS
  'Append-only. CLAUDE.md invariant 2. UPDATE of any content column and DELETE of any row are refused by the ledger_entries_append_only trigger with an exception, not a silent no-op. prev_hash and entry_hash are writable exactly once, from NULL, which is how the chain is linked inside the same transaction as the append.';
