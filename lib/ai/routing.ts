/**
 * The routing arithmetic and the routing guardrail.
 *
 * Pure: no database, no network, no clock read. Everything in this file is a
 * function of its arguments, which is what lets `tests/routing.test.ts` prove
 * the two claims S5 rests on without a Supabase connection:
 *
 *  - the five match weights sum to 1.00 and the ranking is arithmetic;
 *  - `guardReason` rejects any sentence containing a number nobody supplied,
 *    so CLAUDE.md invariant 4 is enforced in code rather than requested in a
 *    prompt.
 *
 * `lib/ai/stages/s5.ts` does the I/O around this file and nothing else.
 */
import { keywordSetFor } from "./gazetteer";
import type { S5ReasonInput } from "./schemas";

import type { Domain, Hazard } from "@/lib/db/schema";

/** Great-circle distance in km. Used by the distance term and by S3's
 *  corroboration weighting; the earth is not flat and a village 200 km away is
 *  not a witness. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
      ? Math.max(0, cosineSimilarity(ctx.embedding, capability.embedding))
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

/** The three facts the model is allowed to see. Nothing else ever leaves here. */
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

function round(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

/** Cosine similarity between two vectors. The guard keeps it honest when a
 *  vector is not unit-length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
