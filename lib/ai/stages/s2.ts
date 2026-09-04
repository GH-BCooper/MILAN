/**
 * S2 — domain, NDMA hazard linkage, severity and solvability.
 *
 * Before the model is called, this stage looks up the five nearest
 * already-classified challenges by embedding cosine and passes their labels in
 * as a prior. That is our declared substitute for fine-tuning: we have no
 * labelled dataset and no GPU budget, and we say so on the slide. The prior
 * improves every time a human corrects a classification at /admin/triage,
 * because a correction rewrites the labels the next kNN lookup reads.
 *
 * Like S1 this is a pure async function. It returns facts; `decideS2` applies
 * the confidence floor, and the pipeline owns the write.
 */
import "server-only";

import { and, isNotNull, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { challenges } from "@/lib/db/schema";
import { runWithChain } from "../providers/chain";
import { toVectorLiteral } from "../providers/embed";
import * as prompt from "../prompts/s2";
import { S2Schema, type S2Input, type S2Output } from "../schemas";
import type { StageRun } from "../types";

export const S2_THRESHOLDS = {
  /** Below this the classification is a proposal, not a decision: it goes to a
   *  human at /admin/triage. Higher than S1's floor because a wrong domain
   *  routes the problem to the wrong department for a whole claim window. */
  humanQueue: 0.65,
  /** How many neighbours the kNN prior carries. Five is enough to show a
   *  pattern and few enough that one outlier cannot dominate the prompt. */
  priorK: 5,
  /** A neighbour further away than this is not evidence about this report. */
  priorMinSimilarity: 0.55,
} as const;

export type S2Decision =
  | { kind: "ACCEPT" }
  | { kind: "HUMAN_QUEUE"; why: string };

/**
 * The embedding kNN prior.
 *
 * Ordering by `<=>` (cosine distance) lets the HNSW index do the work rather
 * than a sequential scan. At 25 rows that is indistinguishable; at 250,000 it
 * is the difference between a demo and a timeout, which is exactly the question
 * a judge asks.
 */
export async function knnPrior(
  embedding: number[],
  excludeChallengeId: string | null,
  k = S2_THRESHOLDS.priorK,
): Promise<S2Input["priors"]> {
  if (embedding.length === 0) return [];

  const literal = toVectorLiteral(embedding);
  const rows = await db
    .select({
      title: challenges.title,
      domain: challenges.domain,
      hazard: challenges.hazard,
      similarity: sql<number>`1 - (${challenges.embedding} <=> ${literal}::vector)`,
    })
    .from(challenges)
    .where(
      and(
        isNotNull(challenges.embedding),
        isNotNull(challenges.domain),
        excludeChallengeId ? ne(challenges.id, excludeChallengeId) : undefined,
      ),
    )
    .orderBy(sql`${challenges.embedding} <=> ${literal}::vector`)
    .limit(k);

  return rows
    .filter((r) => r.domain && r.hazard && Number(r.similarity) >= S2_THRESHOLDS.priorMinSimilarity)
    .map((r) => ({
      title: r.title,
      domain: r.domain as string,
      hazard: r.hazard as string,
      similarity: Number(r.similarity),
    }));
}

export async function runS2(
  input: S2Input,
  challengeId?: string | null,
): Promise<StageRun<S2Output>> {
  return runWithChain({
    stage: "S2_CLASSIFY",
    version: prompt.VERSION,
    system: prompt.SYSTEM,
    user: prompt.render(input),
    schema: S2Schema,
    input,
    challengeId,
    confidenceOf: (v) => v.confidence,
  });
}

export function decideS2(out: S2Output): S2Decision {
  if (out.confidence < S2_THRESHOLDS.humanQueue) {
    return {
      kind: "HUMAN_QUEUE",
      why: `S2 confidence ${out.confidence.toFixed(2)} is below the ${S2_THRESHOLDS.humanQueue} floor.`,
    };
  }
  return { kind: "ACCEPT" };
}

/** `hazard_strength` must be 0 when there is no hazard, whatever the model said. */
export function normaliseS2(out: S2Output): S2Output {
  return out.hazard === "NONE" ? { ...out, hazard_strength: 0 } : out;
}
