/**
 * The ladder actions — what actually happens when a clock runs out.
 *
 * Three ladders, from PHASE_3_BUILD.md Task 3.2:
 *   1. nobody claimed it   WIDEN -> OPEN_ALL -> BREACH -> GRAND_CHALLENGE
 *   2. claimed, nothing came  PROPOSAL_DUE, then the claim is released
 *   3. a team went silent  SILENT_30 -> SILENT_45 (fork rights)
 * plus the confirmation clock, the annual re-review, and the four coverage kinds
 * that keep invariant 1 true for the pipeline states.
 *
 * Every action here runs inside the reaper's transaction and is idempotent: it
 * is safe for two overlapping cron runs to attempt the same row, because the
 * row is taken FOR UPDATE SKIP LOCKED and its `fired_at` is stamped in the same
 * transaction as the effect.
 *
 * There are no model calls on the state-changing path. The one action that uses
 * S5 (WIDEN) computes its shortlist BEFORE the transaction opens and hands the
 * result in, so a slow provider can never hold a database lock.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Tx } from "@/lib/db";
import { appendEntry } from "@/lib/ledger/append";
import { notifyInTx, type PendingSend } from "@/lib/notify/tx";
import {
  challenges,
  projectMembers,
  projects,
  routes,
  slaDeadlines,
  user as userTable,
  userProfiles,
  type ChallengeStatus,
  type SlaKind,
} from "@/lib/db/schema";
import { canTransition, transition } from "@/lib/db/stateMachine";
import { deadlinesFor } from "./deadlines";

/* ------------------------------------------------------------ the context */

export interface DeadlineRow {
  id: string;
  challengeId: string;
  projectId: string | null;
  kind: SlaKind;
  dueAt: Date;
  payload: Record<string, unknown> | null;
}

export interface ChallengeRow {
  id: string;
  trackingId: string;
  title: string;
  status: ChallengeStatus;
  districtCode: string | null;
  domain: string | null;
  hazard: string | null;
  reporterId: string | null;
}

/** Anything the action needed that could not be computed inside a transaction. */
export interface ActionPrep {
  /** WIDEN: the next five institutions, already ranked and reasoned. */
  widenOffers?: Array<{ orgId: string; capabilityId: string | null; rank: number; matchScore: number; reasonText: string; reasonTerms: unknown }>;
  /** ANNUAL_REVIEW: the recomputed score. */
  rescored?: { priorityScore: number; breakdown: unknown; version: string } | null;
}

export interface ActionResult {
  /** One line, shown live on /demo as the ladder climbs. */
  summary: string;
  newStatus: ChallengeStatus;
  emails: PendingSend[];
}

export interface ActionCtx {
  tx: Tx;
  now: Date;
  deadline: DeadlineRow;
  challenge: ChallengeRow;
  prep: ActionPrep;
}

/* ------------------------------------------------------------- recipients */

async function districtOfficers(tx: Tx, districtCode: string | null) {
  if (!districtCode) return [];
  return tx
    .select({ userId: userProfiles.userId, email: userTable.email, phone: userProfiles.phone })
    .from(userProfiles)
    .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
    .where(and(eq(userProfiles.role, "GOVERNMENT"), eq(userProfiles.districtCode, districtCode)));
}

async function admins(tx: Tx) {
  return tx
    .select({ userId: userProfiles.userId, email: userTable.email, phone: userProfiles.phone })
    .from(userProfiles)
    .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
    .where(eq(userProfiles.role, "ADMIN"));
}

async function reporter(tx: Tx, reporterId: string | null) {
  if (!reporterId) return null;
  const [row] = await tx
    .select({ userId: userProfiles.userId, email: userTable.email, phone: userProfiles.phone, name: userProfiles.fullName })
    .from(userProfiles)
    .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
    .where(eq(userProfiles.userId, reporterId))
    .limit(1);
  return row ?? null;
}

async function projectPeople(tx: Tx, projectId: string | null) {
  if (!projectId) return [];
  const rows = await tx
    .select({ userId: projectMembers.userId, email: userTable.email, phone: userProfiles.phone })
    .from(projectMembers)
    .innerJoin(userTable, eq(userTable.id, projectMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId));
  return rows;
}

/* --------------------------------------------------------------- helpers */

