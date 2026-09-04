/**
 * S4 — the priority score.
 *
 * This function contains no model call, no database access, no network call and
 * no clock read. It is a weighted sum of seven normalised terms and it returns
 * every one of them with its raw value, its normalised value, its weight and
 * its contribution. Put the same input in twice and you get the same number
 * twice, on any machine, forever, and you can check the arithmetic by hand.
 *
 * That purity is the argument. "Is the AI deciding who gets help?" — no: the AI
 * proposes two of the seven inputs and this function, which you can read, does
 * the rest. `tests/scoring.test.ts` proves determinism and the equity property;
 * `<PriorityBreakdown/>` puts the whole table on the public page.
 */
import * as normalise from "./normalise";
import { SCORING_VERSION, TERM_LABELS, TERM_ORDER, WEIGHTS, type TermKey } from "./weights";

export interface ScoringInput {
  severity: number | null;
  hazard: string | null;
  hazardStrength: number | null;
  peopleAffected: number | null;
  blockVulnerability: number | null;
  corroborationCount: number | null;
  recurrence: string | null;
  officialEndorsed: boolean;
}

export interface Term {
  key: TermKey;
  label: string;
  /** What the source system actually said, for display beside the number. */
  rawValue: string;
  /** The raw value as a number where one exists, for a chart or a sort. */
  rawNumber: number | null;
  normalised: number;
  weight: number;
  /** `weight * normalised`, on the same 0..1 scale as the weights. */
  contribution: number;
  source: string;
}

export interface ScoreResult {
  /** 0-100. The scale is presentational; the arithmetic happens in 0..1. */
  total: number;
  version: string;
  terms: Term[];
}

export function computePriority(input: ScoringInput): ScoreResult {
  const values: Record<TermKey, { normalised: number; rawValue: string; rawNumber: number | null }> = {
    severity: {
      normalised: normalise.severity(input.severity),
      rawValue: input.severity === null ? "not classified" : input.severity.toFixed(2),
      rawNumber: input.severity,
    },
    hazard: {
      normalised: normalise.hazard(input.hazard, input.hazardStrength),
      rawValue:
        !input.hazard || input.hazard === "NONE"
          ? "no NDMA hazard linkage"
          : `${input.hazard.replaceAll("_", " ").toLowerCase()}, strength ${(input.hazardStrength ?? 0).toFixed(2)}`,
      rawNumber: input.hazard && input.hazard !== "NONE" ? (input.hazardStrength ?? 0) : 0,
    },
    peopleAffected: {
      normalised: normalise.peopleAffected(input.peopleAffected),
      rawValue:
        input.peopleAffected === null
          ? "not given"
          : `about ${input.peopleAffected.toLocaleString("en-IN")} people`,
      rawNumber: input.peopleAffected,
    },
    blockVulnerability: {
      normalised: normalise.blockVulnerability(input.blockVulnerability),
      rawValue:
        input.blockVulnerability === null ? "not seeded" : input.blockVulnerability.toFixed(2),
      rawNumber: input.blockVulnerability,
    },
    corroborations: {
      normalised: normalise.corroborations(input.corroborationCount),
      rawValue:
        input.corroborationCount === null
          ? "1 report"
          : `${input.corroborationCount} report${input.corroborationCount === 1 ? "" : "s"}`,
      rawNumber: input.corroborationCount,
    },
    recurrence: {
      normalised: normalise.recurrence(input.recurrence),
      rawValue: input.recurrence ?? "not given",
      rawNumber: null,
    },
    officialEndorsement: {
      normalised: normalise.officialEndorsement(input.officialEndorsed),
      rawValue: input.officialEndorsed ? "verified by a block officer" : "not verified",
      rawNumber: input.officialEndorsed ? 1 : 0,
    },
  };

  const terms: Term[] = TERM_ORDER.map((key) => {
    const weight = WEIGHTS[key];
    const { normalised, rawValue, rawNumber } = values[key];
    // Round the normalised value FIRST, then multiply. Invariant 10 says every
    // number on screen is clickable through to its derivation, and that is only
    // true if a judge who multiplies the two numbers we display gets the third
    // number we display. Computing the contribution from the unrounded value
    // makes the visible arithmetic fail in the fourth decimal place.
    const rounded = round(normalised, 4);
    return {
      key,
      label: TERM_LABELS[key].label,
      source: TERM_LABELS[key].source,
      rawValue,
      rawNumber,
      normalised: rounded,
      weight,
      contribution: round(weight * rounded, 6),
    };
  });

  const total = terms.reduce((sum, t) => sum + t.contribution, 0) * 100;

  return { total: round(total, 3), version: SCORING_VERSION, terms };
}

/**
 * The three biggest contributors, which is exactly what S5 is allowed to hand
 * the model when it writes the routing reason. Sorted by contribution, not by
 * weight: a heavily-weighted term with a zero value explains nothing.
 */
export function topContributors(result: ScoreResult, n = 3): Term[] {
  return [...result.terms]
    .filter((t) => t.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, n);
}

/** Fixed-precision rounding, so the same input gives the same bytes. */
function round(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}
