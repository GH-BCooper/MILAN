"use server";

/**
 * Field verification by a block officer.
 *
 * `official_endorsed` is a 0.06 term in the priority score. That is small on
 * purpose — an official's signature should nudge a queue, never own it — but it
 * is real, so the page shows the score before and after and this action is what
 * moves it. The recomputation goes through S4, which is the same pure scoring
 * package everything else uses; there is no second scoring path.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireDistrict, requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, challenges } from "@/lib/db/schema";
import { appendEntry } from "@/lib/ledger/append";

const Input = z.object({
  trackingId: z.string().min(3),
  note: z.string().trim().min(10, "Say what you saw.").max(2000),
  photoKey: z.string().trim().max(400).optional(),
});

export interface VerifyResult {
  ok: boolean;
  message: string;
  before?: number | null;
  after?: number | null;
}

export async function endorseChallenge(_prev: VerifyResult | null, form: FormData): Promise<VerifyResult> {
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");

  const parsed = Input.safeParse({
    trackingId: form.get("trackingId"),
    note: form.get("note"),
    photoKey: form.get("photoKey") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That could not be read." };
  }
  const { trackingId, note, photoKey } = parsed.data;

  const [c] = await db
    .select({ id: challenges.id, districtCode: challenges.districtCode, priorityScore: challenges.priorityScore, endorsed: challenges.officialEndorsed })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);
  if (!c) return { ok: false, message: "That challenge does not exist." };
  await requireDistrict(c.districtCode ?? "");

  if (c.endorsed) {
    return { ok: false, message: "This has already been verified in the field. An endorsement is not repeatable." };
  }

  const before = c.priorityScore === null ? null : Number(c.priorityScore);
  const at = clockNow();

  await db.transaction(async (tx) => {
    await tx
      .update(challenges)
      .set({ officialEndorsed: true, endorsedBy: user.id, updatedAt: at })
      .where(eq(challenges.id, c.id));

    await appendEntry(tx, {
      challengeId: c.id,
      kind: "STATE_CHANGE",
      authorId: user.id,
      at,
      payload: {
        event: "FIELD_VERIFIED",
        trackingId,
        note,
        photoKey: photoKey ?? null,
        officer: user.fullName,
        district: c.districtCode,
        at: at.toISOString(),
      },
    });

    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "gov.verification.endorse",
      targetType: "challenge",
      targetId: c.id,
      reason: note,
      meta: { trackingId, photoKey: photoKey ?? null },
      createdAt: at,
    });
  });

  // Rescore through the one scoring path. official_endorsed is worth 0.06.
  const { runS4 } = await import("@/lib/ai/stages/s4");
  const rescored = await runS4(c.id);
  const after = rescored?.score.total ?? before;

  revalidatePath("/gov/verification");
  revalidatePath(`/c/${trackingId}`);

  return {
    ok: true,
    message: `Verified in the field. Priority moved from ${before?.toFixed(3) ?? "unscored"} to ${after?.toFixed(3) ?? "unscored"} — the official endorsement term is 0.06 of the total, and the whole breakdown is public.`,
    before,
    after,
  };
}
