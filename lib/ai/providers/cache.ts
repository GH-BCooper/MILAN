/**
 * The AI response cache.
 *
 * Every stage is a pure function of its input, so an identical input may reuse
 * an identical output. That is what makes the pipeline idempotent, what makes
 * `pnpm pipeline:replay` free, and what makes the live trace safe to re-run in
 * front of a judge without spending a token or trusting the venue wifi.
 *
 * A cache hit still writes an `ai_runs` row with `provider: 'cache'`. The trace
 * must never claim a model ran when it did not.
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiCache } from "@/lib/db/schema";
import type { FallbackLevel, StageName } from "../types";

export interface CachedEntry {
  output: unknown;
  provider: string;
  model: string | null;
  fallbackLevel: FallbackLevel;
  confidence: number | null;
  latencyMs: number | null;
}

/** Off for a single run when the caller wants a genuinely live call. */
export const CACHE_DISABLED = process.env.AI_CACHE === "off";

export async function readCache(key: string): Promise<CachedEntry | null> {
  if (CACHE_DISABLED) return null;
  try {
    const [row] = await db.select().from(aiCache).where(eq(aiCache.key, key)).limit(1);
    if (!row) return null;

    // Best-effort hit counter. A failure here must never fail a pipeline run,
    // so it is fired and forgotten rather than awaited.
    void db
      .update(aiCache)
      .set({ hits: sql`${aiCache.hits} + 1` })
      .where(eq(aiCache.key, key))
      .catch(() => undefined);

    return {
      output: row.output,
      provider: row.provider,
      model: row.model,
      fallbackLevel: clampLevel(row.fallbackLevel),
      confidence: row.confidence === null ? null : Number(row.confidence),
      latencyMs: row.latencyMs,
    };
  } catch (e) {
    // A cache that is down is a slow pipeline, never a broken one.
    console.warn("[ai/cache] read failed", e);
    return null;
  }
}

export async function writeCache(args: {
  key: string;
  stage: StageName;
  version: string;
  provider: string;
  model: string | null;
  fallbackLevel: FallbackLevel;
  confidence: number | null;
  latencyMs: number;
  output: unknown;
}): Promise<void> {
  if (CACHE_DISABLED) return;
  try {
    await db
      .insert(aiCache)
      .values({
        key: args.key,
        stage: args.stage,
        version: args.version,
        provider: args.provider,
        model: args.model,
        fallbackLevel: args.fallbackLevel,
        confidence: args.confidence === null ? null : args.confidence.toFixed(3),
        latencyMs: args.latencyMs,
        output: args.output as object,
      })
      // Two pipeline runs on the same input can race; the second is a no-op
      // rather than a crash, because the value would have been identical.
      .onConflictDoNothing({ target: aiCache.key });
  } catch (e) {
    console.warn("[ai/cache] write failed", e);
  }
}

function clampLevel(n: number): FallbackLevel {
  return n <= 0 ? 0 : n === 1 ? 1 : 2;
}
