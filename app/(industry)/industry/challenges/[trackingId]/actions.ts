"use server";

/**
 * Expressing interest, and what happens when a team accepts it.
 *
 * On acceptance a FUNDER credit edge is written and the challenge moves to
 * INDUSTRY_INTEREST. The credit edge matters more than the status: a firm that
 * pays for an implementation is on the same permanent chain as the citizen who
 * reported it and the students who solved it, and none of the three can remove
 * either of the others.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges, creditEdges, industryInterests, projects } from "@/lib/db/schema";
import { canTransition, transition } from "@/lib/db/stateMachine";
import { appendEntry } from "@/lib/ledger/append";
import { notify } from "@/lib/notify";

export interface InterestState {
  ok: boolean;
  message: string;
  interestId?: string;
}

const Express = z.object({
  trackingId: z.string().min(3),
  message: z.string().trim().min(20, "Say what you are interested in doing, in at least twenty characters.").max(3000),
});

export async function expressInterest(_prev: InterestState | null, form: FormData): Promise<InterestState> {
  const user = await requireRole("INDUSTRY", "ADMIN");
  if (!user.orgId) return { ok: false, message: "This account is not attached to an organisation." };

  const parsed = Express.safeParse({ trackingId: form.get("trackingId"), message: form.get("message") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That could not be read." };

  const [c] = await db
    .select({ id: challenges.id, title: challenges.title })
    .from(challenges)
    .where(eq(challenges.trackingId, parsed.data.trackingId))
    .limit(1);
  if (!c) return { ok: false, message: "That challenge does not exist." };

  const at = clockNow();
  const [row] = await db
    .insert(industryInterests)
    .values({ challengeId: c.id, orgId: user.orgId, userId: user.id, message: parsed.data.message, createdAt: at })
    .returning({ id: industryInterests.id });

  const [project] = await db
    .select({ id: projects.id, leadUserId: projects.leadUserId, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.challengeId, c.id))
    .limit(1);

  // Push, never browse: the team gets a link to this specific EOI thread.
  if (project?.leadUserId) {
    await notify({
      userId: project.leadUserId,
      kind: "INDUSTRY_INTEREST",
      title: "A firm has expressed interest in your project",
      body: `${parsed.data.trackingId}: ${c.title}. ${user.fullName} wrote: ${parsed.data.message.slice(0, 200)}`,
      actionUrl: `/industry/interests/${row.id}`,
      channels: ["inapp", "email"],
    });
  }
  if (project?.orgId) {
    await notify({
      orgId: project.orgId,
      kind: "INDUSTRY_INTEREST",
      title: "A firm has expressed interest in a challenge your department claimed",
      body: `${parsed.data.trackingId}: ${c.title}.`,
      actionUrl: `/industry/interests/${row.id}`,
      channels: ["inapp"],
    });
  }

  revalidatePath(`/industry/challenges/${parsed.data.trackingId}`);
  return { ok: true, interestId: row.id, message: "Interest recorded and the team notified. The thread is open." };
}

const Reply = z.object({
  interestId: z.string().uuid(),
  decision: z.enum(["ACCEPT", "DECLINE"]),
  note: z.string().trim().max(3000).optional(),
});

export async function respondToInterest(_prev: InterestState | null, form: FormData): Promise<InterestState> {
  const user = await requireRole("HEI_MEMBER", "INDEPENDENT_INNOVATOR", "ADMIN");
  const parsed = Reply.safeParse({
    interestId: form.get("interestId"),
    decision: form.get("decision"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "That could not be read." };

  const [interest] = await db
    .select({
      id: industryInterests.id,
      challengeId: industryInterests.challengeId,
      orgId: industryInterests.orgId,
      userId: industryInterests.userId,
      state: industryInterests.state,
      trackingId: challenges.trackingId,
      title: challenges.title,
      status: challenges.status,
    })
    .from(industryInterests)
    .innerJoin(challenges, eq(challenges.id, industryInterests.challengeId))
    .where(eq(industryInterests.id, parsed.data.interestId))
    .limit(1);
  if (!interest) return { ok: false, message: "That expression of interest does not exist." };

  const at = clockNow();
  const accepted = parsed.data.decision === "ACCEPT";

  await db.transaction(async (tx) => {
    await tx
      .update(industryInterests)
      .set({ state: accepted ? "ACCEPTED" : "DECLINED" })
      .where(eq(industryInterests.id, interest.id));

    if (accepted) {
      // The FUNDER edge. Permanent, and on the public chain beside the citizen.
      await tx.insert(creditEdges).values({
        challengeId: interest.challengeId,
        toUserId: interest.userId,
        orgId: interest.orgId,
        relation: "FUNDER",
        declaredRole: "Funding partner",
        createdAt: at,
      });
      await appendEntry(tx, {
        challengeId: interest.challengeId,
        kind: "CREDIT_EDGE",
        authorId: user.id,
        at,
        payload: {
          event: "FUNDER_ACCEPTED",
          trackingId: interest.trackingId,
          orgId: interest.orgId,
          acceptedBy: user.fullName,
          note: parsed.data.note ?? null,
          at: at.toISOString(),
        },
      });
      if (canTransition(interest.status, "INDUSTRY_INTEREST")) {
        await transition(tx, {
          challengeId: interest.challengeId,
          to: "INDUSTRY_INTEREST",
          actorId: user.id,
          reason: "A funding partner was accepted by the project team.",
        });
      }
    }
  });

  if (interest.userId) {
    await notify({
      userId: interest.userId,
      kind: "INTEREST_DECISION",
      title: accepted ? "Your expression of interest was accepted" : "Your expression of interest was declined",
      body: accepted
        ? `${interest.trackingId}: ${interest.title}. You are now on the permanent credit chain as the funding partner.`
        : `${interest.trackingId}: ${interest.title}.${parsed.data.note ? ` ${parsed.data.note}` : ""}`,
      actionUrl: `/industry/interests/${interest.id}`,
      channels: ["inapp", "email"],
    });
  }

  revalidatePath(`/industry/interests/${interest.id}`);
  return {
    ok: true,
    message: accepted
      ? "Accepted. A FUNDER credit edge is on the public chain and the challenge is now INDUSTRY_INTEREST."
      : "Declined, and the firm has been told.",
  };
}
