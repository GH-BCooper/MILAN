import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import {
  capabilities,
  challenges,
  districts,
  organization,
  projectMembers,
  projects,
  routes,
} from "@/lib/db/schema";
import { TERMINAL_STATES } from "@/lib/db/stateMachine";

/**
 * Everything the university workspace reads.
 *
 * Kept out of the pages so the inbox, the dashboard and the claim form all
 * agree about what "an open offer" means. They disagreeing would show up as a
 * department seeing an item in its inbox that the claim page then refuses.
 */

export interface InboxItem {
  routeId: string;
  challengeId: string;
  trackingId: string;
  title: string;
  bodyOriginal: string;
  bodyLang: string;
  bodyEn: string | null;
  framedStatement: string | null;
  status: string;
  districtName: string | null;
  domain: string | null;
  hazard: string | null;
  severity: number | null;
  priorityScore: number | null;
  priorityBreakdown: unknown;
  corroborationCount: number;
  rank: number;
  matchScore: number | null;
  reasonText: string | null;
  reasonTerms: unknown;
  notifiedAt: Date | null;
  claimWindowEndsAt: Date | null;
  department: string | null;
  labName: string | null;
  capabilityId: string | null;
}

/**
 * The routed inbox for one organisation.
 *
 * Sorted by DEADLINE, not by score. A department that sorts its inbox by how
 * interesting the problems look will let the nearly-expired ones expire, and an
 * expired offer is a citizen's report going back into the escalation ladder.
 * The soonest deadline is the top of the list, always.
 */
export async function inboxFor(orgId: string): Promise<InboxItem[]> {
  const rows = await db
    .select({
      routeId: routes.id,
      challengeId: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      bodyOriginal: challenges.bodyOriginal,
      bodyLang: challenges.bodyLang,
      bodyEn: challenges.bodyEn,
      framedStatement: challenges.framedStatement,
      status: challenges.status,
      districtName: districts.name,
      domain: challenges.domain,
      hazard: challenges.hazard,
      severity: challenges.severity,
      priorityScore: challenges.priorityScore,
      priorityBreakdown: challenges.priorityBreakdown,
      corroborationCount: challenges.corroborationCount,
      rank: routes.rank,
      matchScore: routes.matchScore,
      reasonText: routes.reasonText,
      reasonTerms: routes.reasonTerms,
      notifiedAt: routes.notifiedAt,
      claimWindowEndsAt: routes.claimWindowEndsAt,
      department: capabilities.department,
      labName: capabilities.labName,
      capabilityId: capabilities.id,
    })
    .from(routes)
    .innerJoin(challenges, eq(challenges.id, routes.challengeId))
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .leftJoin(capabilities, eq(capabilities.id, routes.capabilityId))
    .where(
      and(
        eq(routes.orgId, orgId),
        eq(routes.state, "OFFERED"),
        // An offer nobody has been told about is not in anyone's inbox: it is
        // sitting at /gov/gate waiting for a District Collector.
        //
        // `!= NULL` is never true in SQL, so this has to be IS NOT NULL. The
        // first version used the former and every inbox was silently empty.
        isNotNull(routes.notifiedAt),
      ),
    )
    .orderBy(asc(routes.claimWindowEndsAt), asc(routes.rank));

  return rows
    .filter((r) => r.notifiedAt !== null && !TERMINAL_STATES.includes(r.status as never))
    .map((r) => ({
      ...r,
      severity: r.severity === null ? null : Number(r.severity),
      priorityScore: r.priorityScore === null ? null : Number(r.priorityScore),
      matchScore: r.matchScore === null ? null : Number(r.matchScore),
    }));
}

/** One offer, by tracking ID, for the claim page. Null when not offered to them. */
export async function offerFor(orgId: string, trackingId: string): Promise<InboxItem | null> {
  const items = await inboxFor(orgId);
  return items.find((i) => i.trackingId === trackingId.toUpperCase()) ?? null;
}

/* ------------------------------------------------------------- the capacity */

export interface CapabilityView {
  id: string;
  department: string;
  labName: string | null;
  specialisationTags: string[];
  facultyName: string | null;
  facultyDesignation: string | null;
  declaredCapacity: number;
  capacityFrom: string | null;
  capacityTo: string | null;
  active: boolean;
  hasEmbedding: boolean;
}

export async function capabilitiesFor(orgId: string): Promise<CapabilityView[]> {
  const rows = await db
    .select({
      id: capabilities.id,
      department: capabilities.department,
      labName: capabilities.labName,
      specialisationTags: capabilities.specialisationTags,
      facultyName: capabilities.facultyName,
      facultyDesignation: capabilities.facultyDesignation,
      declaredCapacity: capabilities.declaredCapacity,
      capacityFrom: capabilities.capacityFrom,
      capacityTo: capabilities.capacityTo,
      active: capabilities.active,
      hasEmbedding: sql<boolean>`${capabilities.embedding} IS NOT NULL`,
    })
    .from(capabilities)
    .where(eq(capabilities.orgId, orgId))
    .orderBy(asc(capabilities.department), asc(capabilities.labName));

  return rows.map((r) => ({ ...r, specialisationTags: r.specialisationTags ?? [] }));
}

