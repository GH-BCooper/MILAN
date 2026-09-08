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
import type { Tx } from "@/lib/db";
import { auditLog, challenges, trainingCorrections } from "@/lib/db/schema";
import type { ChallengeStatus } from "@/lib/db/schema";
import { DOMAINS } from "@/lib/ai/schemas";
import { ROUTING } from "@/lib/ai/routing";
import { requireRole } from "@/lib/auth/guards";
import { transition, canTransition } from "@/lib/db/stateMachine";
import { hasPendingHold } from "./queue";

const MIN_REASON = 12;

/** The spine a confident pipeline walks. A human ruling that clears a hold
 *  re-enters it here, one legal edge at a time — the machine still owns every
 *  transition, and each one still writes its deadlines and ledger entry. */
const HAPPY_PATH: ChallengeStatus[] = [
  "SUBMITTED",
  "TRIAGED",
  "CLASSIFIED",
  "CLUSTERED",
  "PRIORITISED",
  "VERIFIED",
];

/**
 * Step a challenge along the happy path from `from` to `to`, using only legal
 * edges. Branch states off the spine are covered by their own direct edges.
 * Returns the status the challenge actually reached — the walk stops quietly
 * where the machine has no edge, because the ruling itself must never fail.
 */
async function walkHappyPath(
  tx: Tx,
  args: {
    challengeId: string;
    from: ChallengeStatus;
    to: ChallengeStatus;
    actorId: string;
    reason: string;
    meta: Record<string, unknown>;
  },
): Promise<ChallengeStatus> {
  let current = args.from;
  const fromIdx = HAPPY_PATH.indexOf(current);
  const toIdx = HAPPY_PATH.indexOf(args.to);

  if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) {
    // Off the spine, or already at/past the target: only a direct legal edge
    // (e.g. NEEDS_MORE_INFO -> TRIAGED) applies.
    if (fromIdx !== toIdx && canTransition(current, args.to)) {
      await transition(tx, {
        challengeId: args.challengeId,
        to: args.to,
        actorId: args.actorId,
        reason: args.reason,
        meta: args.meta,
      });
      current = args.to;
    }
    return current;
  }

  for (let i = fromIdx; i < toIdx; i++) {
    const from = HAPPY_PATH[i];
    const next = HAPPY_PATH[i + 1];
    if (!from || !next || !canTransition(from, next)) break;
    await transition(tx, {
      challengeId: args.challengeId,
      to: next,
      actorId: args.actorId,
      reason: args.reason,
      meta: args.meta,
    });
    current = next;
  }
  return current;
}

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
    severity: challenge.severity === null ? null : Number(challenge.severity),
    isGrievance: challenge.isGrievance,
  };

  const corrected =
    input.decision === "ACCEPT"
      ? proposed
      : {
          domain: input.domain ?? challenge.domain,
          severity: input.severity ?? (challenge.severity === null ? null : Number(challenge.severity)),
          isGrievance: input.isGrievance ?? challenge.isGrievance,
          isUnsafe: input.isUnsafe ?? false,
        };

  const meta = { by: "admin-triage", decision: input.decision, stage: input.stage };

  let finalStatus: ChallengeStatus = challenge.status;
  let finalSeverity: number | null =
    challenge.severity === null ? null : Number(challenge.severity);

  try {
    await db.transaction(async (tx) => {
      if (input.decision === "OVERRIDE") {
        await tx
          .update(challenges)
          .set({
            domain: corrected.domain,
            severity: corrected.severity === null ? null : corrected.severity.toFixed(2),
            isGrievance: corrected.isGrievance ?? false,
            updatedAt: at,
          })
          .where(eq(challenges.id, challenge.id));
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

      // The human has ruled, so the hold is cleared — the ruling row above is
      // what `hasPendingHold` consults, and it is already visible to this
      // transaction. Now walk the challenge down the same happy path the
      // pipeline would have taken, gated by whichever stages are still
      // waiting on a human (A-03: an S2 accept used to target CLUSTERED,
      // which is never a legal edge from SUBMITTED/TRIAGED, so the walk was
      // silently skipped and the challenge stuck).
      let status: ChallengeStatus = challenge.status;

      if (!(await hasPendingHold(tx, challenge.id, "S1_TRIAGE"))) {
        status = await walkHappyPath(tx, {
          challengeId: challenge.id,
          from: status,
          to: "TRIAGED",
          actorId: user.id,
          reason: input.reason,
          meta,
        });
      }
      if (!(await hasPendingHold(tx, challenge.id, "S2_CLASSIFY"))) {
        status = await walkHappyPath(tx, {
          challengeId: challenge.id,
          from: status,
          to: "VERIFIED",
          actorId: user.id,
          reason: input.reason,
          meta,
        });
      }

      finalStatus = status;
      if (input.decision === "OVERRIDE") finalSeverity = corrected.severity;
    });
  } catch (e) {
    console.error("[triage] failed", e);
    return { ok: false, error: "That could not be saved. Nothing was changed." };
  }

  // Below the human gate the pipeline would have released routing itself as
  // soon as it reached VERIFIED. The admin's ruling re-entered the pipeline
  // path, so it must release here too — releaseGate moves VERIFIED -> ROUTED
  // and sends the offers. At or above the gate it stays at VERIFIED for the
  // District Collector, exactly as a confident run would.
  let released = false;
  if (
    finalStatus === "VERIFIED" &&
    (finalSeverity ?? 0) < ROUTING.humanGateSeverity
  ) {
    try {
      const { releaseGate } = await import("@/lib/ai/stages/s5");
      await releaseGate({
        challengeId: challenge.id,
        trackingId: challenge.trackingId,
        actorId: user.id,
        reason: input.reason,
      });
      released = true;
    } catch (e) {
      // The ruling stands; the challenge is at VERIFIED and the gate UI can
      // release it. Never roll a human decision back over a notification.
      console.error("[triage] routing release failed", e);
    }
  }

  revalidatePath("/admin/triage");
  revalidatePath(`/c/${challenge.trackingId}`);

  const moved =
    finalStatus !== challenge.status
      ? ` It moved ${challenge.status} -> ${finalStatus}${released ? " and was routed" : ""}.`
      : "";

  return {
    ok: true,
    message:
      input.decision === "ACCEPT"
        ? `${challenge.trackingId}: the classification was accepted and recorded as labelled data.${moved}`
        : `${challenge.trackingId}: overridden, with your reason recorded as labelled data.${moved}`,
  };
}
