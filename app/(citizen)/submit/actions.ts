"use server";

import { headers } from "next/headers";

import { currentUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { appendEntry } from "@/lib/ledger/append";
import { checkSubmissionRate, recordSubmission } from "@/lib/db/rateLimit";
import { challengeMedia, challenges, creditEdges, outbox } from "@/lib/db/schema";
import { nextTrackingId } from "@/lib/db/trackingId";
import { MediaRejectedError, processImage } from "@/lib/media/upload";
import { putObject } from "@/lib/media/storage";
import { runP1 } from "@/lib/ai/stages/p1_framing";
import { blocks, districts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MIN_BODY_CHARS, SubmitSchema, bucketMidpoint, deriveTitle } from "./schema";

const FramingRequestSchema = z.object({
  bodyOriginal: z.string().trim().min(MIN_BODY_CHARS).max(5000),
  bodyLang: z.enum(["hi", "en"]),
  districtCode: z.string().trim().min(1).nullable().default(null),
  blockCode: z.string().trim().min(1).nullable().default(null),
});

export type UploadResult =
  | { ok: true; storageKey: string; contentHash: string; mime: string; bytes: number; previewUrl: string | null }
  | { ok: false; error: string };

/**
 * Upload one photo.
 *
 * The bytes go through the server rather than straight from the browser to
 * Supabase, because EXIF stripping has to happen somewhere the citizen cannot
 * skip. A presigned direct upload would be faster and would also hand us the
 * camera's GPS coordinates, which we have no business keeping.
 */
export async function uploadEvidenceAction(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was received." };

  try {
    const processed = await processImage(Buffer.from(await file.arrayBuffer()), file.type);
    const stored = await putObject(processed.storageKey, processed.bytes, processed.mime);

    if (!stored) {
      return {
        ok: false,
        error: "The photo could not be stored right now. You can submit without it.",
      };
    }

    return {
      ok: true,
      storageKey: processed.storageKey,
      contentHash: processed.contentHash,
      mime: processed.mime,
      bytes: processed.bytes.byteLength,
      previewUrl: stored.publicUrl,
    };
  } catch (e) {
    if (e instanceof MediaRejectedError) return { ok: false, error: e.message };
    console.error("[submit] upload failed", e);
    return { ok: false, error: "That photo could not be processed. You can submit without it." };
  }
}

/* ----------------------------------------------------- the framing proposal */

export type FramingResult =
  | {
      ok: true;
      framedStatement: string;
      successCriteria: string;
      confidence: number;
      provider: string;
      fallbackLevel: number;
    }
  | { ok: false; error: string };

/**
 * Ask the AI to propose a clearer statement of the problem.
 *
 * Called from step 5 of the wizard, before the challenge exists. Nothing is
 * written anywhere: the proposal goes back to the browser, the citizen edits it
 * or rejects it, and only what they approve is submitted.
 *
 * A failure here is never fatal. The wizard keeps the citizen's own text, says
 * the suggestion could not be produced, and the report is submitted exactly as
 * they wrote it — which is the correct outcome, not a degraded one.
 */
export async function proposeFramingAction(raw: unknown): Promise<FramingResult> {
  const parsed = FramingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "We could not read that text." };
  }

  const user = await currentUser();
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? null;

  // The same counter the submission itself uses. Asking for a rewrite is a
  // model call, so it is not free to anyone who wants to spend our budget.
  const verdict = await checkSubmissionRate({ ip, userId: user?.id ?? null });
  if (!verdict.allowed) {
    return { ok: false, error: "Too many requests just now. Your own wording will be used." };
  }

  try {
    const [district, block] = await Promise.all([
      parsed.data.districtCode
        ? db
            .select({ name: districts.name })
            .from(districts)
            .where(eq(districts.code, parsed.data.districtCode))
            .limit(1)
        : Promise.resolve([]),
      parsed.data.blockCode
        ? db
            .select({ name: blocks.name })
            .from(blocks)
            .where(eq(blocks.code, parsed.data.blockCode))
            .limit(1)
        : Promise.resolve([]),
    ]);

    const run = await runP1({
      bodyOriginal: parsed.data.bodyOriginal,
      // Before submission there is no translation yet, so the model reads the
      // citizen's own text. It answers in English either way.
      bodyEn: parsed.data.bodyOriginal,
      districtName: district[0]?.name ?? null,
      blockName: block[0]?.name ?? null,
    });

    return {
      ok: true,
      framedStatement: run.value.framed_statement,
      successCriteria: run.value.success_criteria,
      confidence: run.value.confidence,
      provider: run.meta.provider,
      fallbackLevel: run.meta.fallbackLevel,
    };
  } catch (e) {
    console.error("[submit] framing failed", e);
    return {
      ok: false,
      error: "We could not suggest a wording just now. Your own words will be used.",
    };
  }
}

