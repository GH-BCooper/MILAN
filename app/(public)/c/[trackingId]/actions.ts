"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { currentUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges, corroborations } from "@/lib/db/schema";

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
  const fingerprint =
    headerList.get("x-forwarded-for")?.split(",")[0].trim() ??
    headerList.get("user-agent")?.slice(0, 64) ??
    "unknown";

  const [challenge] = await db
    .select({ id: challenges.id, lat: challenges.lat, lng: challenges.lng })
    .from(challenges)
    .where(eq(challenges.trackingId, parsed.data.trackingId.toUpperCase()))
    .limit(1);

  if (!challenge) return { ok: false, error: "That report could not be found." };

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

      await tx.insert(corroborations).values({
        challengeId: challenge.id,
        userId: user?.id ?? null,
        lat: challenge.lat,
        lng: challenge.lng,
        // Phase 2 computes a real distance-decayed weight. A signed-in report
        // from a known district is worth more than an anonymous one; saying so
        // now keeps the column honest.
        weight: user ? "1.000" : "0.500",
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
