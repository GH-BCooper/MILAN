"use server";

/**
 * Accepting or overriding an AI proposal.
 *
 * Both write a `training_corrections` row. Both demand a written reason —
 * "every override is logged with a mandatory reason and becomes labelled
 * training data" is a claim we make on stage, and the mandatory part is
 * enforced here rather than asked for in the UI.
 *
 * An accept is labelled data too: knowing the model was right on a case it was
 * unsure about is worth as much to the kNN prior as knowing it was wrong.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, challenges, trainingCorrections } from "@/lib/db/schema";
import { DOMAINS, HAZARDS } from "@/lib/ai/schemas";
import { requireRole } from "@/lib/auth/guards";
import { transition, canTransition } from "@/lib/db/stateMachine";

const MIN_REASON = 12;

const BaseSchema = z.object({
  challengeId: z.string().uuid(),
  stage: z.enum(["S1_TRIAGE", "S2_CLASSIFY"]),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  reason: z
    .string()
    .trim()
    .min(MIN_REASON, `Say why in at least ${MIN_REASON} characters. This becomes training data.`)
    .max(1000),
});

const AcceptSchema = BaseSchema.extend({ decision: z.literal("ACCEPT") });

const OverrideSchema = BaseSchema.extend({
  decision: z.literal("OVERRIDE"),
  domain: z.enum(DOMAINS).nullable().default(null),
  hazard: z.enum(HAZARDS).nullable().default(null),
  severity: z.number().min(0).max(1).nullable().default(null),
  isGrievance: z.boolean().nullable().default(null),
  isUnsafe: z.boolean().nullable().default(null),
});

export type TriageResult = { ok: true; message: string } | { ok: false; error: string };

export async function resolveTriageAction(raw: unknown): Promise<TriageResult> {
  const user = await requireRole("ADMIN");

  const parsed = z.discriminatedUnion("decision", [AcceptSchema, OverrideSchema]).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That form could not be read." };
  }
  const input = parsed.data;

  const [challenge] = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      status: challenges.status,
      domain: challenges.domain,
      hazard: challenges.hazard,
      severity: challenges.severity,
      isGrievance: challenges.isGrievance,
    })
    .from(challenges)
    .where(eq(challenges.id, input.challengeId))
    .limit(1);

  if (!challenge) return { ok: false, error: "That challenge no longer exists." };

  const at = clockNow();
  const proposed = {
    domain: challenge.domain,
    hazard: challenge.hazard,
    severity: challenge.severity === null ? null : Number(challenge.severity),
    isGrievance: challenge.isGrievance,
  };

  const corrected =
    input.decision === "ACCEPT"
      ? proposed
      : {
          domain: input.domain ?? challenge.domain,
          hazard: input.hazard ?? challenge.hazard,
          severity: input.severity ?? (challenge.severity === null ? null : Number(challenge.severity)),
          isGrievance: input.isGrievance ?? challenge.isGrievance,
          isUnsafe: input.isUnsafe ?? false,
        };

  try {
    await db.transaction(async (tx) => {
      if (input.decision === "OVERRIDE") {
        await tx
          .update(challenges)
          .set({
            domain: corrected.domain,
            hazard: corrected.hazard,
            severity: corrected.severity === null ? null : corrected.severity.toFixed(2),
            isGrievance: corrected.isGrievance ?? false,
            updatedAt: at,
          })
          .where(eq(challenges.id, challenge.id));
      }

      // The human has ruled, so the item is no longer held. It moves on down
      // the same happy path the pipeline would have taken it: the human
      // replaces the confidence, not the state machine.
      const next = input.stage === "S1_TRIAGE" ? "TRIAGED" : "CLUSTERED";
      if (canTransition(challenge.status, next)) {
        await transition(tx, {
          challengeId: challenge.id,
          to: next,
          actorId: user.id,
          reason: input.reason,
          meta: { by: "admin-triage", decision: input.decision, stage: input.stage },
        });
      }

      await tx.insert(trainingCorrections).values({
        challengeId: challenge.id,
        stage: input.stage,
        inputHash: input.inputHash,
        proposed,
        corrected,
        reason: input.reason,
        correctedBy: user.id,
        createdAt: at,
      });

      await tx.insert(auditLog).values({
        actorId: user.id,
        action: input.decision === "ACCEPT" ? "TRIAGE_ACCEPT" : "TRIAGE_OVERRIDE",
        targetType: "challenge",
        targetId: challenge.id,
        reason: input.reason,
        meta: { stage: input.stage, trackingId: challenge.trackingId, proposed, corrected },
        createdAt: at,
      });
    });
  } catch (e) {
    console.error("[triage] failed", e);
    return { ok: false, error: "That could not be saved. Nothing was changed." };
  }

  revalidatePath("/admin/triage");
  revalidatePath(`/c/${challenge.trackingId}`);

  return {
    ok: true,
    message:
      input.decision === "ACCEPT"
        ? `${challenge.trackingId}: the classification was accepted and recorded as labelled data.`
        : `${challenge.trackingId}: overridden, with your reason recorded as labelled data.`,
  };
}
