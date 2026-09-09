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
 * Open claiming: a routed offer is honoured when one exists (its window is
 * checked), but any institution can claim anything triage-cleared — or still
 * untriaged with severity above 0.30 — with a team and a university email.
 * An open claim writes its own CLAIMED route row
 * (rank 0) so the per-institution counts stay honest, and closes every other
 * open offer exactly the way a routed claim does.
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
  IllegalTransitionError,
  OPEN_CLAIM_MIN_SEVERITY,
  UNTRIAGED_STATES,
  isOpenClaimable,
  transition,
} from "@/lib/db/stateMachine";
import { appendEntry } from "@/lib/ledger/append";
import {
  capabilities,
  challenges,
  creditEdges,
  projectMembers,
  projects,
  routes,
  user as userTable,
  userProfiles,
} from "@/lib/db/schema";
import { requireRole, type MilanUser } from "@/lib/auth/guards";
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
  return claimAs(await requireRole("HEI_MEMBER"), raw);
}

/**
 * Open claiming: any institution can claim anything safety triage has cleared
 * — routed an offer or not — plus anything untriaged with severity above the
 * 0.30 bar. The router's offers are the push path; this is the pull path.
 * The only states that hold are untriaged-and-mild ones: below the bar,
 * nothing can be claimed before the S1 safety check.
 */

/** Freemail domains a claimant's own account email may not come from. */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "outlook.com",
  "outlook.in",
  "hotmail.com",
  "hotmail.co.in",
  "live.com",
  "live.in",
  "rediffmail.com",
  "protonmail.com",
  "proton.me",
  "icloud.com",
  "zoho.com",
]);

function claimantEmailError(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return "Your account has no email address on it, so it cannot claim.";
  if (FREEMAIL_DOMAINS.has(domain)) {
    return (
      `Claiming needs a university email address — ${domain} is a personal mailbox. ` +
      `Sign in with your institutional account (the one your affiliation proof belongs to).`
    );
  }
  return null;
}

/**
 * The claim itself, with the acting user passed in.
 *
 * Split out so that the /demo console's "HOD claims it" button can run the
 * IDENTICAL code — the same capacity decrement, the same credit edges, the same
 * ledger append — while acting as the seeded department head rather than as the
 * admin who pressed the button. ADMIN is deliberately not a wildcard in
 * `requireRole`, so a demo shortcut that ran as the admin would either be
 * refused or would need a second, weaker code path. This is neither.
 *
 * Every caller must do its own authorisation before calling this.
 */
export async function claimAs(user: MilanUser, raw: unknown): Promise<ClaimResult> {
  if (!user.orgId) {
    return { ok: false, error: "Your account is not attached to an institution." };
  }

  // A team and a university email: the team is the form below, and the email
  // is the claimant's own account. (Team members may use any mailbox — an
  // unregistered student on Gmail is still credited by name.)
  const emailProblem = claimantEmailError(user.email);
  if (emailProblem) return { ok: false, error: emailProblem };

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
      severity: challenges.severity,
      title: challenges.title,
      reporterId: challenges.reporterId,
      reporterName: challenges.reporterName,
    })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);

  if (!challenge) return { ok: false, error: "That challenge does not exist." };

  // Claimability is a property of the challenge's state and severity, for
  // offered and open claims alike. Without this gate an offer row on an
  // unreleased challenge would die later in transition() with an
  // IllegalTransitionError instead of a sentence a professor can act on.
  if (!isOpenClaimable(challenge.status, challenge.severity)) {
    // The untriaged list is explicit; every other non-claimable state —
    // already claimed, in research, merged away, parked, withdrawn, rejected —
    // is past the point where a team can take it, and says so.
    const untriaged = (UNTRIAGED_STATES as readonly string[]).includes(challenge.status);
    return {
      ok: false,
      error: untriaged
        ? `This challenge is still being checked and its severity is ${challenge.severity ?? "not recorded yet"} — it becomes claimable the moment triage clears it, or as soon as a severity above ${OPEN_CLAIM_MIN_SEVERITY.toFixed(2)} is recorded.`
        : "This challenge has already been claimed — it is past the point where a team can take it.",
    };
  }

  // A routed offer, when there is one, still wins: its claim window is
  // honoured. Without one this is an open claim — any institution, any team.
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

  const openClaim = !offer;

  const now = clockNow();
  if (offer?.claimWindowEndsAt && offer.claimWindowEndsAt.getTime() < now.getTime()) {
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
      // Severity-bar claims arrive here still untriaged, and SUBMITTED and
      // NEEDS_MORE_INFO deliberately have no CLAIMED edge. Walk through
      // TRIAGED first so the ledger shows the pass explicitly: the safety
      // check is recorded as passed-on-claim, never skipped silently.
      if ((UNTRIAGED_STATES as readonly string[]).includes(challenge.status)) {
        try {
          await transition(tx, {
            challengeId: challenge.id,
            to: "TRIAGED",
            actorId: user.id,
            reason:
              `Opened to claiming on severity ${Number(challenge.severity).toFixed(2)}: above the ` +
              `${OPEN_CLAIM_MIN_SEVERITY.toFixed(2)} open-claim bar, recorded as triaged on claim.`,
            meta: { openClaimSeverityPass: true, severity: challenge.severity },
          });
        } catch (e) {
          if (!(e instanceof IllegalTransitionError)) throw e;
          // Raced with the pipeline: triage landed between our read and this
          // write. The CLAIMED transition below re-validates the true state,
          // so carry on rather than failing a claim that is still valid.
        }
      }

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

      if (offer) {
        await tx.update(routes).set({ state: "CLAIMED" }).where(eq(routes.id, offer.id));
      } else {
        // An open claim writes its own route row so the per-institution
        // offered/claimed/delivered counts stay honest. Rank 0: outside the
        // routed top three by definition, and the reason says so plainly.
        await tx.insert(routes).values({
          challengeId: challenge.id,
          orgId: user.orgId as string,
          capabilityId: capability.id,
          rank: 0,
          matchScore: null,
          reasonText: `Open claim by ${capability.department}: no routed offer, first team with declared capacity takes it.`,
          reasonTerms: null,
          notifiedAt: null,
          claimWindowEndsAt: null,
          state: "CLAIMED",
        });
      }

      // Every other open offer simply closes. Leaving them OFFERED would let
      // two teams claim the same work.
      await tx
        .update(routes)
        .set({ state: "EXPIRED" })
        .where(
          offer
            ? and(eq(routes.challengeId, challenge.id), ne(routes.id, offer.id), eq(routes.state, "OFFERED"))
            : and(eq(routes.challengeId, challenge.id), eq(routes.state, "OFFERED")),
        );

      /* capacity -------------------------------------------------------- */

      await tx
        .update(capabilities)
        .set({ declaredCapacity: sql`greatest(0, ${capabilities.declaredCapacity} - 1)` })
        .where(eq(capabilities.id, capability.id));

      /* the ledger and the state change --------------------------------- */

      await appendEntry(tx, {
        challengeId: challenge.id,
        projectId: project.id,
        kind: "PROPOSAL",
        authorId: user.id,
        at,
        payload: {
          trackingId: challenge.trackingId,
          claimedBy: user.orgId,
          openClaim,
          department: capability.department,
          title: input.title,
          ipTrack: input.ipTrack,
          teamSize: input.members.length,
          // Names, never emails: the public chain credits people by name.
          members: input.members.map((m) => `${m.name}:${m.declaredRole}`).sort(),
          citizenCredited: input.creditCitizen,
          citizenRole: input.citizenRole,
          at: at.toISOString(),
        },
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
    revalidatePath("/hei/challenge-bank");

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
