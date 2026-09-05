"use server";

/**
 * Claiming a challenge.
 *
 * One transaction, or none of it: the project, its members, a credit edge for
 * every one of them, the winning route set to CLAIMED and the losing routes to
 * EXPIRED, the challenge moved to CLAIMED, the ledger append, and the
 * decrement of declared capacity. If the ledger could disagree with the
 * challenge table the whole provenance claim collapses, so they are written
 * together.
 *
 * The citizen is added to the credit chain as a Domain Informant by default.
 * That is a product principle, not a nicety: the person who noticed the problem
 * is part of the team that solves it, and a student paper that comes out of
 * this carries their name unless someone deliberately removes it.
 */
import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import {
  capabilities,
  challenges,
  creditEdges,
  ledgerEntries,
  projectMembers,
  projects,
  routes,
  user as userTable,
  userProfiles,
} from "@/lib/db/schema";
import { contentHashOf, transition } from "@/lib/db/stateMachine";
import { requireRole } from "@/lib/auth/guards";
import { notify } from "@/lib/notify";

const MemberSchema = z.object({
  /** Used to link an account and to notify. Never rendered publicly. */
  email: z.string().trim().email("That is not an email address.").max(200),
  /** What goes on the public credit chain. */
  name: z.string().trim().min(2, "Give each team member a name for the credit record.").max(120),
  declaredRole: z.string().trim().min(2).max(60),
});

const ClaimSchema = z.object({
  trackingId: z.string().trim().min(3).max(40),
  capabilityId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(12, "Give the project a title a student could put on a report.")
    .max(160),
  /** OPEN publishes under CC-BY. RESTRICTED keeps it behind an access log. */
  ipTrack: z.enum(["OPEN", "RESTRICTED"]),
  members: z.array(MemberSchema).min(1, "Name at least one team member.").max(12),
  mentorEmail: z.string().trim().email("That is not an email address.").max(200),
  mentorName: z.string().trim().min(2).max(120),
  /** The citizen's place on the chain. Editable, defaulted, never silently dropped. */
  citizenRole: z.string().trim().min(2).max(60).default("Domain Informant"),
  creditCitizen: z.boolean().default(true),
  confirmCapacity: z.literal(true, {
    errorMap: () => ({ message: "Confirm this fits the capacity you have declared." }),
  }),
});

