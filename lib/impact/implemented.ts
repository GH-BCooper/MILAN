/**
 * Claiming an implementation, and asking the citizen about it.
 *
 * IMPLEMENTED is deliberately not terminal. An implementer saying they built the
 * thing is a claim, not an outcome; the outcome is the person who reported the
 * problem saying it is fixed. So this function does two things and no more: it
 * moves the challenge to IMPLEMENTED, and it sends the citizen (and everyone who
 * corroborated) a signed link to answer the question.
 *
 * The SLA engine takes it from here — entering IMPLEMENTED opens an
 * IMPACT_UNCONFIRMED_30 deadline, so a citizen who does not answer is asked
 * again rather than quietly counted.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges, corroborations, projects, user as userTable, userProfiles } from "@/lib/db/schema";
import { transition } from "@/lib/db/stateMachine";
import { notify } from "@/lib/notify";
import { verifyLinkFor } from "@/lib/verify/token";

export interface ImplementedResult {
  trackingId: string;
  status: string;
  messaged: number;
  verifyLink: string;
}

export async function markImplemented(args: {
  challengeId: string;
  actorId: string | null;
  claim: string;
}): Promise<ImplementedResult> {
  const [c] = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId, title: challenges.title, reporterId: challenges.reporterId })
    .from(challenges)
    .where(eq(challenges.id, args.challengeId))
    .limit(1);
  if (!c) throw new Error(`challenge ${args.challengeId} not found`);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.challengeId, c.id))
    .limit(1);

  const at = clockNow();

  await db.transaction(async (tx) => {
    await transition(tx, {
      challengeId: c.id,
      to: "IMPLEMENTED",
      actorId: args.actorId,
      projectId: project?.id ?? null,
      lastActivityAt: at,
      reason: args.claim,
      meta: {
        note:
          "A claim, not an outcome. The impact counter does not move here; it moves when the citizen " +
          "answers at /me/verify. CLAUDE.md invariant 7.",
      },
    });
  });

  const link = verifyLinkFor(c.id);

  // The reporter, and everyone who corroborated. All of them reported the same
  // problem; all of them can tell us whether it is still there.
  const recipients = await db
    .selectDistinct({ userId: userProfiles.userId, phone: userProfiles.phone, email: userTable.email })
    .from(corroborations)
    .innerJoin(userProfiles, eq(userProfiles.userId, corroborations.userId))
    .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
    .where(eq(corroborations.challengeId, c.id));

  if (c.reporterId && !recipients.some((r) => r.userId === c.reporterId)) {
    const [reporter] = await db
      .select({ userId: userProfiles.userId, phone: userProfiles.phone, email: userTable.email })
      .from(userProfiles)
      .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
      .where(eq(userProfiles.userId, c.reporterId))
      .limit(1);
    if (reporter) recipients.unshift(reporter);
  }

  let messaged = 0;
  for (const person of recipients) {
    await notify({
      userId: person.userId,
      email: person.email,
      phone: person.phone,
      kind: "CONFIRM_IMPACT",
      title: "Is the problem you reported actually fixed?",
      body: `${c.trackingId}: ${c.title}. Someone says they have solved it. Only you can tell us whether that is true.`,
      actionUrl: link,
      // SMS and WhatsApp are mock inboxes this cut; the message that would have
      // been sent is written to `outbox` verbatim and shown on /demo.
      channels: ["inapp", "sms", "whatsapp", "email"],
    });
    messaged++;
  }

  return { trackingId: c.trackingId, status: "IMPLEMENTED", messaged, verifyLink: link };
}
