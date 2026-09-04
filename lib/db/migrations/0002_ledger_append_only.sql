-- CLAUDE.md invariant 2: the ledger is append-only. Enforced here, in the
-- database, not by convention in application code.
--
-- DELETE is refused unconditionally. UPDATE is refused for every column
-- except `prev_hash` and `entry_hash`, and then only while they are still
-- NULL -- a one-way seal. Phase 1 writes entries with `content_hash` only;
-- Phase 3 Task 3.4 links the chain by filling those two columns exactly once.
-- Nothing a citizen or a university wrote can ever be altered or erased.

CREATE OR REPLACE FUNCTION milan_ledger_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_entries is append-only: DELETE is not permitted (seq=%)', OLD.seq;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ( NEW.id, NEW.seq, NEW.challenge_id, NEW.project_id, NEW.kind,
         NEW.content_hash, NEW.author_id, NEW.payload, NEW.created_at )
       IS DISTINCT FROM
       ( OLD.id, OLD.seq, OLD.challenge_id, OLD.project_id, OLD.kind,
         OLD.content_hash, OLD.author_id, OLD.payload, OLD.created_at )
    THEN
      RAISE EXCEPTION 'ledger_entries is append-only: content columns are immutable (seq=%)', OLD.seq;
    END IF;

    IF OLD.prev_hash IS NOT NULL AND NEW.prev_hash IS DISTINCT FROM OLD.prev_hash THEN
      RAISE EXCEPTION 'ledger_entries.prev_hash is sealed once written (seq=%)', OLD.seq;
    END IF;

    IF OLD.entry_hash IS NOT NULL AND NEW.entry_hash IS DISTINCT FROM OLD.entry_hash THEN
      RAISE EXCEPTION 'ledger_entries.entry_hash is sealed once written (seq=%)', OLD.seq;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION milan_ledger_append_only();

-- TRUNCATE is deliberately NOT blocked. Invariant 2 forbids UPDATE and DELETE:
-- nobody may alter or erase an individual contribution. Wiping the entire demo
-- database via `pnpm seed --reset` is an operational reset, not an erasure, and
-- it is the one-command restore path for a corrupted demo.
