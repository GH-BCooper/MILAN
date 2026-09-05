"use server";

/**
 * Re-routing a challenge by hand.
 *
 * The escape hatch that makes the automated routing safe to trust: when the
 * match score gets it wrong, a human can send the problem to the right
 * department — and the correction is recorded with a mandatory reason and
 * becomes labelled data, exactly like a triage override.
 *
 * It is not a back door. The existing offers are expired rather than deleted,
 * the new offer is a normal route row with rank 1, the ledger records the
 * override, and the challenge page shows the new shortlist with the same
 * "why you" sentence — except this one says a person chose it.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { clockNow, clockPlusDays } from "@/lib/clock";
import { db } from "@/lib/db";
import { appendEntry } from "@/lib/ledger/append";
import {
  auditLog,
  capabilities,
  challenges,
  organization,
  routes,
  trainingCorrections,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { ROUTING } from "@/lib/ai/routing";
import { releaseNotifications } from "@/lib/ai/stages/s5";

const MIN_REASON = 15;

const RerouteSchema = z.object({
  challengeId: z.string().uuid(),
  capabilityId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(MIN_REASON, `Say why in at least ${MIN_REASON} characters. This becomes labelled data.`)
    .max(1000),
  /** Expire the automatic shortlist, or leave it alongside the new offer. */
  replaceExisting: z.boolean().default(true),
});

export type RerouteResult = { ok: true; message: string } | { ok: false; error: string };

export async function rerouteAction(raw: unknown): Promise<RerouteResult> {
  const user = await requireRole("ADMIN");

  const parsed = RerouteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That form could not be read." };
  }
  const input = parsed.data;

  const [challenge] = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId, status: challenges.status })
    .from(challenges)
    .where(eq(challenges.id, input.challengeId))
    .limit(1);
  if (!challenge) return { ok: false, error: "That challenge does not exist." };

  const [capability] = await db
    .select({
      id: capabilities.id,
      orgId: capabilities.orgId,
      department: capabilities.department,
      labName: capabilities.labName,
      orgName: organization.name,
    })
    .from(capabilities)
    .innerJoin(organization, eq(organization.id, capabilities.orgId))
    .where(eq(capabilities.id, input.capabilityId))
    .limit(1);
  if (!capability) return { ok: false, error: "That department does not exist." };

  const existing = await db
    .select({ id: routes.id, orgId: routes.orgId, rank: routes.rank, matchScore: routes.matchScore })
    .from(routes)
    .where(and(eq(routes.challengeId, challenge.id), eq(routes.state, "OFFERED")));

  if (existing.some((r) => r.orgId === capability.orgId)) {
    return { ok: false, error: "That institution already has an open offer for this challenge." };
  }

  const at = clockNow();
  const claimWindowEndsAt = clockPlusDays(ROUTING.claimWindowDays);

  try {
    await db.transaction(async (tx) => {
      if (input.replaceExisting && existing.length > 0) {
        await tx
          .update(routes)
          .set({ state: "EXPIRED" })
          .where(and(eq(routes.challengeId, challenge.id), eq(routes.state, "OFFERED")));
      }

      await tx.insert(routes).values({
        challengeId: challenge.id,
        orgId: capability.orgId,
        capabilityId: capability.id,
        rank: 1,
        matchScore: null,
        // The reason sentence says a person chose this, because that is the
        // truth and because a professor deserves to know an algorithm did not.
        reasonText:
          `Routed to ${capability.orgName}, ${capability.department}` +
          `${capability.labName ? ` — ${capability.labName}` : ""} by a Milan administrator: ${input.reason}`,
        reasonTerms: {
          version: "manual",
          manualOverride: true,
          by: user.email,
          reason: input.reason,
          replacedRanks: existing.map((r) => r.rank),
        },
        notifiedAt: null,
        claimWindowEndsAt,
        state: "OFFERED",
        createdAt: at,
      });

      await appendEntry(tx, {
        challengeId: challenge.id,
        kind: "OVERRIDE",
        authorId: user.id,
        at,
        payload: {
          action: "REROUTE",
          to: { orgId: capability.orgId, org: capability.orgName, department: capability.department },
          replaced: existing.length,
          reason: input.reason,
          at: at.toISOString(),
        },
      });

      await tx.insert(auditLog).values({
        actorId: user.id,
        action: "ROUTING_OVERRIDE",
        targetType: "challenge",
        targetId: challenge.id,
        reason: input.reason,
        meta: {
          trackingId: challenge.trackingId,
          to: capability.orgName,
          department: capability.department,
          replacedRanks: existing.map((r) => r.rank),
        },
        createdAt: at,
      });

      // A routing override is a correction to the match score, so it lands in
      // the same training set as a classification override.
      await tx.insert(trainingCorrections).values({
        challengeId: challenge.id,
        stage: "S5_ROUTING",
        inputText: null,
        inputHash: null,
        proposed: { shortlist: existing.map((r) => ({ orgId: r.orgId, rank: r.rank, matchScore: r.matchScore })) },
        corrected: { orgId: capability.orgId, department: capability.department },
        reason: input.reason,
        correctedBy: user.id,
        createdAt: at,
      });
    });

    const sent = await releaseNotifications(challenge.id, challenge.trackingId);

    revalidatePath("/admin/routing");
    revalidatePath(`/c/${challenge.trackingId}`);

    return {
      ok: true,
      message:
        `${challenge.trackingId} re-routed to ${capability.orgName}, ${capability.department}. ` +
        `${sent} notification(s) sent, and the reason is on the record.`,
    };
  } catch (e) {
    console.error("[admin/routing] reroute failed", e);
    return { ok: false, error: "That could not be saved. Nothing was changed." };
  }
}
