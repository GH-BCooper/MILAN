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
import { keywordSetFor } from "../gazetteer";
import { runWithChain } from "../providers/chain";
import { cosine, embed } from "../providers/embed";
import * as prompt from "../prompts/s5";
import { S5Schema, type S5ReasonInput, type S5Output } from "../schemas";
import { haversineKm } from "./s3";
import type { StageRun } from "../types";

import type { Domain, Hazard } from "@/lib/db/schema";

/* --------------------------------------------------------------- the weights */

export const MATCH_VERSION = "1.0.0";

/** PHASE_2_LEARN.md section 5. Sums to 1.00; asserted in tests/routing.test.ts. */
export const MATCH_WEIGHTS = {
  /** cosine(challenge embedding, capability embedding). */
  semantic: 0.45,
  /** Jaccard of the lab's tags against the challenge's domain + hazard keywords. */
  tagOverlap: 0.2,
  /** exp(-km/250) over the haversine distance to the institution. */
  distance: 0.15,
  /** Declared capstone slots, and zero when the declared window is closed. */
  capacity: 0.12,
  /** Delivered projects in this domain, smoothed. */
  trackRecord: 0.08,
} as const;

export type MatchSignal = keyof typeof MATCH_WEIGHTS;

export const ROUTING = {
  /** Top N distinct organisations. Never two labs of one institution: a
   *  shortlist of three departments in one college is not a shortlist. */
  shortlist: 3,
  /** How long an institution has to claim before the SLA ladder widens it. */
  claimWindowDays: 7,
  /** At or above this severity, nothing is notified until a human at
   *  /gov/gate confirms. PHASE_2_LEARN.md section 8. */
  humanGateSeverity: 0.7,
  /** The distance at which the distance term has decayed to 1/e. */
  distanceDecayKm: 250,
  /** Capacity is scaled against this many declared slots. */
  capacityCeiling: 5,
  /** Laplace smoothing on track record, so one delivered project out of one
   *  does not outrank a department with nine out of ten. */
  trackRecordPrior: 3,
} as const;

/* ---------------------------------------------------------------- the inputs */

export interface CapabilityRow {
  id: string;
  orgId: string;
  orgName: string;
  department: string;
  labName: string | null;
  specialisationTags: string[];
  facultyName: string | null;
  facultyDesignation: string | null;
  declaredCapacity: number;
  capacityFrom: string | null;
  capacityTo: string | null;
  embedding: number[] | null;
  lat: number | null;
  lng: number | null;
}

