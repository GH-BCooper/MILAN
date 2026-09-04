/**
 * S4 — the priority score, wired to the database.
 *
 * This file contains ZERO model calls, and it is worth checking that it stays
 * that way: `lib/ai/pipeline.ts` never reaches a provider for S4, no `ai_runs`
 * row is written for it, and the whole computation is a call into
 * `packages/scoring`, which is pure.
 *
 * All this module does is read the seven inputs, hand them to the pure
 * function, and write the total plus the full breakdown back. The breakdown is
 * stored, not recomputed on render, so the number a citizen saw last month can
 * still be explained even after the weights change — the row carries the
 * version it was scored under.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { blocks, challenges, districts } from "@/lib/db/schema";
import { computePriority, type ScoreResult, type ScoringInput } from "@/packages/scoring";

/**
 * Gather the seven inputs.
 *
 * Block vulnerability falls back to the district index: `seed-data/districts.csv`
 * carries one index per district, and a block inherits it (PROGRESS.md, Phase 1
 * deployment section). Block-level indices are a Phase 3 input.
 */
export async function scoringInputFor(challengeId: string): Promise<ScoringInput | null> {
  const [row] = await db
    .select({
      severity: challenges.severity,
      hazard: challenges.hazard,
      hazardStrength: challenges.hazardStrength,
      peopleAffected: challenges.peopleAffected,
      corroborationCount: challenges.corroborationCount,
      recurrence: challenges.recurrence,
      officialEndorsed: challenges.officialEndorsed,
      blockVulnerability: blocks.vulnerabilityIndex,
      districtVulnerability: districts.vulnerabilityIndex,
    })
    .from(challenges)
    .leftJoin(blocks, eq(blocks.code, challenges.blockCode))
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .where(eq(challenges.id, challengeId))
    .limit(1);

  if (!row) return null;

  const vulnerability = row.blockVulnerability ?? row.districtVulnerability;

  return {
    severity: row.severity === null ? null : Number(row.severity),
    hazard: row.hazard,
    hazardStrength: row.hazardStrength === null ? null : Number(row.hazardStrength),
    peopleAffected: row.peopleAffected,
    blockVulnerability: vulnerability === null ? null : Number(vulnerability),
    corroborationCount: row.corroborationCount,
    recurrence: row.recurrence,
    officialEndorsed: row.officialEndorsed,
  };
}

export interface S4Result {
  input: ScoringInput;
  score: ScoreResult;
}

/** Compute and persist. Idempotent by construction: the function is pure. */
export async function runS4(challengeId: string): Promise<S4Result | null> {
  const input = await scoringInputFor(challengeId);
  if (!input) return null;

  const score = computePriority(input);

  await db
    .update(challenges)
    .set({
      priorityScore: score.total.toFixed(3),
      // The whole terms array, so the public breakdown is a record of what was
      // actually computed rather than a re-derivation that might not match.
      priorityBreakdown: { ...score, input },
      scoringVersion: score.version,
      updatedAt: clockNow(),
    })
    .where(eq(challenges.id, challengeId));

  return { input, score };
}

/**
 * Re-score everything under the current weights.
 *
 * Purity is what makes this safe to run nightly, and what lets a state
 * authority change the weights without a redeploy: every row is recomputed from
 * stored inputs and stamped with the new version.
 */
export async function rescoreAll(): Promise<number> {
  const rows = await db.select({ id: challenges.id }).from(challenges);
  let n = 0;
  for (const row of rows) {
    if (await runS4(row.id)) n++;
  }
  return n;
}
