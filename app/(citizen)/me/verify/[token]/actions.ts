"use server";

/**
 * The three answers, and the only place the impact counter moves.
 *
 * CLAUDE.md invariant 7: the counter increments at CITIZEN_VERIFIED and nowhere
 * else. Not on publish, not on funding, not on an implementer's claim. This
 * action is the whole of that increment, which is why it is short: everything
 * else in Milan is arranged so that nothing else can do it.
 *
 * No login. The link is HMAC-signed over the challenge id — see lib/verify/token
 * for why a login wall here would quietly turn the most credible number on the
 * page into a small one.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { currentUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges, impactConfirmations } from "@/lib/db/schema";
import { transition } from "@/lib/db/stateMachine";
import { appendEntry } from "@/lib/ledger/append";
import { notify } from "@/lib/notify";
import { readVerifyToken } from "@/lib/verify/token";

const Input = z.object({
  token: z.string().min(10),
  answer: z.enum(["YES", "PARTLY", "NO"]),
  note: z.string().trim().max(2000).optional(),
});

export interface ConfirmState {
  ok: boolean;
  message: string;
  answer?: "YES" | "PARTLY" | "NO";
}

export async function confirmImpact(_prev: ConfirmState | null, form: FormData): Promise<ConfirmState> {
  const parsed = Input.safeParse({
    token: form.get("token"),
    answer: form.get("answer"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "That answer could not be read. Please try again." };

  const read = readVerifyToken(parsed.data.token);
  if ("error" in read) return { ok: false, message: read.error };

  const [c] = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      status: challenges.status,
      districtCode: challenges.districtCode,
    })
    .from(challenges)
    .where(eq(challenges.id, read.challengeId))
    .limit(1);
  if (!c) return { ok: false, message: "That report could not be found." };

  const user = await currentUser();
  const at = clockNow();
  const { answer, note } = parsed.data;

  if (answer === "NO") {
    /**
     * The citizen says nothing changed.
     *
     * The implementer's claim is marked disputed, the challenge goes back to
     * IN_RESEARCH, the District Collector is told — and the impact counter does
     * NOT move. A platform that quietly counts a disputed fix is a platform
     * whose numbers are worth nothing.
     */
    await db.transaction(async (tx) => {
      await tx.insert(impactConfirmations).values({
        challengeId: c.id,
        userId: user?.id ?? null,
        answer,
        note: note ?? null,
        createdAt: at,
      });
      await tx
        .update(challenges)
        .set({ impactDisputed: true, impactConfirmed: false, impactPartial: false, citizenVerificationNote: note ?? null, updatedAt: at })
        .where(eq(challenges.id, c.id));
      await appendEntry(tx, {
        challengeId: c.id,
        kind: "STATE_CHANGE",
        authorId: user?.id ?? null,
        at,
        payload: {
          event: "CITIZEN_DISPUTED",
          trackingId: c.trackingId,
          note: note ?? null,
          at: at.toISOString(),
          consequence: "The impact counter did not move. The implementer's claim is shown as disputed everywhere.",
        },
      });
      await transition(tx, {
        challengeId: c.id,
        to: "DISPUTED",
        actorId: user?.id ?? null,
        reason: "The citizen who reported the problem says nothing changed.",
      });
    });

    // Notified outside the transaction: an email failing must not undo an
    // answer a citizen has already given.
    await notify({
      kind: "IMPACT_DISPUTED",
      title: "A citizen says an implementation did not fix their problem",
      body: `${c.trackingId}: ${c.title}. The person who reported it says nothing changed. The impact counter has not moved.`,
      actionUrl: `/c/${c.trackingId}`,
      channels: ["inapp"],
    });

    revalidatePath(`/c/${c.trackingId}`);
    revalidatePath("/stats");
    return {
      ok: true,
      answer,
      message:
        "Thank you. We have recorded that nothing changed. The claim is now marked disputed, the District Collector has been told, " +
        "and this has NOT been counted as an outcome anywhere.",
    };
  }

  // YES or PARTLY. Both are CITIZEN_VERIFIED; "partly" is counted separately and
  // never rounded up into the confirmed number.
  const partial = answer === "PARTLY";

  await db.transaction(async (tx) => {
    await tx.insert(impactConfirmations).values({
      challengeId: c.id,
      userId: user?.id ?? null,
      answer,
      note: note ?? null,
      createdAt: at,
    });
    await tx
      .update(challenges)
      .set({
        // INVARIANT 7. This line, and no other line in the codebase.
        impactConfirmed: true,
        impactPartial: partial,
        impactDisputed: false,
        citizenVerifiedAt: at,
        citizenVerificationNote: note ?? null,
        updatedAt: at,
      })
      .where(eq(challenges.id, c.id));
    await appendEntry(tx, {
      challengeId: c.id,
      kind: "STATE_CHANGE",
      authorId: user?.id ?? null,
      at,
      payload: {
        event: partial ? "CITIZEN_VERIFIED_PARTIAL" : "CITIZEN_VERIFIED",
        trackingId: c.trackingId,
        note: note ?? null,
        at: at.toISOString(),
        consequence: partial
          ? "Counted as a partial outcome, separately from confirmed impact. Never rounded up."
          : "The impact counter incremented. This is the only event in Milan that moves it.",
      },
    });
    await transition(tx, {
      challengeId: c.id,
      to: "CITIZEN_VERIFIED",
      actorId: user?.id ?? null,
      reason: partial ? "The citizen says the problem is partly fixed." : "The citizen says the problem is fixed.",
    });
  });

  revalidatePath(`/c/${c.trackingId}`);
  revalidatePath("/stats");
  revalidatePath("/gov");

  return {
    ok: true,
    answer,
    message: partial
      ? "Thank you. We have recorded that it is partly fixed. That is counted on its own, and it is never presented as a full fix."
      : "Thank you. Your confirmation is the only thing in Milan that moves the impact counter, and it has just moved. " +
        "Your name is permanently on the credit chain as the person who reported this.",
  };
}