export interface MatchTerm {
  key: MatchSignal;
  label: string;
  /** The sentence fragment handed to the model. Contains only supplied facts. */
  detail: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface Match {
  capability: CapabilityRow;
  score: number;
  terms: MatchTerm[];
  distanceKm: number | null;
}

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

/** The text a capability is embedded from. Kept here so the seed and the
 *  runtime backfill can never disagree about it. */
export function capabilityText(c: {
  department: string;
  labName: string | null;
  specialisationTags: string[];
  facultyName: string | null;
  facultyDesignation: string | null;
}): string {
  return [
    c.department,
    c.labName ?? "",
    (c.specialisationTags ?? []).join(", "),
    [c.facultyName, c.facultyDesignation].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join("\n");
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

/* ---------------------------------------------------------------- the score */

export interface ScoreContext {
  embedding: number[];
  domain: Domain | null;
  hazard: Hazard | null;
  lat: number | null;
  lng: number | null;
  /** orgId -> { delivered, total } for the challenge's domain. */
  trackRecord: Map<string, { delivered: number; total: number }>;
  now: Date;
}

export function matchScore(capability: CapabilityRow, ctx: ScoreContext): Match {
  /* semantic ------------------------------------------------------------- */
  const semantic =
    capability.embedding && capability.embedding.length > 0
      ? Math.max(0, cosine(ctx.embedding, capability.embedding))
      : 0;

  /* tag overlap ---------------------------------------------------------- */
  const wanted = new Set(keywordSetFor(ctx.domain, ctx.hazard));
  const has = new Set(capability.specialisationTags.map((t) => t.toLowerCase().trim()));
  const shared = [...wanted].filter((t) => has.has(t));
  const union = new Set([...wanted, ...has]).size;
  const tagOverlap = union === 0 ? 0 : shared.length / union;

  /* distance ------------------------------------------------------------- */
  const distanceKm =
    ctx.lat !== null && ctx.lng !== null && capability.lat !== null && capability.lng !== null
      ? haversineKm({ lat: ctx.lat, lng: ctx.lng }, { lat: capability.lat, lng: capability.lng })
      : null;
  // No coordinates is not "infinitely far": it is unknown, and we score it at
  // the value of a middling distance rather than punishing missing seed data.
  const distance = distanceKm === null ? 0.4 : Math.exp(-distanceKm / ROUTING.distanceDecayKm);

  /* capacity ------------------------------------------------------------- */
  const windowOpen = capacityWindowCovers(capability, ctx.now);
  const capacity =
    capability.declaredCapacity > 0 && windowOpen
      ? Math.min(1, capability.declaredCapacity / ROUTING.capacityCeiling)
      : 0;

  /* track record --------------------------------------------------------- */
  const record = ctx.trackRecord.get(capability.orgId) ?? { delivered: 0, total: 0 };
  const trackRecord =
    (record.delivered + 0) / (record.total + ROUTING.trackRecordPrior);

  const raw: Record<MatchSignal, number> = { semantic, tagOverlap, distance, capacity, trackRecord };

  const details: Record<MatchSignal, string> = {
    semantic:
      semantic >= 0.75
        ? "a strong match between the report and the department's declared work"
        : semantic >= 0.55
          ? "a good match to the department's declared work"
          : "a partial match to the department's declared work",
    tagOverlap:
      shared.length > 0
        ? `specialisation tags covering ${shared.slice(0, 4).join(", ")}`
        : "no overlapping specialisation tags",
    distance:
      distanceKm === null
        ? "no institution coordinates on record"
        : `${Math.round(distanceKm)} km from the reported location`,
    capacity: windowOpen
      ? `${capability.declaredCapacity} capstone team slot${capability.declaredCapacity === 1 ? "" : "s"} declared open`
      : "no declared capacity in the current window",
    trackRecord:
      record.delivered > 0
        ? `${record.delivered} delivered project${record.delivered === 1 ? "" : "s"} in this domain`
        : "no delivered projects in this domain yet",
  };

  const terms: MatchTerm[] = (Object.keys(MATCH_WEIGHTS) as MatchSignal[]).map((key) => {
    const weight = MATCH_WEIGHTS[key];
    const value = round(raw[key], 4);
    return {
      key,
      label: SIGNAL_LABELS[key],
      detail: details[key],
      value,
      weight,
      contribution: round(weight * value, 6),
    };
  });

  return {
    capability,
    score: round(terms.reduce((sum, t) => sum + t.contribution, 0), 6),
    terms,
    distanceKm: distanceKm === null ? null : round(distanceKm, 1),
  };
}

export const SIGNAL_LABELS: Record<MatchSignal, string> = {
  semantic: "Semantic fit",
  tagOverlap: "Specialisation overlap",
  distance: "Distance",
  capacity: "Declared capacity",
  trackRecord: "Track record",
};

/** `capacity_from .. capacity_to` covering Milan-now. Both null means always. */
export function capacityWindowCovers(
  c: { capacityFrom: string | null; capacityTo: string | null },
  now: Date,
): boolean {
  if (!c.capacityFrom && !c.capacityTo) return true;
  const day = now.toISOString().slice(0, 10);
  if (c.capacityFrom && day < c.capacityFrom) return false;
  if (c.capacityTo && day > c.capacityTo) return false;
  return true;
}

/**
 * Rank, then take the top N **distinct organisations**.
 *
 * Diversity of shortlist is the point: three labs at one college is one college
 * saying no three times. A challenge that nobody claims must have been offered
 * to three genuinely different places before the SLA ladder widens it.
 */
export function shortlist(matches: Match[], n = ROUTING.shortlist): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const match of [...matches].sort((a, b) => b.score - a.score)) {
    if (seen.has(match.capability.orgId)) continue;
    seen.add(match.capability.orgId);
    out.push(match);
    if (out.length >= n) break;
  }
  return out;
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

/**
 * The guardrail.
 *
 * Rejects a sentence containing any number that does not appear in the facts we
 * supplied. This is the mechanism behind invariant 4, and it is the difference
 * between "we asked the model not to make things up" and "the model cannot make
 * things up". A rejected sentence falls back to the template, which reads the
 * same three terms.
 *
 * Word-numbers ("three slots") are allowed only when the digit is present in
 * the facts, because "three" reads as a fact the same way "3" does.
 */
export function guardReason(
  sentence: string,
  input: S5ReasonInput,
): { ok: true } | { ok: false; reason: string } {
  const supplied = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) supplied.add(normaliseNumber(match[0]));
  };
  collect(input.institution);
  collect(input.department);
  collect(input.lab ?? "");
  for (const term of input.terms) collect(term.detail);

  for (const match of sentence.matchAll(/\d+(?:[.,]\d+)?/g)) {
    if (!supplied.has(normaliseNumber(match[0]))) {
      return { ok: false, reason: `contains the number ${match[0]}, which was not supplied` };
    }
  }

  for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(sentence) && !supplied.has(digit)) {
      return { ok: false, reason: `contains the quantity "${word}", which was not supplied` };
    }
  }

  // A sentence that does not name the institution is not a routing reason.
  if (!sentence.toLowerCase().includes(input.institution.toLowerCase().slice(0, 12))) {
    return { ok: false, reason: "does not name the institution it was given" };
  }

  return { ok: true };
}

const WORD_NUMBERS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

function normaliseNumber(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
}

/** The level-2 sentence: the same three facts, bluntly assembled. */
export function templateReason(input: S5ReasonInput): string {
  const where = [input.institution, input.department, input.lab].filter(Boolean).join(" — ");
  return `Matched to ${where}: ${input.terms.map((t) => t.detail).join("; ")}.`.slice(0, 320);
}

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

/** The three facts the model is allowed to see. Nothing else leaves this file. */
export function reasonInputFor(match: Match): S5ReasonInput {
  const top = [...match.terms]
    .filter((t) => t.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  return {
    institution: match.capability.orgName,
    department: match.capability.department,
    lab: match.capability.labName,
    terms: top.map((t) => ({ label: t.label, detail: t.detail, contribution: t.contribution })),
  };
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
  matches: Match[];
  reasons: ReasonResult[];
}): Promise<S5Result> {
  const at = clockNow();
  const claimWindowEndsAt = clockPlusDays(ROUTING.claimWindowDays);
  const gated = (args.severity ?? 0) >= ROUTING.humanGateSeverity;

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
 * Called immediately for a below-threshold challenge, and by /gov/gate when a
 * District Collector confirms one above it. Every notification links straight
 * to that challenge's claim page: push, never browse.
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

function round(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}
