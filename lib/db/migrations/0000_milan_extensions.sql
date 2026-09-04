-- Milan: extensions the schema depends on.
-- This migration runs before the generated schema migration because
-- `challenges.embedding` needs the `vector` type and
-- `challenges_title_trgm_idx` needs `gin_trgm_ops`.

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: 768-d embeddings, HNSW index in Phase 2
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy title matching for the duplicate check
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() for SHA-256 in SQL where we need it
CREATE EXTENSION IF NOT EXISTS unaccent;   -- transliterated Hindi place names in search
