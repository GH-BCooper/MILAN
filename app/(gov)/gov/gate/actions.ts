"use server";

/**
 * The human gate's three buttons.
 *
 * CLAUDE.md invariant 5: severity at or above 0.70 waits here, and every
 * override is logged with a mandatory reason and becomes labelled training data.
 * That last clause is why `training_corrections` is written on an override and
 * not only `audit_log`: a correction with no record of what the model proposed
 * teaches nothing.
 *
 * The role AND the district are rechecked here. A server action can be called
 * without ever passing through middleware.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireDistrict, requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, challenges, trainingCorrections } from "@/lib/db/schema";
import { transition } from "@/lib/db/stateMachine";

const Input = z.object({
  trackingId: z.string().min(3),
  decision: z.enum(["CONFIRM", "OVERRIDE", "REJECT"]),
  reason: z.string().trim().max(2000).optional(),
  /** Only for OVERRIDE: the corrected severity the officer is asserting. */
  severity: z.coerce.number().min(0).max(1).optional(),
});

export interface GateResult {
  ok: boolean;
  message: string;
}

export async function decideGate(_prev: GateResult | null, form: FormData): Promise<GateResult> {
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");

  const parsed = Input.safeParse({
    trackingId: form.get("trackingId"),
    decision: form.get("decision"),
    reason: form.get("reason") ?? undefined,
    severity: form.get("severity") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "That decision could not be read. Try again." };
  const { trackingId, decision, reason, severity } = parsed.data;

  // A confirmation is an officer agreeing with the machine and needs no essay.
  // An override or a rejection is an officer overruling it, and CLAUDE.md makes
  // the reason mandatory — it is the training signal, not paperwork.
  if (decision !== "CONFIRM" && (!reason || reason.length < 10)) {
    return { ok: false, message: "An override or a rejection needs a written reason of at least ten characters." };
  }

  const [challenge] = await db
    .select({
      id: challenges.id,
      status: challenges.status,
      districtCode: challenges.districtCode,
      severity: challenges.severity,
      domain: challenges.domain,
      hazard: challenges.hazard,
      bodyOriginal: challenges.bodyOriginal,
    })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);

  if (!challenge) return { ok: false, message: "That challenge does not exist." };
  await requireDistrict(challenge.districtCode ?? "");

  const at = clockNow();

  if (decision === "CONFIRM") {
    // VERIFIED, then ROUTED with the notifications released — releaseGate does
    // both, in that order, for the reason recorded in its own doc comment.
    await db.transaction(async (tx) => {
      await transition(tx, {
        challengeId: challenge.id,
        to: "VERIFIED",
        actorId: user.id,
        reason: reason || "Confirmed at the human gate by a district officer.",
        meta: { by: "gov-gate", decision },
      });
    });

    const { releaseGate } = await import("@/lib/ai/stages/s5");
    const released = await releaseGate({ challengeId: challenge.id, trackingId, actorId: user.id, reason: reason ?? null });

    await db.insert(auditLog).values({
      actorId: user.id,
      action: "gov.gate.confirm",
      targetType: "challenge",
      targetId: challenge.id,
      reason: reason ?? null,
      meta: { trackingId, severity: challenge.severity, notified: released.notified },
      createdAt: at,
    });

    revalidatePath("/gov/gate");
    revalidatePath(`/c/${trackingId}`);
    return { ok: true, message: `Released. ${released.notified} notification(s) sent; the challenge is now ${released.status}.` };
  }

  if (decision === "OVERRIDE") {
    await db.transaction(async (tx) => {
      if (severity !== undefined) {
        await tx.update(challenges).set({ severity: severity.toFixed(2), updatedAt: at }).where(eq(challenges.id, challenge.id));
      }
      await tx.insert(trainingCorrections).values({
        challengeId: challenge.id,
        stage: "S1",
        inputText: challenge.bodyOriginal,
        proposed: { severity: challenge.severity, domain: challenge.domain, hazard: challenge.hazard },
        corrected: { severity: severity ?? challenge.severity },
        reason: reason ?? null,
        correctedBy: user.id,
        createdAt: at,
      });
      await tx.insert(auditLog).values({
        actorId: user.id,
        action: "gov.gate.override",
        targetType: "challenge",
        targetId: challenge.id,
        reason: reason ?? null,
        meta: { trackingId, from: challenge.severity, to: severity ?? null },
        createdAt: at,
      });
    });

    revalidatePath("/gov/gate");
    return {
      ok: true,
      message: `Override recorded. The correction is in training_corrections and will inform the embedding prior for the next report like this one.`,
    };
  }

  // REJECT: the officer says this is not a research challenge at all.
  await db.transaction(async (tx) => {
    await transition(tx, {
      challengeId: challenge.id,
      to: "PARKED",
      actorId: user.id,
      reason: reason ?? "Rejected at the human gate.",
      meta: { by: "gov-gate", decision },
    });
    await tx.insert(trainingCorrections).values({
      challengeId: challenge.id,
      stage: "S1",
      inputText: challenge.bodyOriginal,
      proposed: { severity: challenge.severity, route: true },
      corrected: { route: false },
      reason: reason ?? null,
      correctedBy: user.id,
      createdAt: at,
    });
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "gov.gate.reject",
      targetType: "challenge",
      targetId: challenge.id,
      reason: reason ?? null,
      meta: { trackingId },
      createdAt: at,
    });
  });

  revalidatePath("/gov/gate");
  return {
    ok: true,
    message: "Parked, with an automatic annual re-review. Nothing is deleted and the citizen keeps their record.",
  };
}
