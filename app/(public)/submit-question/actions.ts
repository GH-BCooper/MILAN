"use server";

import { after } from "next/server";
import { z } from "zod";

import { ForbiddenError, requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { appendEntry } from "@/lib/ledger/append";
import { challenges, creditEdges, domainEnum, outbox, slaDeadlines } from "@/lib/db/schema";
import { deadlinesFor } from "@/lib/sla/deadlines";
import { nextTrackingId } from "@/lib/db/trackingId";
import { deriveTitle } from "@/app/(citizen)/submit/schema";
import { inflightPromise, runOnce } from "@/lib/ai/inflight";
import { runPipeline } from "@/lib/ai/pipeline";

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

  const submitted = await db.transaction(async (tx) => {
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

    /**
     * CLAUDE.md invariant 1: no challenge may silently die. A university or
     * industry question lands in SUBMITTED exactly like a citizen report, so it
     * needs the same intake clock — without this row it sits in a non-terminal
     * state with nothing scheduled to notice, which is the precise failure the
     * invariant test catches. `transition()` cancels and replaces it when the
     * report moves on. See app/(citizen)/submit/actions.ts for the twin.
     */
    const intakeDeadlines = deadlinesFor("SUBMITTED", { now });
    if (intakeDeadlines.length > 0) {
      await tx.insert(slaDeadlines).values(
        intakeDeadlines.map((s) => ({
          challengeId: challenge.id,
          kind: s.kind,
          dueAt: s.dueAt,
          payload: s.payload ?? {},
          createdAt: now,
        })),
      );
    }

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

    return { trackingId, challengeId: challenge.id };
  });

  /**
   * Unlike a citizen report — whose success page passes `autoStart` to
   * PipelineTrace — this flow redirects straight to the public /c/[trackingId]
   * page, which only offers a privileged *replay*, never an initial run. Left
   * as-is, a university/industry question sat at SUBMITTED forever: no S1..S4
   * pass meant no routes row, so it never reached /hei/inbox or the challenge
   * bank. Start it the same way app/api/pipeline/run/route.ts does — fire the
   * background run now, and hold this invocation open (Fluid Compute) until
   * it settles, without blocking the redirect on the LLM round trip.
   */
  runOnce(submitted.challengeId, () => runPipeline(submitted.challengeId, async () => undefined));
  const tracked = inflightPromise(submitted.challengeId);
  if (tracked) {
    after(async () => {
      await tracked;
    });
  }

  return { ok: true, trackingId: submitted.trackingId };
}
