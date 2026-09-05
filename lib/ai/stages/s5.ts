/**
 * S5 — capability routing.
 *
 * Matches a challenge against the Institutional Capability Graph and produces a
 * ranked shortlist of three distinct institutions, each with a written reason.
 *
 * Two things make this defensible under questioning:
 *
 *  1. The match score is computed in TypeScript from five signals with
 *     versioned weights. The model does not rank anything.
 *  2. The reason sentence is written by a model that is handed the top three
 *     contributing terms and nothing else — no challenge text, no institution
 *     facts, no numbers it was not given. `guardReason` then rejects any output
 *     containing a number that is not in the input terms. That is a structural
 *     guarantee enforced in code, not a politely-worded prompt instruction.
 */
import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { clockNow, clockPlusDays } from "@/lib/clock";
import { db } from "@/lib/db";
import {
  capabilities,
  challenges,
  organisationsMeta,
  organization,
  projects,
  routes,
  userProfiles,
  user as userTable,
} from "@/lib/db/schema";
import { runWithChain } from "../providers/chain";
import { embed } from "../providers/embed";
import * as prompt from "../prompts/s5";
import {
  MATCH_VERSION,
  ROUTING,
  capabilityText,
  guardReason,
  reasonInputFor,
  templateReason,
  type CapabilityRow,
  type Match,
  type MatchTerm,
} from "../routing";
import { S5Schema, type S5ReasonInput, type S5Output } from "../schemas";
import type { StageRun } from "../types";

import type { Domain } from "@/lib/db/schema";

/**
 * The arithmetic and the guardrail live in `lib/ai/routing.ts`, which is pure
 * and has its own tests. This file is the I/O around them: loading the
 * capability graph, calling the provider chain for the sentence, and writing
 * the routes. Re-exported so callers have one import site for S5.
 */
export * from "../routing";

/* ---------------------------------------------------------------- the inputs */

/** Every active capability with its institution's location, ready to score. */
export async function loadCapabilities(): Promise<CapabilityRow[]> {
  const rows = await db
    .select({
      id: capabilities.id,
      orgId: capabilities.orgId,
      orgName: organization.name,
      department: capabilities.department,
      labName: capabilities.labName,
      specialisationTags: capabilities.specialisationTags,
      facultyName: capabilities.facultyName,
      facultyDesignation: capabilities.facultyDesignation,
      declaredCapacity: capabilities.declaredCapacity,
      capacityFrom: capabilities.capacityFrom,
      capacityTo: capabilities.capacityTo,
      embedding: capabilities.embedding,
      lat: organisationsMeta.lat,
      lng: organisationsMeta.lng,
      orgType: organisationsMeta.orgType,
    })
    .from(capabilities)
    .innerJoin(organization, eq(organization.id, capabilities.orgId))
    .leftJoin(organisationsMeta, eq(organisationsMeta.orgId, capabilities.orgId))
    .where(eq(capabilities.active, true));

  return rows
    // Only HEIs receive research assignments. A firm expresses interest later,
    // through /industry, and that is a different relationship.
    .filter((r) => r.orgType === "HEI" || r.orgType === null)
    .map((r) => ({
      id: r.id,
      orgId: r.orgId,
      orgName: r.orgName,
      department: r.department,
      labName: r.labName,
      specialisationTags: r.specialisationTags ?? [],
      facultyName: r.facultyName,
      facultyDesignation: r.facultyDesignation,
      declaredCapacity: r.declaredCapacity,
      capacityFrom: r.capacityFrom,
      capacityTo: r.capacityTo,
      embedding: r.embedding,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
    }));
}

/** Embed any capability that has no vector yet. Cached on the input hash, so a
 *  re-run after a seed costs nothing. */
export async function ensureCapabilityEmbeddings(): Promise<number> {
  const missing = await db
    .select({
      id: capabilities.id,
      department: capabilities.department,
      labName: capabilities.labName,
      specialisationTags: capabilities.specialisationTags,
      facultyName: capabilities.facultyName,
      facultyDesignation: capabilities.facultyDesignation,
    })
    .from(capabilities)
    .where(sql`${capabilities.embedding} IS NULL`);

  let n = 0;
  for (const row of missing) {
    const result = await embed(
      capabilityText({ ...row, specialisationTags: row.specialisationTags ?? [] }),
    );
    await db.update(capabilities).set({ embedding: result.vector }).where(eq(capabilities.id, row.id));
    n++;
  }
  return n;
}

/** Delivered-vs-claimed counts per organisation, for the track-record term. */
export async function trackRecordFor(domain: Domain | null): Promise<Map<string, { delivered: number; total: number }>> {
  const rows = await db
    .select({
      orgId: projects.orgId,
      status: projects.status,
      n: sql<number>`count(*)::int`,
    })
    .from(projects)
    .innerJoin(challenges, eq(challenges.id, projects.challengeId))
    .where(domain ? eq(challenges.domain, domain) : isNotNull(challenges.domain))
    .groupBy(projects.orgId, projects.status);

  const map = new Map<string, { delivered: number; total: number }>();
  for (const row of rows) {
    const current = map.get(row.orgId) ?? { delivered: 0, total: 0 };
    current.total += Number(row.n);
    if (row.status === "DELIVERED" || row.status === "COMPLETE") current.delivered += Number(row.n);
    map.set(row.orgId, current);
  }
  return map;
}