export type ClaimResult =
  | { ok: true; projectId: string; trackingId: string; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function claimChallengeAction(raw: unknown): Promise<ClaimResult> {
  const user = await requireRole("HEI_MEMBER");
  if (!user.orgId) {
    return { ok: false, error: "Your account is not attached to an institution." };
  }

  const parsed = ClaimSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return {
      ok: false,
      error: flat.formErrors[0] ?? "Some answers are missing.",
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;
  const trackingId = input.trackingId.toUpperCase();

  /* ------------------------------------------------------- read and check */

  const [challenge] = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      status: challenges.status,
      title: challenges.title,
      reporterId: challenges.reporterId,
      reporterName: challenges.reporterName,
    })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);

  if (!challenge) return { ok: false, error: "That challenge does not exist." };

  // Rechecked server-side, not trusted from the form: an offer belongs to an
  // organisation, and a department cannot claim work it was never offered.
  const [offer] = await db
    .select({ id: routes.id, capabilityId: routes.capabilityId, claimWindowEndsAt: routes.claimWindowEndsAt })
    .from(routes)
    .where(
      and(
        eq(routes.challengeId, challenge.id),
        eq(routes.orgId, user.orgId),
        eq(routes.state, "OFFERED"),
      ),
    )
    .limit(1);

  if (!offer) {
    return {
      ok: false,
      error: "This challenge is not currently offered to your institution, or it has already been claimed.",
    };
  }

  const now = clockNow();
  if (offer.claimWindowEndsAt && offer.claimWindowEndsAt.getTime() < now.getTime()) {
    return { ok: false, error: "The claim window for this challenge has closed." };
  }

  const [capability] = await db
    .select({ id: capabilities.id, declaredCapacity: capabilities.declaredCapacity, department: capabilities.department })
    .from(capabilities)
    .where(and(eq(capabilities.id, input.capabilityId), eq(capabilities.orgId, user.orgId)))
    .limit(1);

  if (!capability) return { ok: false, error: "That department is not one of yours." };
  if (capability.declaredCapacity <= 0) {
    return {
      ok: false,
      error: "That department has no declared capacity left. Update it on the capability page first.",
    };
  }

  /* ------------------------------------------------- resolve the people */

  const emails = [...new Set([...input.members.map((m) => m.email.toLowerCase()), input.mentorEmail.toLowerCase()])];
  const known = await db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(inArray(sql`lower(${userTable.email})`, emails));

  const idByEmail = new Map(known.map((k) => [k.email.toLowerCase(), k.id]));

  /* --------------------------------------------------------- the write */

  const at = clockNow();
  try {
    const projectId = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          challengeId: challenge.id,
          orgId: user.orgId as string,
          leadUserId: user.id,
          mentorUserId: idByEmail.get(input.mentorEmail.toLowerCase()) ?? user.id,
          title: input.title,
          ipTrack: input.ipTrack,
          status: "ACTIVE",
          claimedAt: at,
          // Phase 3's inactivity ladder reads this column and nothing else, so
          // it is set here and updated on every write to the project.
          lastActivityAt: at,
        })
        .returning({ id: projects.id });

      /* the team ------------------------------------------------------- */

      const memberRows: Array<{ projectId: string; userId: string; declaredRole: string; addedAt: Date }> = [];
      const credits: Array<{
        challengeId: string;
        toUserId: string | null;
        orgId: string | null;
        relation: string;
        declaredRole: string;
        createdAt: Date;
      }> = [];

      // The person claiming is always on the team, whether or not they listed
      // themselves. A project with a lead who is not a member is a project with
      // a hole in its credit chain.
      const seen = new Set<string>();
      for (const member of [...input.members]) {
        const userId = idByEmail.get(member.email.toLowerCase()) ?? null;
        credits.push({
          challengeId: challenge.id,
          toUserId: userId,
          orgId: user.orgId,
          relation: "TEAM_MEMBER",
          // The NAME, not the email.
          //
          // `credit_edges.declared_role` renders on the public challenge page,
          // and putting a student's email address there would publish it to
          // anyone who opens the link. The email is how we link an account and
          // send a notification; it stays in `project_members` and the ledger.
          //
          // An unregistered student is still credited by the name their team
          // gave and can attach an account later. Not having registered yet
          // must never cost somebody their place on the record.
          declaredRole: `${member.name} — ${member.declaredRole}`,
          createdAt: at,
        });
        if (userId && !seen.has(userId)) {
          seen.add(userId);
          memberRows.push({ projectId: project.id, userId, declaredRole: member.declaredRole, addedAt: at });
        }
      }

      if (!seen.has(user.id)) {
        memberRows.push({ projectId: project.id, userId: user.id, declaredRole: "Claiming faculty", addedAt: at });
      }
      if (memberRows.length > 0) await tx.insert(projectMembers).values(memberRows);

      credits.push({
        challengeId: challenge.id,
        toUserId: idByEmail.get(input.mentorEmail.toLowerCase()) ?? user.id,
        orgId: user.orgId,
        relation: "MENTOR",
        declaredRole: input.mentorName,
        createdAt: at,
      });

      // The citizen joins the chain of the work their report started.
      if (input.creditCitizen) {
        credits.push({
          challengeId: challenge.id,
          toUserId: challenge.reporterId,
          orgId: null,
          relation: "TEAM_MEMBER",
          declaredRole: `${challenge.reporterName ?? "The reporter"} — ${input.citizenRole}`,
          createdAt: at,
        });
      }

      await tx.insert(creditEdges).values(credits);

      /* the offers ------------------------------------------------------ */

      await tx
        .update(routes)
        .set({ state: "CLAIMED" })
        .where(eq(routes.id, offer.id));

      // The other two institutions are told nothing more; their offer simply
      // closes. Leaving them OFFERED would let two teams claim the same work.
      await tx
        .update(routes)
        .set({ state: "EXPIRED" })
        .where(and(eq(routes.challengeId, challenge.id), ne(routes.id, offer.id), eq(routes.state, "OFFERED")));

      /* capacity -------------------------------------------------------- */

      await tx
        .update(capabilities)
        .set({ declaredCapacity: sql`greatest(0, ${capabilities.declaredCapacity} - 1)` })
        .where(eq(capabilities.id, capability.id));

      /* the ledger and the state change --------------------------------- */

      await tx.insert(ledgerEntries).values({
        challengeId: challenge.id,
        projectId: project.id,
        kind: "PROPOSAL",
        contentHash: contentHashOf({
          trackingId: challenge.trackingId,
          orgId: user.orgId,
          title: input.title,
          ipTrack: input.ipTrack,
          members: input.members.map((m) => `${m.name}:${m.declaredRole}`).sort(),
          mentor: input.mentorEmail,
          at: at.toISOString(),
        }),
        authorId: user.id,
        payload: {
          claimedBy: user.orgId,
          department: capability.department,
          title: input.title,
          ipTrack: input.ipTrack,
          teamSize: input.members.length,
          citizenCredited: input.creditCitizen,
          citizenRole: input.citizenRole,
        },
        createdAt: at,
      });

      await transition(tx, {
        challengeId: challenge.id,
        to: "CLAIMED",
        actorId: user.id,
        reason: `Claimed by ${capability.department} as "${input.title}".`,
        meta: { projectId: project.id, orgId: user.orgId, ipTrack: input.ipTrack },
      });

      return project.id;
    });

    /* the citizen hears about it --------------------------------------- */

    if (challenge.reporterId) {
      await notify({
        userId: challenge.reporterId,
        kind: "CHALLENGE_CLAIMED",
        title: "A university team has taken on your report",
        body:
          `${challenge.trackingId} has been claimed by ${capability.department}. You are on the ` +
          `credit record for it as ${input.citizenRole}. Only you can confirm whether it was ` +
          `actually solved.`,
        actionUrl: `/c/${challenge.trackingId}`,
        channels: ["inapp", "email", "sms"],
      });
    }

    revalidatePath(`/c/${trackingId}`);
    revalidatePath("/hei");
    revalidatePath("/hei/inbox");

    return {
      ok: true,
      projectId,
      trackingId,
      message: `${trackingId} is yours. The reporter has been told, and they are on the credit record.`,
    };
  } catch (e) {
    console.error("[hei/claim] failed", e);
    return {
      ok: false,
      error: "That could not be saved, so nothing was changed. Try again.",
    };
  }
}

/* ------------------------------------------------- team member lookup */

export type LookupResult = { email: string; known: boolean; name: string | null };

/**
 * Does this email already have a Milan account?
 *
 * Purely informational: an unregistered student is still added and still
 * credited by name. The UI says which is which so a team knows who will be
 * able to log in and edit the project today.
 */
export async function lookupMembersAction(emails: string[]): Promise<LookupResult[]> {
  await requireRole("HEI_MEMBER");
  const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  if (clean.length === 0) return [];

  const rows = await db
    .select({ email: userTable.email, name: userProfiles.fullName })
    .from(userTable)
    .leftJoin(userProfiles, eq(userProfiles.userId, userTable.id))
    .where(inArray(sql`lower(${userTable.email})`, clean));

  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r.name]));
  return clean.map((email) => ({
    email,
    known: byEmail.has(email),
    name: byEmail.get(email) ?? null,
  }));
}