/** Open a deadline without a state change — used when an action escalates in place. */
async function openDeadline(ctx: ActionCtx, kind: SlaKind, dueAt: Date, payload: Record<string, unknown> = {}) {
  await ctx.tx.insert(slaDeadlines).values({
    challengeId: ctx.challenge.id,
    projectId: ctx.deadline.projectId,
    kind,
    dueAt,
    payload,
    createdAt: ctx.now,
  });
}

const plusDays = (from: Date, n: number) => new Date(from.getTime() + n * 86_400_000);

/**
 * Move a challenge, walking one intermediate state if the direct edge is not
 * legal. BREACH, for instance, fires from ROUTED when WIDEN was skipped, and
 * ROUTED -> BOUNTY_LISTED is not an edge; ROUTED -> UNCLAIMED_ESCALATED ->
 * BOUNTY_LISTED is. Never more than one hop: a longer walk would be the reaper
 * inventing a history that did not happen.
 */
async function advanceTo(ctx: ActionCtx, to: ChallengeStatus, reason: string): Promise<ChallengeStatus> {
  const { tx, challenge } = ctx;
  const from = challenge.status;
  if (from === to) return to;

  const { TRANSITIONS } = await import("@/lib/db/stateMachine");
  if (!canTransition(from, to)) {
    const bridge = TRANSITIONS[from].find((mid) => canTransition(mid, to));
    if (!bridge) return from;
    await transition(tx, { challengeId: challenge.id, to: bridge, reason: `${reason} (via ${bridge})`, meta: { by: "sla-reaper" }, projectId: ctx.deadline.projectId });
    challenge.status = bridge;
  }
  await transition(tx, {
    challengeId: challenge.id,
    to,
    reason,
    meta: { by: "sla-reaper", deadline: ctx.deadline.kind },
    projectId: ctx.deadline.projectId,
  });
  challenge.status = to;
  return to;
}

async function ledger(ctx: ActionCtx, payload: Record<string, unknown>) {
  await appendEntry(ctx.tx, {
    challengeId: ctx.challenge.id,
    projectId: ctx.deadline.projectId,
    kind: "STATE_CHANGE",
    authorId: null,
    payload: { event: "SLA_FIRED", kind: ctx.deadline.kind, trackingId: ctx.challenge.trackingId, at: ctx.now.toISOString(), ...payload },
    at: ctx.now,
  });
}

/* --------------------------------------------------------------- ladder 1 */

/** Nobody in the shortlist moved. Widen to the next five and restart the clock. */
async function widen(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  const emails: PendingSend[] = [];
  const offers = ctx.prep.widenOffers ?? [];

  if (offers.length > 0) {
    await tx.insert(routes).values(
      offers.map((o) => ({
        challengeId: challenge.id,
        orgId: o.orgId,
        capabilityId: o.capabilityId,
        rank: o.rank,
        matchScore: o.matchScore.toFixed(3),
        reasonText: o.reasonText,
        reasonTerms: o.reasonTerms as never,
        notifiedAt: now,
        claimWindowEndsAt: plusDays(now, 7),
        state: "OFFERED",
        createdAt: now,
      })),
    );
  }

  await tx
    .update(challenges)
    .set({ escalationStage: "WIDEN", updatedAt: now })
    .where(eq(challenges.id, challenge.id));

  const status = await advanceTo(ctx, "UNCLAIMED_ESCALATED", "Claim window closed with no claim. Widened to five more institutions.");

  for (const o of offers) {
    const members = await tx
      .select({ userId: userProfiles.userId, email: userTable.email, phone: userProfiles.phone })
      .from(userProfiles)
      .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
      .where(and(eq(userProfiles.orgId, o.orgId), eq(userProfiles.role, "HEI_MEMBER")));
    const targets = members.length > 0 ? members : [{ userId: null as string | null, email: null as string | null, phone: null as string | null }];
    for (const m of targets) {
      const sendable = await notifyInTx(tx, {
        userId: m.userId,
        orgId: o.orgId,
        email: m.email,
        phone: m.phone,
        kind: "CHALLENGE_WIDENED",
        title: "A challenge nobody has claimed, now open to your department",
        body: `${challenge.trackingId}: ${challenge.title}. ${o.reasonText} Seven days passed with no claim from the first shortlist.`,
        actionUrl: `/hei/challenges/${challenge.trackingId}/claim`,
      });
      if (sendable) emails.push(sendable);
    }
  }

  await ledger(ctx, { action: "WIDEN", widenedTo: offers.length });
  return { summary: `WIDEN — offered to ${offers.length} more institution(s), status ${status}`, newStatus: status, emails };
}

