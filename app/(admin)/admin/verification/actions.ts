"use server";

/**
 * Approving or rejecting a proof of affiliation.
 *
 * Mirrors app/(admin)/admin/triage/actions.ts: a written reason is mandatory
 * on both paths (CLAUDE.md invariant 5's "mandatory reason" pattern, applied
 * here to org verification rather than the severity gate), and the decision
 * is what actually flips lib/auth/guards.ts requireRole()'s gate for that
 * account's /hei or /industry pages.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, userProfiles } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { notify } from "@/lib/notify";

const MIN_REASON = 8;

const DecisionSchema = z.object({
  userId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z
    .string()
    .trim()
    .min(MIN_REASON, `Say why in at least ${MIN_REASON} characters.`)
    .max(1000),
});

export type VerificationDecisionResult = { ok: true; message: string } | { ok: false; error: string };

export async function decideVerificationAction(raw: unknown): Promise<VerificationDecisionResult> {
  const admin = await requireRole("ADMIN");
  const parsed = DecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That form could not be read." };
  }
  const input = parsed.data;

  const [target] = await db
    .select({ fullName: userProfiles.fullName, orgVerificationStatus: userProfiles.orgVerificationStatus })
    .from(userProfiles)
    .where(eq(userProfiles.userId, input.userId))
    .limit(1);
  if (!target) return { ok: false, error: "That account no longer exists." };
  if (target.orgVerificationStatus !== "PENDING") {
    return { ok: false, error: "This has already been decided." };
  }

  const at = clockNow();
  const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";

  await db.transaction(async (tx) => {
    await tx
      .update(userProfiles)
      .set({
        orgVerificationStatus: status,
        orgVerificationReason: input.reason,
        orgVerificationDecidedBy: admin.id,
        orgVerificationDecidedAt: at,
      })
      .where(eq(userProfiles.userId, input.userId));

    await tx.insert(auditLog).values({
      actorId: admin.id,
      action: input.decision === "APPROVE" ? "ORG_VERIFICATION_APPROVE" : "ORG_VERIFICATION_REJECT",
      targetType: "user",
      targetId: input.userId,
      reason: input.reason,
      meta: { fullName: target.fullName },
      createdAt: at,
    });
  });

  await notify({
    userId: input.userId,
    kind: "ORG_VERIFICATION_DECIDED",
    title: input.decision === "APPROVE" ? "Your account is verified" : "Your proof of affiliation was not accepted",
    body:
      input.decision === "APPROVE"
        ? "An admin approved your proof of affiliation. The university/industry tools are now open."
        : `An admin could not confirm your proof of affiliation: ${input.reason}`,
    actionUrl: "/verify-account/pending",
    channels: ["inapp", "email"],
  });

  revalidatePath("/admin/verification");

  return {
    ok: true,
    message:
      input.decision === "APPROVE"
        ? `${target.fullName}'s account is approved.`
        : `${target.fullName}'s account was rejected, with your reason recorded.`,
  };
}
