"use server";

import { headers } from "next/headers";

import { currentUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { checkSubmissionRate, recordSubmission } from "@/lib/db/rateLimit";
import { challengeMedia, challenges, creditEdges, ledgerEntries, outbox } from "@/lib/db/schema";
import { contentHashOf } from "@/lib/db/stateMachine";
import { nextTrackingId } from "@/lib/db/trackingId";
import { MediaRejectedError, processImage } from "@/lib/media/upload";
import { putObject } from "@/lib/media/storage";
import { SubmitSchema, bucketMidpoint, deriveTitle } from "./schema";

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
  const title = deriveTitle(input.bodyOriginal);
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
          framedStatement: input.framedStatement,
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
      await tx.insert(ledgerEntries).values({
        challengeId: challenge.id,
        kind: "PROBLEM_TEXT",
        contentHash: contentHashOf({
          trackingId,
          bodyOriginal: input.bodyOriginal,
          bodyLang: input.bodyLang,
          reporterName: input.reporterName ?? user?.fullName ?? null,
          media: input.media.map((m) => m.contentHash),
        }),
        authorId: user?.id ?? null,
        payload: {
          trackingId,
          source: "web",
          reporterName: input.reporterName ?? user?.fullName ?? null,
          mediaHashes: input.media.map((m) => m.contentHash),
        },
        createdAt: now,
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
