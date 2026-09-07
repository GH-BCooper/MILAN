-- Milan: extensions the schema depends on.
-- This migration runs before the generated schema migration because
-- `challenges.embedding` needs the `vector` type and
-- `challenges_title_trgm_idx` needs `gin_trgm_ops`.

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: 768-d embeddings, HNSW index in Phase 2 (hard requirement; embedding columns refuse to create without it)

-- The three contrib modules below are opportunistically loaded: on a full
-- PostgreSQL (Supabase, apt, docker) they simply appear. On minimal bundled
-- builds (e.g. the pip-bundled server used in throwaway sandboxes) they may
-- be absent, and the schema then degrades along the paths that were already
-- designed to work without them:
--   pg_trgm  -> challenges_title_trgm_idx is skipped (guarded where created);
--               search runs the same ILIKE query a cold index would anyway.
--   pgcrypto -> milan_entry_hash is not defined; the SQL recompute tool is
--               unavailable, but every ledger row is hashed in TypeScript by
--               lib/ledger/hash.ts, so the chain is intact regardless.
--   unaccent -> declared for Phase-2 search; nothing reads it yet.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable on this PostgreSQL build: title-trgm index will be skipped later (0001)';
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgcrypto unavailable on this PostgreSQL build: milan_entry_hash will be skipped later (0009)';
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS unaccent;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'unaccent unavailable on this PostgreSQL build: harmless, nothing reads it yet';
  END;
END $$;
