"use server";

/**
 * Admin challenge management (item 9a).
 *
 * The platform owner asked for the ability to "modify or delete" challenges —
 * with reasoning enforced. Milan has no DELETE on challenges (the ledger and the
 * SLA invariant both assume the row survives), so "delete" here is a state
 * transition to a terminal state (WITHDRAWN / PARKED / REJECTED_UNSAFE / …) and
 * every move requires a written reason that lands in the ledger and the audit
 * log. Nothing is erased; the trail records who moved it and why.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, challenges, challengeStatusEnum } from "@/lib/db/schema";
import { canTransition, transition } from "@/lib/db/stateMachine";

const MIN_REASON = 15;

const Schema = z.object({
  challengeId: z.string().uuid(),
  to: z.enum(challengeStatusEnum.enumValues),
  reason: z
    .string()
    .trim()
    .min(MIN_REASON, `Give a reason in at least ${MIN_REASON} characters — it goes on the record.`)
    .max(1000),
});

export type AdminTransitionResult = { ok: true; message: string } | { ok: false; error: string };

export async function adminTransitionAction(raw: unknown): Promise<AdminTransitionResult> {
  const user = await requireRole("ADMIN");

  const parsed = Schema.safeParse(raw);
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

  if (!canTransition(challenge.status, input.to)) {
    return {
      ok: false,
      error: `${challenge.status.replaceAll("_", " ")} cannot move to ${input.to.replaceAll("_", " ")}.`,
    };
  }

  const at = clockNow();
  try {
    await db.transaction(async (tx) => {
      await transition(tx, {
        challengeId: challenge.id,
        to: input.to,
        actorId: user.id,
        reason: input.reason,
        meta: { adminOverride: true, by: user.email },
      });
      await tx.insert(auditLog).values({
        actorId: user.id,
        action: "ADMIN_CHALLENGE_TRANSITION",
        targetType: "challenge",
        targetId: challenge.id,
        reason: input.reason,
        meta: { trackingId: challenge.trackingId, from: challenge.status, to: input.to },
        createdAt: at,
      });
    });
  } catch (e) {
    console.error("[admin/challenges] transition failed", e);
    return { ok: false, error: "That could not be saved. Nothing was changed." };
  }

  revalidatePath("/admin/challenges");
  revalidatePath(`/c/${challenge.trackingId}`);
  return {
    ok: true,
    message: `${challenge.trackingId}: ${challenge.status.replaceAll("_", " ")} → ${input.to.replaceAll("_", " ")}. Reason recorded.`,
  };
}