/** Still unclaimed at day 14. It goes into every challenge bank in the state. */
async function openAll(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  await tx
    .update(challenges)
    .set({ openToAll: true, escalationStage: "OPEN_ALL", updatedAt: now })
    .where(eq(challenges.id, challenge.id));
  await ledger(ctx, { action: "OPEN_ALL" });

  const emails: PendingSend[] = [];
  for (const officer of await districtOfficers(tx, challenge.districtCode)) {
    const s = await notifyInTx(tx, {
      userId: officer.userId,
      email: officer.email,
      phone: officer.phone,
      kind: "SLA_OPEN_ALL",
      title: "A challenge in your district is now open to every institution",
      body: `${challenge.trackingId}: ${challenge.title}. Fourteen days without a claim, so it is open to every HEI and independent innovator in Jharkhand.`,
      actionUrl: `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  return { summary: `OPEN_ALL — open to every HEI and independent innovator`, newStatus: challenge.status, emails };
}

/** Twenty-one days. This is a breach, it is named as one, and it goes public. */
async function breach(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  await tx
    .update(challenges)
    .set({ slaBreachedAt: now, escalationStage: "BREACH", openToAll: true, updatedAt: now })
    .where(eq(challenges.id, challenge.id));

  const status = await advanceTo(ctx, "BOUNTY_LISTED", "SLA breached at 21 days unclaimed. Listed on the public bounty board.");
  await ledger(ctx, { action: "BREACH", breachedAt: now.toISOString() });

  const emails: PendingSend[] = [];
  for (const officer of [...(await districtOfficers(tx, challenge.districtCode)), ...(await admins(tx))]) {
    const s = await notifyInTx(tx, {
      userId: officer.userId,
      email: officer.email,
      phone: officer.phone,
      kind: "SLA_BREACH",
      title: "SLA breach: 21 days unclaimed",
      body: `${challenge.trackingId}: ${challenge.title}. No institution has claimed this in 21 days. It is now on the public bounty board.`,
      actionUrl: `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  return { summary: `BREACH — sla_breached_at set, listed on /bounties, status ${status}`, newStatus: status, emails };
}

/** Forty-five days. Into the annual Jharkhand Grand Challenges set. */
async function grandChallenge(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  await tx
    .update(challenges)
    .set({ grandChallenge: true, escalationStage: "GRAND_CHALLENGE", updatedAt: now })
    .where(eq(challenges.id, challenge.id));
  await ledger(ctx, { action: "GRAND_CHALLENGE" });
  // Nothing further escalates, but nothing is forgotten either: annual review.
  await openDeadline(ctx, "ANNUAL_REVIEW", plusDays(now, 365), { reason: "grand-challenge set" });
  return {
    summary: `GRAND_CHALLENGE — added to the annual Jharkhand Grand Challenges set`,
    newStatus: challenge.status,
    emails: [],
  };
}

/* --------------------------------------------------------------- ladder 2 */

/**
 * A team claimed and then produced nothing.
 *
 * Fires twice. At +14 days it is a nudge to the lead and the head of department.
 * At +21 the claim is released and the challenge goes back out — and the prior
 * team's work is preserved and attributed, never deleted. That last clause is
 * the whole reason the project row is marked RELEASED rather than removed.
 */
async function proposalDue(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now, deadline } = ctx;
  const emails: PendingSend[] = [];
  const secondCall = deadline.payload?.stage === 2;

  if (!secondCall) {
    for (const p of await projectPeople(tx, deadline.projectId)) {
      const s = await notifyInTx(tx, {
        userId: p.userId,
        email: p.email,
        phone: p.phone,
        kind: "PROPOSAL_DUE",
        title: "Your proposal is due",
        body: `${challenge.trackingId}: ${challenge.title}. Fourteen days since you claimed this and no proposal has been filed. You have seven days before the claim is released.`,
        actionUrl: deadline.projectId ? `/hei/projects/${deadline.projectId}` : `/c/${challenge.trackingId}`,
      });
      if (s) emails.push(s);
    }
    await openDeadline(ctx, "PROPOSAL_DUE", plusDays(now, 7), { stage: 2 });
    await ledger(ctx, { action: "PROPOSAL_DUE", stage: 1 });
    return { summary: `PROPOSAL_DUE — lead and HOD nudged, claim released in 7 days`, newStatus: challenge.status, emails };
  }

  // Day 21. Release the claim.
  if (deadline.projectId) {
    await tx
      .update(projects)
      .set({ status: "RELEASED_UNDELIVERED" })
      .where(eq(projects.id, deadline.projectId));
    await tx
      .update(routes)
      .set({ state: "RELEASED" })
      .where(and(eq(routes.challengeId, challenge.id), eq(routes.state, "CLAIMED")));
  }

  const status = await advanceTo(ctx, "ROUTED", "No proposal 21 days after the claim. Claim released; the prior team keeps its credit.");
  await tx.update(challenges).set({ escalationStage: null, routedAt: now, updatedAt: now }).where(eq(challenges.id, challenge.id));
  await ledger(ctx, {
    action: "PROPOSAL_DUE_RELEASE",
    projectId: deadline.projectId,
    note: "The prior team's project row and credit edges are preserved. Work is attributed, never erased.",
  });

  return { summary: `PROPOSAL_DUE — claim released, back to ROUTED, prior team's work preserved`, newStatus: status, emails };
}

/* --------------------------------------------------------------- ladder 3 */

async function silent30(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now, deadline } = ctx;
  const emails: PendingSend[] = [];

  await tx.update(challenges).set({ atRiskFlag: true, updatedAt: now }).where(eq(challenges.id, challenge.id));

  let mentorId: string | null = null;
  if (deadline.projectId) {
    const [p] = await tx.select({ mentorUserId: projects.mentorUserId }).from(projects).where(eq(projects.id, deadline.projectId)).limit(1);
    mentorId = p?.mentorUserId ?? null;
  }
  for (const p of await projectPeople(tx, deadline.projectId)) {
    const s = await notifyInTx(tx, {
      userId: p.userId,
      email: p.email,
      phone: p.phone,
      kind: "SILENT_30",
      title: p.userId === mentorId ? "A project you mentor has been silent for 30 days" : "Your project has been silent for 30 days",
      body: `${challenge.trackingId}: ${challenge.title}. Nothing has been filed for 30 days, so this is now publicly flagged AT RISK. Post an update to clear it.`,
      actionUrl: deadline.projectId ? `/hei/projects/${deadline.projectId}` : `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }

  const status = await advanceTo(ctx, "AT_RISK", "Thirty days of silence on the project.");
  await ledger(ctx, { action: "SILENT_30" });
  return { summary: `SILENT_30 — mentor nudged, public AT_RISK flag set, status ${status}`, newStatus: status, emails };
}

/**
 * Forty-five days of silence. Fork rights open.
 *
 * "We do not stop people from sharing work. We make it impossible to erase who
 * did it." A fork creates a new project with `forked_from` set and the prior
 * team credited in `credit_edges` — that is `lib/hei/fork.ts`, not here. This
 * action opens the door and tells people it is open.
 */
async function silent45(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  await tx.update(challenges).set({ forkOpen: true, updatedAt: now }).where(eq(challenges.id, challenge.id));
  await ledger(ctx, { action: "SILENT_45", forkOpen: true });

  const emails: PendingSend[] = [];
  for (const officer of await districtOfficers(tx, challenge.districtCode)) {
    const s = await notifyInTx(tx, {
      userId: officer.userId,
      email: officer.email,
      phone: officer.phone,
      kind: "SILENT_45",
      title: "Fork rights are open on a stalled project",
      body: `${challenge.trackingId}: ${challenge.title}. Forty-five days of silence. Another team may now fork it; the first team stays credited.`,
      actionUrl: `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  await openDeadline(ctx, "STAGE_TIMEOUT", plusDays(now, 30), { expect: "fork-or-park" });
  return { summary: `SILENT_45 — fork rights open, prior team credited on any fork`, newStatus: challenge.status, emails };
}

/* ------------------------------------------------- the confirmation clock */

/** Thirty days after IMPLEMENTED and the citizen still has not answered. */
async function impactUnconfirmed(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  const emails: PendingSend[] = [];
  const person = await reporter(tx, challenge.reporterId);

  if (person) {
    const { verifyLinkFor } = await import("@/lib/verify/token");
    const s = await notifyInTx(tx, {
      userId: person.userId,
      email: person.email,
      phone: person.phone,
      kind: "IMPACT_UNCONFIRMED_30",
      title: "Has the problem you reported actually been fixed?",
      body: `${challenge.trackingId}: ${challenge.title}. Someone says they fixed this a month ago. Until you tell us, we count it as claimed, not confirmed.`,
      actionUrl: verifyLinkFor(challenge.id),
      channels: ["inapp", "sms", "whatsapp", "email"],
    });
    if (s) emails.push(s);
  }

  await ledger(ctx, { action: "IMPACT_UNCONFIRMED_30", note: "Claim remains unconfirmed and is rendered grey everywhere, including the CSR export." });
  await openDeadline(ctx, "IMPACT_UNCONFIRMED_30", plusDays(now, 30), { round: 2 });
  return {
    summary: `IMPACT_UNCONFIRMED_30 — second message to the citizen; the claim stays grey`,
    newStatus: challenge.status,
    emails,
  };
}

/* ------------------------------------------------------ coverage and review */

async function annualReview(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  const rescored = ctx.prep.rescored ?? null;
  if (rescored) {
    await tx
      .update(challenges)
      .set({
        priorityScore: rescored.priorityScore.toFixed(3),
        priorityBreakdown: rescored.breakdown as never,
        scoringVersion: rescored.version,
        updatedAt: now,
      })
      .where(eq(challenges.id, challenge.id));
  }
  await ledger(ctx, { action: "ANNUAL_REVIEW", rescoredTo: rescored?.priorityScore ?? null, scoringVersion: rescored?.version ?? null });

  const emails: PendingSend[] = [];
  for (const officer of await districtOfficers(tx, challenge.districtCode)) {
    const s = await notifyInTx(tx, {
      userId: officer.userId,
      email: officer.email,
      phone: officer.phone,
      kind: "ANNUAL_REVIEW",
      title: "Annual re-review of a parked challenge",
      body: `${challenge.trackingId}: ${challenge.title}. A year has passed. It has been rescored under ${rescored?.version ?? "the current weights"} and is back in front of you.`,
      actionUrl: `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  await openDeadline(ctx, "ANNUAL_REVIEW", plusDays(now, 365), { round: (Number(ctx.deadline.payload?.round ?? 1) || 1) + 1 });
  return {
    summary: `ANNUAL_REVIEW — rescored${rescored ? ` to ${rescored.priorityScore.toFixed(3)}` : ""} and re-routed to the district`,
    newStatus: challenge.status,
    emails,
  };
}

/** The pipeline stalled, or the citizen never answered a follow-up question. */
async function stageTimeout(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now, deadline } = ctx;
  const expect = String(deadline.payload?.expect ?? "");
  const emails: PendingSend[] = [];

  if (expect === "PARKED" && canTransition(challenge.status, "PARKED")) {
    const status = await advanceTo(ctx, "PARKED", "Fourteen days with no answer to the follow-up question. Parked with an annual re-review.");
    await ledger(ctx, { action: "STAGE_TIMEOUT", parked: true });
    return { summary: `STAGE_TIMEOUT — parked, annual re-review opened`, newStatus: status, emails };
  }

  for (const a of await admins(tx)) {
    const s = await notifyInTx(tx, {
      userId: a.userId,
      email: a.email,
      phone: a.phone,
      kind: "STAGE_TIMEOUT",
      title: "A challenge has stalled",
      body: `${challenge.trackingId} has sat at ${challenge.status} past its stage deadline${expect ? ` (expected ${expect})` : ""}. Nothing silently dies: this is that guarantee firing.`,
      actionUrl: `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  await openDeadline(ctx, "STAGE_TIMEOUT", plusDays(now, 3), { expect, escalated: true });
  await ledger(ctx, { action: "STAGE_TIMEOUT", status: challenge.status, expect });
  return { summary: `STAGE_TIMEOUT — stalled at ${challenge.status}, escalated to admin`, newStatus: challenge.status, emails };
}

/** Nobody came to the human gate. Invariant 5 must not become a bottleneck nobody sees. */
async function gateTimeout(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  const emails: PendingSend[] = [];
  for (const officer of [...(await districtOfficers(tx, challenge.districtCode)), ...(await admins(tx))]) {
    const s = await notifyInTx(tx, {
      userId: officer.userId,
      email: officer.email,
      phone: officer.phone,
      kind: "GATE_TIMEOUT",
      title: "A high-severity challenge is still waiting for you",
      body: `${challenge.trackingId}: ${challenge.title}. Severity is at or above 0.70, so nothing was sent to any institution until you confirm it. It has been waiting three days.`,
      actionUrl: `/gov/gate?c=${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  await openDeadline(ctx, "GATE_TIMEOUT", plusDays(now, 2), { escalated: true });
  await ledger(ctx, { action: "GATE_TIMEOUT" });
  return { summary: `GATE_TIMEOUT — the District Collector re-notified, gate still closed`, newStatus: challenge.status, emails };
}

/** The citizen confirmed. Closing is bookkeeping, and bookkeeping is on a clock too. */
async function closureDue(ctx: ActionCtx): Promise<ActionResult> {
  const status = await advanceTo(ctx, "CLOSED", "Citizen confirmed and the closure window elapsed. Closed automatically.");
  await ledger(ctx, { action: "CLOSURE_DUE" });
  return { summary: `CLOSURE_DUE — closed automatically after the citizen's confirmation`, newStatus: status, emails: [] };
}

async function disputeReview(ctx: ActionCtx): Promise<ActionResult> {
  const { tx, challenge, now } = ctx;
  const emails: PendingSend[] = [];
  for (const officer of await districtOfficers(tx, challenge.districtCode)) {
    const s = await notifyInTx(tx, {
      userId: officer.userId,
      email: officer.email,
      phone: officer.phone,
      kind: "DISPUTE_REVIEW",
      title: "A disputed implementation needs a decision",
      body: `${challenge.trackingId}: ${challenge.title}. The citizen said nothing changed. The impact counter has not moved and will not until this is resolved.`,
      actionUrl: `/c/${challenge.trackingId}`,
    });
    if (s) emails.push(s);
  }
  await openDeadline(ctx, "DISPUTE_REVIEW", plusDays(now, 14), { round: 2 });
  await ledger(ctx, { action: "DISPUTE_REVIEW" });
  return { summary: `DISPUTE_REVIEW — district notified; the counter stays where it is`, newStatus: challenge.status, emails };
}

/* ---------------------------------------------------------- the dispatcher */

const ACTIONS: Record<SlaKind, (ctx: ActionCtx) => Promise<ActionResult>> = {
  WIDEN: widen,
  OPEN_ALL: openAll,
  BREACH: breach,
  GRAND_CHALLENGE: grandChallenge,
  PROPOSAL_DUE: proposalDue,
  SILENT_30: silent30,
  SILENT_45: silent45,
  IMPACT_UNCONFIRMED_30: impactUnconfirmed,
  ANNUAL_REVIEW: annualReview,
  STAGE_TIMEOUT: stageTimeout,
  GATE_TIMEOUT: gateTimeout,
  CLOSURE_DUE: closureDue,
  DISPUTE_REVIEW: disputeReview,
  // The original claim window, superseded by the WIDEN rung. Kept in the enum
  // because rows written in Phase 2 may still carry it; it behaves as WIDEN.
  CLAIM_WINDOW: widen,
};

export async function runAction(ctx: ActionCtx): Promise<ActionResult> {
  return ACTIONS[ctx.deadline.kind](ctx);
}

/**
 * Invariant 1's backstop.
 *
 * Most actions escalate in place and open their own follow-on deadline. This
 * runs after every one of them and asserts the invariant directly against the
 * database rather than trusting each action to have remembered: if the challenge
 * is non-terminal and has no open row, one is opened. It is a safety net, not a
 * substitute for `deadlinesFor` — if it ever fires in practice that is a bug in
 * the action, and it says so in the ledger payload.
 */
export async function ensureOpenDeadline(tx: Tx, challengeId: string, status: ChallengeStatus, now: Date): Promise<boolean> {
  const { isTerminal } = await import("@/lib/db/stateMachine");
  if (isTerminal(status) && status !== "PARKED") return false;

  const open = (await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM sla_deadlines
        WHERE challenge_id = ${challengeId} AND fired_at IS NULL AND cancelled_at IS NULL`,
  )) as unknown as Array<{ n: number }>;
  if (Number(open[0]?.n ?? 0) > 0) return false;

  const specs = deadlinesFor(status, { now });
  const rows = specs.length > 0 ? specs : [{ kind: "STAGE_TIMEOUT" as SlaKind, dueAt: new Date(now.getTime() + 30 * 86_400_000), payload: { reason: "invariant-1 backstop" } }];
  await tx.insert(slaDeadlines).values(
    rows.map((r) => ({ challengeId, kind: r.kind, dueAt: r.dueAt, payload: r.payload ?? {}, createdAt: now })),
  );
  return true;
}

export { districtOfficers, admins, reporter, projectPeople, plusDays };
