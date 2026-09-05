/**
 * Everything an action needs that must NOT happen inside its transaction.
 *
 * Two of the ladder rungs are not pure bookkeeping: WIDEN re-runs the S5
 * ranking, and ANNUAL_REVIEW rescores under the current weights. Ranking touches
 * the capability graph and, for the reason sentence, a model. Holding a row lock
 * across a provider call would be a self-inflicted outage on stage, so all of it
 * happens here first and the result is handed to the action as plain data.
 *
 * Invariant 3 again, from the other direction: the model contributes a sentence.
 * The ranking, the exclusion of the institutions already asked, and the decision
 * to escalate at all are deterministic TypeScript.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges, routes } from "@/lib/db/schema";
import type { ActionPrep, ChallengeRow, DeadlineRow } from "./actions";

/** How many more institutions the WIDEN rung reaches. Task 3.2: "the next five". */
const WIDEN_TO = 5;

export async function prepareFor(deadline: DeadlineRow, challenge: ChallengeRow): Promise<ActionPrep> {
  if (deadline.kind === "WIDEN" || deadline.kind === "CLAIM_WINDOW") {
    return { widenOffers: await widenShortlist(challenge) };
  }
  if (deadline.kind === "ANNUAL_REVIEW") {
    return { rescored: await rescore(challenge.id) };
  }
  return {};
}

/**
 * The next five, excluding everyone already asked.
 *
 * Falls back to an empty list rather than throwing. A challenge that cannot be
 * re-ranked (no embedding, no capability graph, no network) still escalates:
 * the status still moves to UNCLAIMED_ESCALATED, the clock still runs, and the
 * OPEN_ALL rung fourteen days later opens it to everyone anyway. The escalation
 * is the guarantee; the shortlist is the optimisation.
 */
async function widenShortlist(challenge: ChallengeRow): Promise<ActionPrep["widenOffers"]> {
  try {
    const already = await db
      .select({ orgId: routes.orgId })
      .from(routes)
      .where(eq(routes.challengeId, challenge.id));
    const excluded = new Set(already.map((r) => r.orgId));

    const [row] = await db
      .select({
        embedding: challenges.embedding,
        lat: challenges.lat,
        lng: challenges.lng,
        domain: challenges.domain,
        hazard: challenges.hazard,
      })
      .from(challenges)
      .where(eq(challenges.id, challenge.id))
      .limit(1);
    if (!row?.embedding) return [];

    const s5 = await import("@/lib/ai/stages/s5");
    await s5.ensureCapabilityEmbeddings();
    const [pool, trackRecord] = await Promise.all([s5.loadCapabilities(), s5.trackRecordFor(row.domain)]);

    const scored = pool
      .filter((c) => !excluded.has(c.orgId))
      .map((capability) =>
        s5.matchScore(capability, {
          embedding: row.embedding as number[],
          domain: row.domain,
          hazard: row.hazard,
          lat: row.lat === null ? null : Number(row.lat),
          lng: row.lng === null ? null : Number(row.lng),
          trackRecord,
          now: clockNow(),
        }),
      );

    const picked = s5.shortlist(scored, WIDEN_TO);
    const reasons = await Promise.all(picked.map((m) => s5.writeReason(s5.reasonInputFor(m), challenge.id)));

    return picked.map((m, i) => ({
      orgId: m.capability.orgId,
      capabilityId: m.capability.id,
      // Ranks continue from the original shortlist rather than restarting at 1:
      // being asked fourth is a different fact from being asked first.
      rank: 3 + i + 1,
      matchScore: m.score,
      reasonText: reasons[i]?.text ?? s5.templateReason(s5.reasonInputFor(m)),
      reasonTerms: {
        version: s5.MATCH_VERSION,
        terms: [...m.terms].filter((t) => t.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3),
        guardrailFallback: reasons[i]?.guarded ?? true,
        widened: true,
      },
    }));
  } catch (e) {
    console.error("[sla/prepare] widen shortlist failed, escalating without one:", (e as Error).message);
    return [];
  }
}

async function rescore(challengeId: string): Promise<ActionPrep["rescored"]> {
  try {
    const { scoringInputFor } = await import("@/lib/ai/stages/s4");
    const { computePriority } = await import("@/packages/scoring");
    const input = await scoringInputFor(challengeId);
    if (!input) return null;
    const score = computePriority(input);
    return { priorityScore: score.total, breakdown: { ...score, input }, version: score.version };
  } catch (e) {
    console.error("[sla/prepare] rescore failed:", (e as Error).message);
    return null;
  }
}

