/**
 * Vector candidate selection with a no-pgvector fallback.
 *
 * The schema prefers the `vector` type and HNSW index (migration 0000 runs
 * `CREATE EXTENSION IF NOT EXISTS vector`), and every similarity query pushes
 * the cosine distance down to Postgres with `<=>`. That is the right answer on
 * any database that has pgvector: at 250,000 rows the index is the difference
 * between a demo and a timeout.
 *
 * But Milan's own demo dataset is small and precious — twenty-five stories,
 * not twenty-five thousand — and some environments cannot have the extension:
 * the embedded Postgres the sandbox seeds (`@embedded-postgres` ships vanilla
 * PostgreSQL binaries), a laptop SQLite of last resort, a staging box nobody
 * has root on. On those, a stage whose only job is "find my nearest
 * neighbours" must not throw `type "vector" does not exist` and degrade the
 * whole pipeline. Computing cosine in-process over a bounded candidate set
 * costs milliseconds at demo scale and is honest: the stage event records
 * which path answered (below), exactly as provider fallbacks do.
 */
import "server-only";

import { cosine } from "./providers/embed";

/**
 * Upper bound on rows scanned when `<=>` is unavailable and cosine is computed
 * in-process. The seeded demo corpus is three orders of magnitude below this;
 * the cap exists so a pgvector-less production accident degrades to "older
 * reports are not candidates" instead of a seq-scan the request never returns
 * from. With pgvector installed this constant is never consulted.
 */
export const JS_VECTOR_SCAN_LIMIT = 1000;

let vectorSupport: Promise<boolean> | null = null;

/**
 * True when the connected database can execute `<=>` cosine distance, cached
 * for the process. Detected by asking Postgres to cast a one-dimension
 * literal — cheap, and it fails on exactly the error the real queries would
 * hit (`type "vector" does not exist`, code 42704).
 */
export function supportsVector(client: {
  unsafe: (query: string) => Promise<unknown>;
}): Promise<boolean> {
  if (!vectorSupport) {
    vectorSupport = Promise.resolve()
      .then(() => client.unsafe(`select '[1]'::vector <=> '[1]'::vector`))
      .then(() => true)
      .catch(() => false);
  }
  return vectorSupport;
}

/** Test-only: drop the cached probe so a suite can point at another database. */
export function resetVectorSupportCacheForTests(): void {
  vectorSupport = null;
}

/** Embeddings come back as a string ("[0.1,-0.2,…]") both from the `vector`
 * type and from the plain-text column the no-extension environments use. */
export function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.every((n) => typeof n === "number") ? raw : null;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number") ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * In-process stand-in for `ORDER BY embedding <=> $1::vector LIMIT k`.
 * Rows carry their embedding as a string/array under `embeddingKey`; rows
 * whose embedding will not parse are dropped, exactly as the SQL path drops
 * NULLs. Returns at most `k` rows with `similarity` attached, descending.
 */
export function jsCosineRank<Row extends Record<string, unknown>>(
  rows: Row[],
  query: number[],
  k: number,
  embeddingKey: keyof Row = "embedding" as keyof Row,
): Array<Row & { similarity: number }> {
  if (query.length === 0) return [];
  const ranked: Array<Row & { similarity: number }> = [];
  for (const row of rows) {
    const v = parseEmbedding(row[embeddingKey]);
    if (!v || v.length !== query.length) continue;
    ranked.push({ ...row, similarity: cosine(query, v) });
  }
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, k);
}
