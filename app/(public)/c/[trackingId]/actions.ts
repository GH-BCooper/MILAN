"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { currentUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/net/clientIp";
import { challenges, corroborations, userProfiles } from "@/lib/db/schema";
import { corroborationWeight } from "@/lib/credit/trust";
import {
  COMMENT_MAX_LENGTH,
  CommentRejectedError,
  insertComment,
} from "@/lib/comments";
import { checkCommentRate, recordComment } from "@/lib/db/rateLimit";

const Input = z.object({
  trackingId: z.string().trim().min(1).max(40),
});

export type CorroborateResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * "This happens to me too."
 *
 * A corroboration is signal, not noise: it is one of the seven priority terms.
 * Which is exactly why it is worth gaming, so:
 *
 *  - a signed-in user is held to unique(challenge_id, user_id) in the database,
 *    not by a check in application code;
 *  - an anonymous corroboration is accepted but recorded with its device
 *    fingerprint, and Phase 2 weights it lower than a signed-in one.
 *
 * The real answer is verified identity tiers, which is a declared stub.
 */
export async function corroborateAction(raw: unknown): Promise<CorroborateResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That report could not be found." };

  const user = await currentUser();
  const headerList = await headers();
  // Trusted-proxy model (lib/net/clientIp.ts): a spoofable header must not let
  // one browser present itself as many distinct corroborators.
  const fingerprint =
    clientIp(headerList) ?? headerList.get("user-agent")?.slice(0, 64) ?? "anonymous";

  const [challenge] = await db
    .select({ id: challenges.id, lat: challenges.lat, lng: challenges.lng, reporterId: challenges.reporterId })
    .from(challenges)
    .where(eq(challenges.trackingId, parsed.data.trackingId.toUpperCase()))
    .limit(1);

  if (!challenge) return { ok: false, error: "That report could not be found." };

  // "This happens to me too" credits a SECOND person independently reporting
  // the same problem (CLAUDE.md invariant 9: duplicates are signal, both
  // reporters are credited on MERGED). The original reporter confirming their
  // own report is not a second signal — it is the same signal counted twice,
  // which would let one account inflate its own priority score. An anonymous
  // report (reporterId null) has nobody to compare against, so this only
  // fires for a signed-in user confirming a report that is their own.
  if (user && challenge.reporterId && user.id === challenge.reporterId) {
    return { ok: false, error: "You reported this yourself — corroboration is for confirming someone else's report." };
  }

  try {
    const count = await db.transaction(async (tx) => {
      if (user) {
        const existing = await tx
          .select({ id: corroborations.id })
          .from(corroborations)
          .where(
            and(eq(corroborations.challengeId, challenge.id), eq(corroborations.userId, user.id)),
          )
          .limit(1);
        if (existing.length) throw new Error("ALREADY");
      }

      // A signed-in corroborator's weight is their own trust score doubled
      // (0.50 baseline → 1.000, exactly the old constant; proven reporters up
      // to 2.000; penalised accounts less). Anonymous stays 0.500. The trust
      // score has a writer now (lib/credit/trust-writers.ts), so this column
      // finally carries what it always claimed to.
      let weight = 0.5;
      if (user) {
        const [profile] = await tx
          .select({ trustScore: userProfiles.trustScore })
          .from(userProfiles)
          .where(eq(userProfiles.userId, user.id))
          .limit(1);
        weight = corroborationWeight(profile ? Number(profile.trustScore) : 0.5);
      }

      await tx.insert(corroborations).values({
        challengeId: challenge.id,
        userId: user?.id ?? null,
        lat: challenge.lat,
        lng: challenge.lng,
        weight: weight.toFixed(3),
        deviceFingerprint: fingerprint,
        createdAt: clockNow(),
      });

      const [updated] = await tx
        .update(challenges)
        .set({ corroborationCount: sql`${challenges.corroborationCount} + 1` })
        .where(eq(challenges.id, challenge.id))
        .returning({ count: challenges.corroborationCount });

      return updated.count;
    });

    revalidatePath(`/c/${parsed.data.trackingId}`);
    return { ok: true, count };
  } catch (e) {
    if ((e as Error).message === "ALREADY") {
      return { ok: false, error: "You have already confirmed this one. Thank you." };
    }
    // The unique index is the real guard; this catches the race the check above
    // cannot.
    if (/unique|duplicate/i.test((e as Error).message)) {
      return { ok: false, error: "You have already confirmed this one. Thank you." };
    }
    console.error("[corroborate] failed", e);
    return { ok: false, error: "That did not save. Please try again." };
  }
}

/* ----------------------------------------------------------------- comments */

const CommentInput = z.object({
  trackingId: z.string().trim().min(1).max(40),
  content: z.string().min(1).max(COMMENT_MAX_LENGTH + 200), // the hard cap is enforced in lib/comments

  parentCommentId: z.string().uuid().nullish(),
});

export type CommentResult = { ok: true } | { ok: false; error: string };

/**
 * Post a comment on a public challenge. Signed-in only: the no-account signal
 * is "This happens to me too" (corroboration), and the reason comments get no
 * anonymous tier at all is documented in lib/comments.ts — an unsigned word is
 * the brigading vector, not an unsigned tap.
 */
export async function postCommentAction(raw: unknown): Promise<CommentResult> {
  const parsed = CommentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That did not read as a comment. Please try again." };

  const user = await currentUser();
  if (!user) {
    return {
      ok: false,
      error: "Sign in to join the discussion. Reporting and corroborating need no account; a comment carries your name.",
    };
  }

  const [challenge] = await db
    .select({ id: challenges.id, status: challenges.status })
    .from(challenges)
    .where(eq(challenges.trackingId, parsed.data.trackingId.toUpperCase()))
    .limit(1);

  if (!challenge) return { ok: false, error: "That report could not be found." };

  const rate = await checkCommentRate(user.id);
  if (!rate.allowed) {
    return {
      ok: false,
      error: `You have commented ${rate.used} times in the last hour. The limit is ${rate.limit} — a conversation, not a flood. Try again later.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      const commentId = await insertComment(tx, {
        challengeId: challenge.id,
        userId: user.id,
        content: parsed.data.content,
        parentCommentId: parsed.data.parentCommentId ?? null,
      });
      await recordComment(tx, {
        userId: user.id,
        commentId,
        challengeId: challenge.id,
        trackingId: parsed.data.trackingId.toUpperCase(),
      });
    });
  } catch (e) {
    if (e instanceof CommentRejectedError) return { ok: false, error: e.message };
    console.error("[comments] post failed", e);
    return { ok: false, error: "That did not save. Please try again." };
  }

  revalidatePath(`/c/${parsed.data.trackingId}`);
  return { ok: true };
}
