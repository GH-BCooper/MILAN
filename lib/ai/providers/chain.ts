/**
 * The provider chain.
 *
 *   Gemini 2.5 Flash  ->  Groq  ->  deterministic rules
 *        level 0            1                 2
 *
 * `runWithChain` never throws to its caller. A timeout, an HTTP error, a parse
 * failure or a missing key steps to the next level, and level 2 has no network
 * to fail. The worst case is a level-2 answer with `confidence: 0.45`, which
 * every downstream threshold treats as "a human should look at this".
 *
 * Every call writes exactly one `ai_runs` row — including cache hits, including
 * runs that fell all the way through. `/admin/ai-runs` is the receipt when a
 * judge asks whether the animation on screen is real.
 */
import "server-only";

import type { ZodType } from "zod";

import { db } from "@/lib/db";
import { aiRuns } from "@/lib/db/schema";
import { stageInputHash } from "../hash";
import type { FallbackLevel, ProviderError, StageName, StageRun } from "../types";
import { readCache, writeCache } from "./cache";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { toJsonSchema } from "./jsonSchema";
import { rulesProvider } from "./rules";
import type { LLMProvider } from "./types";

const ALL_PROVIDERS: Record<string, LLMProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  rules: rulesProvider,
};

/**
 * `AI_PROVIDER_CHAIN=gemini,groq,rules`. Configurable so the demo can be run
 * deliberately degraded ("rules") on stage without editing code.
 * `rules` is always appended: a chain that can run out of providers would break
 * invariant 8.
 */
export function providerChain(): LLMProvider[] {
  const raw = (process.env.AI_PROVIDER_CHAIN ?? "gemini,groq,rules").replace(/^["']|["']$/g, "");
  const named = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((name) => ALL_PROVIDERS[name])
    .filter((p): p is LLMProvider => Boolean(p));

  const chain = named.filter((p) => p.name !== "rules");
  chain.push(rulesProvider);
  return chain;
}

export interface ChainArgs<T> {
  stage: StageName;
  /** Bumped when a prompt changes, so old cache entries are not reused. */
  version: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  input: unknown;
  timeoutMs?: number;
  challengeId?: string | null;
  /** Pulls `confidence` out of the parsed value for `ai_runs` and the trace. */
  confidenceOf?: (value: T) => number | null;
}

/**
 * Per-stage budget. The whole pipeline is meant to land in 4-6 seconds
 * (PHASE_2_LEARN.md section 6), so no single call may hang past this.
 *
 * 3000ms rather than the 2500ms the build file suggests: measured, the current
 * Gemini Flash tier answers a classification prompt in ~2.1-2.4s even with
 * thinking turned down, and a 2500ms cap threw away a good level-0 answer on
 * roughly half of runs to buy a level-1 answer 1s later. The pipeline stays
 * inside its 8s budget because stages that do not depend on each other run
 * concurrently -- see `lib/ai/pipeline.ts`.
 */
export const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 3000);

export async function runWithChain<T>(args: ChainArgs<T>): Promise<StageRun<T>> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inputHash = stageInputHash(args.stage, args.version, args.input);
  const errors: ProviderError[] = [];

  /* -------------------------------------------------------- the cache tier */

  const cached = await readCache(inputHash);
  if (cached) {
    const parsed = args.schema.safeParse(cached.output);
    if (parsed.success) {
      const meta = {
        stage: args.stage,
        provider: "cache",
        model: cached.model,
        fallbackLevel: cached.fallbackLevel,
        confidence: args.confidenceOf?.(parsed.data) ?? cached.confidence,
        latencyMs: 0,
        inputHash,
        cached: true,
        errors,
      } as const;
      await recordRun(args.challengeId ?? null, meta, parsed.data);
      return { value: parsed.data, meta: { ...meta, errors } };
    }
    // A cached value that no longer parses means the schema moved on. Ignore it
    // and let the chain run; the new answer overwrites nothing (the key is
    // stage + version + input, so the version bump gives it a new key anyway).
    errors.push({ provider: "cache", message: "cached value no longer matches the schema" });
  }

  /* ------------------------------------------------------ the provider tiers */

  const responseSchema = toJsonSchema(args.schema);

  for (const provider of providerChain()) {
    if (!provider.available()) {
      errors.push({ provider: provider.name, message: "not configured" });
      continue;
    }

    try {
      const result = await provider.complete({
        stage: args.stage,
        system: args.system,
        user: args.user,
        schema: args.schema,
        timeoutMs,
        input: args.input,
        responseSchema,
      });

      const confidence = args.confidenceOf?.(result.value) ?? null;
      const meta = {
        stage: args.stage,
        provider: provider.name,
        model: result.model,
        fallbackLevel: provider.level,
        confidence,
        latencyMs: result.latencyMs,
        inputHash,
        cached: false,
        errors,
      };

      await Promise.all([
        recordRun(args.challengeId ?? null, meta, result.value),
        writeCache({
          key: inputHash,
          stage: args.stage,
          version: args.version,
          provider: provider.name,
          model: result.model,
          fallbackLevel: provider.level,
          confidence,
          latencyMs: result.latencyMs,
          output: result.value,
        }),
      ]);

      return { value: result.value, meta };
    } catch (e) {
      // CLAUDE.md section 5: never swallow. The failure is recorded on the run
      // row that eventually succeeds, and rendered in the trace footer.
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ provider: provider.name, message });
      console.warn(`[ai/chain] ${args.stage} ${provider.name} failed: ${message}`);
    }
  }

  // Unreachable in practice: `providerChain()` always ends in `rules`, and
  // `rules` has no network. If it ever is reached, the stage caller is the
  // wrong place to discover it.
  throw new Error(
    `[ai/chain] ${args.stage} exhausted every provider: ${errors
      .map((e) => `${e.provider}: ${e.message}`)
      .join(" | ")}`,
  );
}

/** One row per call, always. The trace tick on screen is this row. */
async function recordRun(
  challengeId: string | null,
  meta: {
    stage: StageName;
    provider: string;
    model: string | null;
    fallbackLevel: FallbackLevel;
    confidence: number | null;
    latencyMs: number;
    inputHash: string;
    errors: ProviderError[];
  },
  output: unknown,
): Promise<void> {
  try {
    await db.insert(aiRuns).values({
      challengeId,
      stage: meta.stage,
      provider: meta.provider,
      model: meta.model,
      fallbackLevel: meta.fallbackLevel,
      confidence: meta.confidence === null ? null : clamp3(meta.confidence),
      latencyMs: meta.latencyMs,
      inputHash: meta.inputHash,
      output: { value: output, errors: meta.errors } as object,
    });
  } catch (e) {
    // Losing the receipt must not lose the answer, but it must be visible.
    console.error("[ai/chain] could not write ai_runs row", e);
  }
}

/** `numeric(4,3)` tops out at 9.999 but a confidence is a probability. */
function clamp3(n: number): string {
  return Math.max(0, Math.min(1, n)).toFixed(3);
}