/* -------------------------------------------------------- the reason sentence */

export interface ReasonResult {
  text: string;
  guarded: boolean;
  meta: StageRun<S5Output>["meta"] | null;
}

export async function writeReason(
  input: S5ReasonInput,
  challengeId?: string | null,
): Promise<ReasonResult> {
  try {
    const run = await runWithChain({
      stage: "S5_REASON",
      version: prompt.VERSION,
      system: prompt.SYSTEM,
      user: prompt.render(input),
      schema: S5Schema,
      input,
      challengeId,
      confidenceOf: (v) => v.confidence,
    });

    const verdict = guardReason(run.value.reason, input);
    if (verdict.ok) return { text: run.value.reason, guarded: false, meta: run.meta };

    console.warn(`[s5] reason rejected by the guardrail: ${verdict.reason}`);
    return { text: templateReason(input), guarded: true, meta: run.meta };
  } catch (e) {
    console.warn("[s5] reason generation failed entirely", e);
    return { text: templateReason(input), guarded: true, meta: null };
  }
}



/* ------------------------------------------------------------- the persister */

export interface RouteRow {
  rank: number;
  orgId: string;
  orgName: string;
  capabilityId: string;
  department: string;
  labName: string | null;
  matchScore: number;
  reasonText: string;
  reasonTerms: MatchTerm[];
  guarded: boolean;
}

export interface S5Result {
  routes: RouteRow[];
  gated: boolean;
  severity: number | null;
  notified: number;
  claimWindowEndsAt: Date;
}

/**
 * Write the shortlist.
 *
 * The human gate: at severity 0.7 or above the routes are created in OFFERED
 * with `notified_at = null` and nothing is sent. The challenge waits at
 * /gov/gate for the District Collector of that district — and only that
 * district — to confirm or override. Confirmation releases the notifications
 * and moves the challenge to ROUTED. Below the threshold it releases
 * immediately.
 *
 * The AI never takes a consequential action alone.
 */
export async function persistRoutes(args: {
  challengeId: string;
  trackingId: string;
  severity: number | null;
  /** False when the challenge is still held for a human and must not be offered. */
  canRoute?: boolean;
  matches: Match[];
  reasons: ReasonResult[];
}): Promise<S5Result> {
  const at = clockNow();
  const claimWindowEndsAt = clockPlusDays(ROUTING.claimWindowDays);

  /**
   * Two independent reasons to hold everything back.
   *
   * The first is the human gate: severity at or above 0.7 waits for a District
   * Collector (PHASE_2_LEARN.md section 8).
   *
   * The second is subtler and was a real bug. A challenge S1 held for human
   * triage is still SUBMITTED, and `advance()` correctly refuses to move it to
   * ROUTED — but nothing stopped S5 emailing three institutions about it first.
   * The state machine would then refuse every claim they tried to make.
   * Nothing is offered to a university until the platform is confident enough
   * to have moved the challenge past triage.
   */
  const readyToRoute = args.canRoute !== false;
  const gated = (args.severity ?? 0) >= ROUTING.humanGateSeverity || !readyToRoute;

  const rows: RouteRow[] = args.matches.map((match, i) => ({
    rank: i + 1,
    orgId: match.capability.orgId,
    orgName: match.capability.orgName,
    capabilityId: match.capability.id,
    department: match.capability.department,
    labName: match.capability.labName,
    matchScore: match.score,
    reasonText: args.reasons[i]?.text ?? templateReason(reasonInputFor(match)),
    reasonTerms: [...match.terms]
      .filter((t) => t.contribution > 0)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3),
    guarded: args.reasons[i]?.guarded ?? true,
  }));

  await db.transaction(async (tx) => {
    // Replaying S5 must not leave two generations of offers on one challenge.
    await tx.delete(routes).where(and(eq(routes.challengeId, args.challengeId), eq(routes.state, "OFFERED")));

    if (rows.length > 0) {
      await tx.insert(routes).values(
        rows.map((r) => ({
          challengeId: args.challengeId,
          orgId: r.orgId,
          capabilityId: r.capabilityId,
          rank: r.rank,
          matchScore: r.matchScore.toFixed(3),
          reasonText: r.reasonText,
          reasonTerms: {
            version: MATCH_VERSION,
            terms: r.reasonTerms,
            guardrailFallback: r.guarded,
          },
          // The gate, in one line: nothing is notified until a human says so.
          notifiedAt: gated ? null : at,
          claimWindowEndsAt,
          state: "OFFERED",
          createdAt: at,
        })),
      );
    }
  });

  let notified = 0;
  if (!gated && rows.length > 0) {
    notified = await releaseNotifications(args.challengeId, args.trackingId);
  }

  return { routes: rows, gated, severity: args.severity, notified, claimWindowEndsAt };
}