/* ------------------------------------------------------------- the projects */

export interface ProjectRow {
  id: string;
  title: string;
  status: string;
  ipTrack: string;
  claimedAt: Date | null;
  lastActivityAt: Date | null;
  trackingId: string;
  challengeTitle: string;
  challengeStatus: string;
  districtName: string | null;
  memberCount: number;
}

export async function projectsFor(orgId: string): Promise<ProjectRow[]> {
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      ipTrack: projects.ipTrack,
      claimedAt: projects.claimedAt,
      lastActivityAt: projects.lastActivityAt,
      trackingId: challenges.trackingId,
      challengeTitle: challenges.title,
      challengeStatus: challenges.status,
      districtName: districts.name,
    })
    .from(projects)
    .innerJoin(challenges, eq(challenges.id, projects.challengeId))
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .where(eq(projects.orgId, orgId))
    .orderBy(desc(projects.claimedAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({ projectId: projectMembers.projectId, n: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(
      inArray(
        projectMembers.projectId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(projectMembers.projectId);

  const byProject = new Map(counts.map((c) => [c.projectId, Number(c.n)]));
  return rows.map((r) => ({ ...r, memberCount: byProject.get(r.id) ?? 0 }));
}

/* -------------------------------------------------------- the challenge bank */

export interface BankItem {
  trackingId: string;
  title: string;
  framedStatement: string | null;
  successCriteria: string | null;
  domain: string | null;
  hazard: string | null;
  districtName: string | null;
  priorityScore: number | null;
  corroborationCount: number;
  status: string;
  offeredElsewhere: boolean;
}

/**
 * The challenge bank: everything a student could take on today.
 *
 * This is the adoption argument. 200,000 Indian students invent a fake
 * final-year project every year; this list is the alternative, and it is
 * deliberately open to any signed-in HEI member rather than gated behind a
 * routing offer — a department that was not in the top three can still ask.
 */
export async function challengeBank(limit = 60): Promise<BankItem[]> {
  const rows = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      framedStatement: challenges.framedStatement,
      successCriteria: challenges.successCriteria,
      domain: challenges.domain,
      hazard: challenges.hazard,
      districtName: districts.name,
      priorityScore: challenges.priorityScore,
      corroborationCount: challenges.corroborationCount,
      status: challenges.status,
    })
    .from(challenges)
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .where(
      and(
        inArray(challenges.status, ["PRIORITISED", "VERIFIED", "ROUTED", "UNCLAIMED_ESCALATED", "BOUNTY_LISTED"]),
        isNull(challenges.parentId),
      ),
    )
    .orderBy(desc(challenges.priorityScore))
    .limit(limit);

  if (rows.length === 0) return [];

  const offered = await db
    .select({ challengeId: routes.challengeId })
    .from(routes)
    .where(
      and(
        eq(routes.state, "OFFERED"),
        inArray(
          routes.challengeId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const offeredSet = new Set(offered.map((o) => o.challengeId));

  return rows.map((r) => ({
    trackingId: r.trackingId,
    title: r.title,
    framedStatement: r.framedStatement,
    successCriteria: r.successCriteria,
    domain: r.domain,
    hazard: r.hazard,
    districtName: r.districtName,
    priorityScore: r.priorityScore === null ? null : Number(r.priorityScore),
    corroborationCount: r.corroborationCount,
    status: r.status,
    offeredElsewhere: offeredSet.has(r.id),
  }));
}

/* ------------------------------------------------------------- the summary */

export interface HeiSummary {
  orgName: string;
  inboxCount: number;
  soonestDeadline: Date | null;
  activeProjects: number;
  capacityRemaining: number;
  capacityDeclared: number;
}

export async function summaryFor(orgId: string): Promise<HeiSummary> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  const [inbox, caps, active] = await Promise.all([
    inboxFor(orgId),
    capabilitiesFor(orgId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.status, "ACTIVE"))),
  ]);

  const now = clockNow();
  const open = caps.filter(
    (c) =>
      c.active &&
      (!c.capacityFrom || now.toISOString().slice(0, 10) >= c.capacityFrom) &&
      (!c.capacityTo || now.toISOString().slice(0, 10) <= c.capacityTo),
  );

  return {
    orgName: org?.name ?? "Your institution",
    inboxCount: inbox.length,
    soonestDeadline: inbox[0]?.claimWindowEndsAt ?? null,
    activeProjects: Number(active[0]?.n ?? 0),
    capacityRemaining: open.reduce((sum, c) => sum + c.declaredCapacity, 0),
    capacityDeclared: caps.reduce((sum, c) => sum + c.declaredCapacity, 0),
  };
}