export type SubmitResult =
  | { ok: true; trackingId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Create the challenge.
 *
 * One transaction: the challenge row, its media rows, the ORIGINATOR credit
 * edge, the PROBLEM_TEXT ledger entry, the outbox event and the rate-limit
 * record are written together or not at all. If the ledger can disagree with
 * the challenge table, the whole provenance claim collapses.
 */
export async function submitChallengeAction(raw: unknown): Promise<SubmitResult> {
  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      ok: false,
      error: "Some answers are missing or too short.",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  const user = await currentUser();
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? null;

  const verdict = await checkSubmissionRate({ ip, userId: user?.id ?? null });
  if (!verdict.allowed) {
    return {
      ok: false,
      error: `You have submitted ${verdict.used} reports in the last hour. Please try again later, or call the district helpline if this is urgent.`,
    };
  }

  const now = clockNow();

  /**
   * Task 2.7: nothing is stored as `framed_statement` unless the citizen ticked
   * approval. Enforced here, on the server, and not only in the wizard — a
   * caller can post to /api/intake directly, and an AI rewrite that nobody
   * approved must not be able to become the official statement of someone
   * else's problem that way.
   *
   * Declining is not a failure and not an absence: `framing_approved_by_citizen`
   * stays false, their own wording stands, and the challenge page says so.
   */
  const framedStatement = input.framingApprovedByCitizen ? input.framedStatement : null;

  // The title still comes from the approved framing when there is one, because
  // a research-ready first line is what a list of challenges needs. Without
  // approval it is the citizen's own first clause, as in Phase 1.
  const title = framedStatement ? deriveTitle(framedStatement) : deriveTitle(input.bodyOriginal);
  // The citizen wrote in English, so the English working copy is their own
  // words. Written in Hindi, body_en stays null until Phase 2 S0 translates —
  // and body_original is never overwritten either way.
  const bodyEn = input.bodyLang === "en" ? input.bodyOriginal : null;

  try {
    const trackingId = await db.transaction(async (tx) => {
      const trackingId = await nextTrackingId(tx, input.districtCode);

      const [challenge] = await tx
        .insert(challenges)
        .values({
          trackingId,
          status: "SUBMITTED",
          title,
          bodyOriginal: input.bodyOriginal,
          bodyLang: input.bodyLang,
          bodyEn,
          framedStatement,
          successCriteria: input.successCriteria,
          framingApprovedByCitizen: input.framingApprovedByCitizen,
          reporterId: user?.id ?? null,
          reporterName: input.reporterName ?? user?.fullName ?? null,
          districtCode: input.districtCode,
          blockCode: input.blockCode,
          lat: input.lat === null ? null : String(input.lat),
          lng: input.lng === null ? null : String(input.lng),
          locationAccuracyM: input.locationAccuracyM,
          peopleAffected: bucketMidpoint(input.peopleAffectedBucket),
          recurrence: input.recurrence,
          urgencySelfReport: input.urgencySelfReport,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: challenges.id });

      if (input.media.length > 0) {
        await tx.insert(challengeMedia).values(
          input.media.map((m) => ({
            challengeId: challenge.id,
            storageKey: m.storageKey,
            contentHash: m.contentHash,
            mime: m.mime,
            bytes: m.bytes,
            exifStripped: m.exifStripped,
            // Declared stub: blurring is not implemented, and we record that
            // honestly rather than claiming it.
            facesBlurred: false,
            consentGiven: m.consentGiven,
            createdAt: now,
          })),
        );
      }

      await tx.insert(creditEdges).values({
        challengeId: challenge.id,
        toUserId: user?.id ?? null,
        relation: "ORIGINATOR",
        declaredRole: input.reporterName ?? user?.fullName ?? "Anonymous reporter",
        createdAt: now,
      });

      // TODO(Phase 3 Task 3.4): link prev_hash/entry_hash to the chain tip
      // inside this transaction. The append-only trigger permits exactly one
      // write of those two columns, from NULL.
      await appendEntry(tx, {
        challengeId: challenge.id,
        kind: "PROBLEM_TEXT",
        authorId: user?.id ?? null,
        at: now,
        payload: {
          trackingId,
          source: "web",
          bodyLang: input.bodyLang,
          reporterName: input.reporterName ?? user?.fullName ?? null,
          mediaHashes: input.media.map((m) => m.contentHash),
          at: now.toISOString(),
        },
      });

      await tx.insert(outbox).values({
        topic: "challenge.submitted",
        payload: { challengeId: challenge.id, trackingId, districtCode: input.districtCode },
        createdAt: now,
      });

      await recordSubmission(tx, {
        ip,
        userId: user?.id ?? null,
        challengeId: challenge.id,
        trackingId,
      });

      return trackingId;
    });

    return { ok: true, trackingId };
  } catch (e) {
    console.error("[submit] failed", e);
    return {
      ok: false,
      error: "We could not save your report. Nothing was lost — try submitting again.",
    };
  }
}