/**
 * Send the offers.
 *
 * Called immediately for a below-threshold challenge, and by `releaseGate` when
 * a District Collector confirms one above it. Every notification links straight
 * to that challenge's claim page: push, never browse.
 *
 * This function only NOTIFIES. Moving the challenge on is `releaseGate`'s job,
 * because the two are not the same thing and conflating them was a real bug:
 * a gated challenge that had been notified but left at VERIFIED could not then
 * be claimed, since VERIFIED -> CLAIMED is not a legal edge.
 */
export async function releaseNotifications(
  challengeId: string,
  trackingId: string,
): Promise<number> {
  const { notify } = await import("@/lib/notify");
  const at = clockNow();

  const offers = await db
    .select({
      id: routes.id,
      orgId: routes.orgId,
      rank: routes.rank,
      reasonText: routes.reasonText,
      claimWindowEndsAt: routes.claimWindowEndsAt,
      orgName: organization.name,
    })
    .from(routes)
    .innerJoin(organization, eq(organization.id, routes.orgId))
    .where(and(eq(routes.challengeId, challengeId), eq(routes.state, "OFFERED")));

  const [challenge] = await db
    .select({ title: challenges.title, districtCode: challenges.districtCode })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);

  let sent = 0;
  for (const offer of offers) {
    const members = await db
      .select({ userId: userProfiles.userId, email: userTable.email, phone: userProfiles.phone })
      .from(userProfiles)
      .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
      .where(and(eq(userProfiles.orgId, offer.orgId), eq(userProfiles.role, "HEI_MEMBER")));

    const deadline = offer.claimWindowEndsAt
      ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(
          offer.claimWindowEndsAt,
        )
      : "shortly";

    for (const member of members) {
      await notify({
        userId: member.userId,
        orgId: offer.orgId,
        email: member.email,
        phone: member.phone,
        kind: "CHALLENGE_ROUTED",
        title: `A real final-year project, matched to your department`,
        body:
          `${trackingId}: ${challenge?.title ?? "A citizen report"}. ${offer.reasonText} ` +
          `You are rank ${offer.rank} of 3. The claim window closes on ${deadline}.`,
        // Push, never browse. Straight to the claim form for this challenge.
        actionUrl: `/hei/challenges/${trackingId}/claim`,
        channels: ["inapp", "email"],
      });
      sent++;
    }

    // An organisation-scoped copy, so a department with no registered member
    // still has the offer on record rather than the offer silently vanishing.
    if (members.length === 0) {
      await notify({
        orgId: offer.orgId,
        kind: "CHALLENGE_ROUTED",
        title: `A real final-year project, matched to your department`,
        body: `${trackingId}: ${challenge?.title ?? "A citizen report"}. ${offer.reasonText}`,
        actionUrl: `/hei/challenges/${trackingId}/claim`,
        channels: ["inapp"],
      });
      sent++;
    }
  }

  await db
    .update(routes)
    .set({ notifiedAt: at })
    .where(and(eq(routes.challengeId, challengeId), eq(routes.state, "OFFERED")));

  return sent;
}



/**
 * Release a challenge the human gate is holding.
 *
 * What a District Collector's confirmation at /gov/gate actually does: move the
 * challenge from VERIFIED to ROUTED, then send the three offers. The state
 * change is its own transaction so the ledger and the status agree, and the
 * notifications go out afterwards, because an email that fails must not roll
 * back a decision an officer has made.
 *
 * Separating this from `releaseNotifications` is not tidiness. The first
 * version notified without transitioning, which left a challenge notified but
 * still VERIFIED — and VERIFIED -> CLAIMED is not a legal edge, so the three
 * institutions received an offer none of them could accept.
 */
export async function releaseGate(args: {
  challengeId: string;
  trackingId: string;
  actorId?: string | null;
  reason?: string | null;
}): Promise<{ notified: number; status: string }> {
  const [before] = await db
    .select({ status: challenges.status })
    .from(challenges)
    .where(eq(challenges.id, args.challengeId))
    .limit(1);

  if (!before) throw new Error(`challenge ${args.challengeId} not found`);

  const { canTransition, transition } = await import("@/lib/db/stateMachine");

  if (canTransition(before.status, "ROUTED")) {
    await db.transaction(async (tx) => {
      await transition(tx, {
        challengeId: args.challengeId,
        to: "ROUTED",
        actorId: args.actorId ?? null,
        reason: args.reason ?? "Released by a district officer after the human gate.",
        meta: { by: "gov-gate" },
      });
    });
  }

  const notified = await releaseNotifications(args.challengeId, args.trackingId);

  const [after] = await db
    .select({ status: challenges.status })
    .from(challenges)
    .where(eq(challenges.id, args.challengeId))
    .limit(1);

  return { notified, status: after?.status ?? before.status };
}
