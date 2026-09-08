"use server";

import { z } from "zod";

import { ForbiddenError, requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { appendEntry } from "@/lib/ledger/append";
import { challenges, creditEdges, domainEnum, outbox } from "@/lib/db/schema";
import { nextTrackingId } from "@/lib/db/trackingId";
import { deriveTitle } from "@/app/(citizen)/submit/schema";

const SubmitQuestionSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(120),
  designation: z.string().trim().min(2, "Say what your role is there.").max(160),
  tag: z.enum(domainEnum.enumValues),
  qualification: z.string().trim().min(10, "Say briefly why you're placed to work on this.").max(500),
  question: z.string().trim().min(40, "Describe the question in at least 40 characters.").max(5000),
});

export type SubmitQuestionResult =
  | { ok: true; trackingId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * A university or industry submission — a proposed research question, not a
 * citizen's on-the-ground problem. It still lands in `challenges` and flows
 * through the same routing/ledger pipeline (CLAUDE.md invariant 3), because a
 * university's problem statement deserves the same clock and the same
 * unerasable credit as a citizen's, not a parallel, lesser-tracked table.
 */
export async function submitQuestionAction(raw: unknown): Promise<SubmitQuestionResult> {
  const user = await requireRole("HEI_MEMBER", "INDUSTRY").catch((e) => {
    if (e instanceof ForbiddenError) return null;
    throw e;
  });
  if (!user) return { ok: false, error: "Only signed-in university or industry accounts can submit a question." };

  const parsed = SubmitQuestionSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return { ok: false, error: "Some answers are missing or too short.", fieldErrors: flat.fieldErrors as Record<string, string[]> };
  }
  const input = parsed.data;
  const now = clockNow();
  const title = deriveTitle(input.question);
  const bodyOriginal = `${input.question}\n\nSubmitted by: ${input.name}, ${input.designation} (${user.role === "HEI_MEMBER" ? "university" : "industry"})\nQualification: ${input.qualification}`;

  const trackingId = await db.transaction(async (tx) => {
    const trackingId = await nextTrackingId(tx, user.districtCode);

    const [challenge] = await tx
      .insert(challenges)
      .values({
        trackingId,
        status: "SUBMITTED",
        title,
        bodyOriginal,
        bodyLang: "en",
        bodyEn: bodyOriginal,
        domain: input.tag,
        reporterId: user.id,
        reporterName: input.name,
        districtCode: user.districtCode,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: challenges.id });

    await tx.insert(creditEdges).values({
      challengeId: challenge.id,
      toUserId: user.id,
      relation: "ORIGINATOR",
      declaredRole: input.designation,
      createdAt: now,
    });

    await appendEntry(tx, {
      challengeId: challenge.id,
      kind: "PROBLEM_TEXT",
      authorId: user.id,
      at: now,
      payload: {
        trackingId,
        source: user.role === "HEI_MEMBER" ? "university" : "industry",
        reporterName: input.name,
        at: now.toISOString(),
      },
    });

    await tx.insert(outbox).values({
      topic: "challenge.submitted",
      payload: { challengeId: challenge.id, trackingId, districtCode: user.districtCode },
      createdAt: now,
    });

    return trackingId;
  });

  return { ok: true, trackingId };
}
