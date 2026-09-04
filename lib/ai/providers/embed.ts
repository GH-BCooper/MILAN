/**
 * 768-dimension embeddings, cached on the hash of the input text.
 *
 * An embedding turns text into a point in a space where similar meanings land
 * near each other. S3 uses cosine distance between those points to decide what
 * is a duplicate; S2 uses the nearest already-classified neighbours as a prior;
 * S5 uses cosine between a challenge and a capability as 45% of the match score.
 *
 * The output is deterministic for a given input, so the cache is not an
 * optimisation — it is what makes every stage replayable.
 *
 * The fallback is a local hashed bag-of-words projection. It is a genuinely
 * worse embedding: it captures lexical overlap, not meaning. It is also
 * deterministic, dependency-free and always available, so the pipeline keeps
 * clustering and routing with the wifi unplugged (invariant 8). Runs that used
 * it are recorded with `fallback_level: 2` and the trace says so.
 */
import "server-only";

import { db } from "@/lib/db";
import { aiRuns } from "@/lib/db/schema";
import { sha256 } from "../hash";
import { readCache, writeCache } from "./cache";
import type { FallbackLevel } from "../types";
import { ProviderFailure, withTimeout } from "./types";

export const EMBED_DIMENSIONS = 768;
export const EMBED_VERSION = "1.0.0";

const GEMINI_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = Number(process.env.AI_EMBED_TIMEOUT_MS ?? 4000);

export interface EmbedResult {
  vector: number[];
  model: string;
  fallbackLevel: FallbackLevel;
  latencyMs: number;
  cached: boolean;
}

/** The zero vector is never a valid embedding; callers treat it as "no signal". */
export function isZeroVector(v: number[]): boolean {
  return v.every((x) => x === 0);
}

export async function embed(text: string, challengeId?: string | null): Promise<EmbedResult> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!clean) {
    return {
      vector: new Array(EMBED_DIMENSIONS).fill(0),
      model: "empty",
      fallbackLevel: 2,
      latencyMs: 0,
      cached: false,
    };
  }

  const key = sha256(`EMBED ${EMBED_VERSION} ${GEMINI_MODEL} ${clean}`);

  const cached = await readCache(key);
  if (cached && Array.isArray(cached.output) && cached.output.length === EMBED_DIMENSIONS) {
    const vector = (cached.output as unknown[]).map((n) => Number(n));
    await recordEmbedRun(challengeId ?? null, "cache", cached.model, cached.fallbackLevel, 0, key);
    return { vector, model: cached.model ?? GEMINI_MODEL, fallbackLevel: cached.fallbackLevel, latencyMs: 0, cached: true };
  }

  const started = Date.now();
  let vector: number[] | null = null;
  let model = GEMINI_MODEL;
  let level: FallbackLevel = 0;

  if (process.env.GEMINI_API_KEY) {
    try {
      vector = await geminiEmbed(clean, process.env.GEMINI_API_KEY);
    } catch (e) {
      console.warn("[ai/embed] gemini failed:", e instanceof Error ? e.message : e);
    }
  }

  if (!vector) {
    vector = hashedEmbedding(clean);
    model = "local-hashed-bow";
    level = 2;
  }

  const latencyMs = Date.now() - started;
  await Promise.all([
    writeCache({
      key,
      stage: "EMBED",
      version: EMBED_VERSION,
      provider: level === 0 ? "gemini" : "local",
      model,
      fallbackLevel: level,
      confidence: null,
      latencyMs,
      output: vector,
    }),
    recordEmbedRun(challengeId ?? null, level === 0 ? "gemini" : "local", model, level, latencyMs, key),
  ]);

  return { vector, model, fallbackLevel: level, latencyMs, cached: false };
}

/** Embed several texts, bounded so a `--all` run does not open 47 sockets. */
export async function embedMany(texts: string[], concurrency = 4): Promise<EmbedResult[]> {
  const out: EmbedResult[] = new Array(texts.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= texts.length) return;
      out[i] = await embed(texts[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return out;
}

/* ------------------------------------------------------------------ gemini */

async function geminiEmbed(text: string, key: string): Promise<number[]> {
  return withTimeout("gemini-embed", TIMEOUT_MS, async (signal) => {
    const response = await fetch(`${ENDPOINT}/${GEMINI_MODEL}:embedContent?key=${key}`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${GEMINI_MODEL}`,
        content: { parts: [{ text }] },
        // CLAUDE.md section 3 fixes the storage at 768-d; pgvector columns are
        // declared at that width, so asking for anything else would not fit.
        outputDimensionality: EMBED_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderFailure("gemini-embed", `HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const payload: unknown = await response.json();
    const values = (payload as { embedding?: { values?: unknown } }).embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIMENSIONS) {
      throw new ProviderFailure(
        "gemini-embed",
        `expected ${EMBED_DIMENSIONS} dimensions, got ${Array.isArray(values) ? values.length : "none"}`,
      );
    }
    return normalise(values.map((v) => Number(v)));
  });
}

/* ------------------------------------------------------------- the fallback */

/**
 * A hashed bag-of-words projection into the same 768 dimensions.
 *
 * Each token (and each character trigram, which is what makes it work at all on
 * Devanagari) is hashed to a small set of dimensions and accumulated, then the
 * vector is L2-normalised so cosine behaves. Two texts sharing vocabulary land
 * near each other; two texts sharing only meaning do not. We say exactly that
 * on the declared-stubs slide rather than pretending the fallback is a model.
 */
export function hashedEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBED_DIMENSIONS).fill(0);
  const lower = text.toLowerCase();

  const tokens = lower.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  for (const token of tokens) scatter(vector, `w:${token}`, 1);

  const stripped = lower.replace(/[^\p{L}\p{N}]+/gu, " ");
  for (let i = 0; i + 3 <= stripped.length; i++) {
    const gram = stripped.slice(i, i + 3);
    if (gram.trim().length === 3) scatter(vector, `g:${gram}`, 0.35);
  }

  return normalise(vector);
}

/** Three dimensions per feature: enough to keep collisions from dominating. */
function scatter(vector: number[], feature: string, weight: number): void {
  const digest = sha256(feature);
  for (let k = 0; k < 3; k++) {
    const slice = Number.parseInt(digest.slice(k * 8, k * 8 + 8), 16);
    const dim = slice % EMBED_DIMENSIONS;
    // The sign comes from a different nibble so features do not all push the
    // same way and cancel the vector out.
    const sign = (slice >>> 31) % 2 === 0 ? 1 : -1;
    vector[dim] += sign * weight;
  }
}

function normalise(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

/* ---------------------------------------------------------------- utilities */

/** Cosine similarity for two unit vectors; the guard keeps it honest if not. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** pgvector's literal syntax. Drizzle's `vector` column takes number[] on
 *  insert; raw SQL paths need this. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}

async function recordEmbedRun(
  challengeId: string | null,
  provider: string,
  model: string | null,
  fallbackLevel: FallbackLevel,
  latencyMs: number,
  inputHash: string,
): Promise<void> {
  try {
    await db.insert(aiRuns).values({
      challengeId,
      stage: "EMBED",
      provider,
      model,
      fallbackLevel,
      confidence: null,
      latencyMs,
      inputHash,
      output: { dimensions: EMBED_DIMENSIONS } as object,
    });
  } catch (e) {
    console.error("[ai/embed] could not write ai_runs row", e);
  }
}
