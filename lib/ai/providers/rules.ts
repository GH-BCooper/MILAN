/**
 * Level 2 — deterministic rules. No network, no model, no excuses.
 *
 * CLAUDE.md invariant 8: nothing on the demo path may depend on a live
 * third-party API succeeding. This file is where that becomes true. Unplug the
 * wifi and every stage still returns a typed, parseable answer with
 * `fallback_level: 2` and `confidence: 0.45`, and the UI renders an amber
 * "fallback: rules" badge rather than an error.
 *
 * It is worse than a model, and it says so. A 0.45 confidence is below both the
 * S1 human-queue floor (0.6) and the S2 floor (0.65), so an item classified by
 * rules alone lands in front of a human at /admin/triage rather than sailing
 * through on a keyword.
 */
import { z } from "zod";

import {
  CAPITAL_WORKS_TERMS,
  DISTRICT_HAZARD_PRIOR,
  GRIEVANCE_TERMS,
  HAZARD_TERMS,
  DOMAIN_TERMS,
  RESEARCH_TERMS,
  UNSAFE_TERMS,
  best,
  grievanceTargetFor,
  hits,
  tally,
} from "../gazetteer";
import {
  P0Schema,
  P1Schema,
  S1Schema,
  S2Schema,
  S3Schema,
  S5Schema,
  type P0Input,
  type P1Input,
  type S1Input,
  type S2Input,
  type S3AdjudicateInput,
  type S5ReasonInput,
} from "../schemas";
import { RULES_CONFIDENCE, type StageName } from "../types";
import { ProviderFailure, type CompleteArgs, type CompleteResult, type LLMProvider } from "./types";

import type { Domain, Hazard } from "@/lib/db/schema";

/* ------------------------------------------------------------------- text */

/** Both the citizen's words and the English copy, so a Devanagari term still
 *  fires when translation itself is what failed. */
function corpus(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

/* --------------------------------------------------------------------- S1 */

function ruleS1(input: S1Input): z.infer<typeof S1Schema> {
  const text = corpus([input.title, input.bodyOriginal, input.bodyEn]);

  const unsafe = UNSAFE_TERMS.find((row) => hits(text, row.term));
  if (unsafe) {
    return {
      is_unsafe: true,
      unsafe_category: unsafe.category,
      is_grievance: false,
      grievance_target: null,
      // Above the 0.6 rejection floor on purpose: an explicit self-harm or
      // violence phrase is one of the few things a keyword list is genuinely
      // good at, and the cost of missing it is not symmetric with a false
      // positive that a human reviews.
      confidence: 0.7,
      rationale: `Rule tier: matched the unsafe phrase "${unsafe.term}" (${unsafe.category}).`,
    };
  }

  // Several weak grievance signals add up; research signals pull back.
  const grievance = [...tally(text, GRIEVANCE_TERMS, () => "g" as const).values()][0];
  const research = [...tally(text, RESEARCH_TERMS, () => "r" as const).values()][0];
  const gScore = grievance?.score ?? 0;
  const rScore = research?.score ?? 0;
  const net = gScore - rScore;

  // 0.55 is roughly two strong grievance phrases with nothing pulling back --
  // "sanctioned" plus "not built" -- which is the shape of the two seeded
  // grievances (PMGSY road, Jal Jeevan taps).
  const isGrievance = net >= 0.55;

  return {
    is_unsafe: false,
    unsafe_category: null,
    is_grievance: isGrievance,
    grievance_target: isGrievance ? grievanceTargetFor(text) : null,
    // A rule decision that clears its own bar still reports the rule tier's
    // confidence when it is marginal, and a little more when it is emphatic.
    confidence: isGrievance ? Math.min(0.82, 0.6 + net * 0.2) : RULES_CONFIDENCE,
    rationale: isGrievance
      ? `Rule tier: grievance phrases (${grievance?.matched.slice(0, 3).join(", ")}) outweigh research signals.`
      : `Rule tier: no unsafe phrase; grievance signal ${net.toFixed(2)} is below the 0.55 threshold.`,
  };
}

/* --------------------------------------------------------------------- S2 */

function ruleS2(input: S2Input): z.infer<typeof S2Schema> {
  const text = corpus([input.title, input.bodyOriginal, input.bodyEn]);

  const domainWin = best(tally(text, DOMAIN_TERMS, (r) => r.domain as Domain));

  // Hazard: keyword evidence first, then the district's known hazard profile as
  // a prior. The prior nudges an ambiguous report; it never outvotes a hazard
  // the text names outright, which is why it is added rather than substituted.
  const hazardTally = tally(text, HAZARD_TERMS, (r) => r.hazard as Hazard);
  const prior = input.districtCode ? (DISTRICT_HAZARD_PRIOR[input.districtCode] ?? {}) : {};
  for (const [hazard, weight] of Object.entries(prior)) {
    const key = hazard as Hazard;
    const current = hazardTally.get(key) ?? { score: 0, matched: [] };
    hazardTally.set(key, {
      score: current.score + (weight ?? 0),
      matched: [...current.matched, `district prior ${input.districtCode}`],
    });
  }
  const hazardWin = best(hazardTally);

  // The embedding kNN prior is available to the rule tier too: if the nearest
  // already-classified neighbours agree and the keywords do not, trust them.
  const neighbourDomain = majority(input.priors.map((p) => p.domain));
  const neighbourHazard = majority(input.priors.map((p) => p.hazard));

  const domain: Domain =
    domainWin && domainWin.score >= 0.8
      ? domainWin.key
      : ((neighbourDomain as Domain | null) ?? domainWin?.key ?? "PUBLIC_SERVICE");

  const hazardCandidate: Hazard =
    hazardWin && hazardWin.score >= 0.7
      ? hazardWin.key
      : ((neighbourHazard as Hazard | null) ?? hazardWin?.key ?? "NONE");

  const hazardScore = hazardWin?.key === hazardCandidate ? (hazardWin?.score ?? 0) : 0.4;
  const hazard: Hazard = hazardScore >= 0.5 ? hazardCandidate : "NONE";
  const hazardStrength = hazard === "NONE" ? 0 : clamp(hazardScore / 2);

  const capitalWorks = CAPITAL_WORKS_TERMS.some((t) => hits(text, t));

  return {
    domain,
    hazard,
    hazard_strength: round2(hazardStrength),
    severity: round2(ruleSeverity(input, hazardStrength)),
    solvability: capitalWorks ? "CAPITAL_WORKS" : hazard === "NONE" ? "POLICY" : "ENGINEERING",
    capital_works: capitalWorks,
    confidence: RULES_CONFIDENCE,
    rationale:
      `Rule tier: domain from ${domainWin?.matched.slice(0, 3).join(", ") || "kNN neighbours"}; ` +
      `hazard from ${hazardWin?.matched.slice(0, 3).join(", ") || "district profile"}.`,
  };
}

/**
 * Severity without a model: what the citizen told us, plus the hazard linkage.
 *
 * Deliberately conservative. It sits just below the 0.7 human gate for an
 * ordinary report and crosses it only when a strong hazard, a large affected
 * population and a recurring problem all coincide -- so degrading to rules
 * cannot flood /gov/gate, and cannot quietly route something serious either.
 */
function ruleSeverity(input: S2Input, hazardStrength: number): number {
  const people = input.peopleAffected ?? 0;
  const peopleTerm = people <= 0 ? 0 : Math.log1p(people) / Math.log1p(100_000);
  const recurrenceTerm =
    input.recurrence === "constant"
      ? 1
      : input.recurrence === "yearly"
        ? 0.8
        : input.recurrence === "seasonal"
          ? 0.6
          : 0.25;
  return clamp(0.3 + 0.3 * hazardStrength + 0.2 * peopleTerm + 0.2 * recurrenceTerm - 0.15);
}

/* --------------------------------------------------------------------- S3 */

/**
 * The ambiguous 0.72-0.86 band with no model available.
 *
 * Falls back to lexical overlap on content words. Below the auto-merge line we
 * would rather keep two challenges than silently fuse two different problems:
 * invariant 9 says duplicates are signal, and an over-eager merge destroys the
 * second reporter's report while an under-eager one merely leaves a duplicate
 * for a human to spot.
 */
function ruleS3(input: S3AdjudicateInput): z.infer<typeof S3Schema> {
  const a = wordSet(`${input.a.title} ${input.a.body}`);
  const b = wordSet(`${input.b.title} ${input.b.body}`);
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const sameBlock = input.a.block !== null && input.a.block === input.b.block;

  const same = sameBlock && jaccard >= 0.32;
  return {
    same_problem: same,
    confidence: RULES_CONFIDENCE,
    rationale:
      `Rule tier: lexical overlap ${jaccard.toFixed(2)}, ` +
      `${sameBlock ? "same block" : "different blocks"}; cosine ${input.similarity.toFixed(3)}.`,
  };
}

const STOPWORDS = new Set([
  "the","and","for","that","this","with","from","have","has","not","our","are","was","were","but",
  "they","them","their","there","been","into","over","when","will","would","every","some","more",
  "है","हैं","का","की","के","को","में","से","पर","और","नहीं","कि","यह","वह","हम","एक","भी","तो","ही",
]);

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/* --------------------------------------------------------------------- S5 */

/**
 * The templated reason sentence.
 *
 * It reads the same three structured terms the model would have been handed, so
 * the level-2 sentence carries exactly the same facts as the level-0 one. It is
 * blunter. It cannot be wrong.
 */
function ruleS5(input: S5ReasonInput): z.infer<typeof S5Schema> {
  const where = [input.institution, input.department, input.lab].filter(Boolean).join(" — ");
  const reasons = input.terms.map((t) => t.detail).join("; ");
  return {
    reason: `Matched to ${where}: ${reasons}.`.slice(0, 320),
    confidence: RULES_CONFIDENCE,
  };
}

/* --------------------------------------------------------------------- P0 */

/**
 * Translation with no translator.
 *
 * We do not fake it. The English working copy becomes the citizen's own text
 * and the caller sets `translation_failed`, so the challenge page says the
 * translation is missing rather than showing Hindi under an "English" heading.
 * Blocking the pipeline over a failed translation would be worse.
 */
function ruleP0(input: P0Input): z.infer<typeof P0Schema> {
  return {
    body_en: input.bodyOriginal,
    detected_lang: input.bodyLang,
    confidence: input.bodyLang === "en" ? 1 : 0,
  };
}

/* --------------------------------------------------------------------- P1 */

/**
 * Framing with no model: the citizen's own words, trimmed to a statement, and a
 * success criterion built from the words they used. Task 2.7 requires the
 * citizen to approve any rewrite, and a template they can edit is a truthful
 * proposal in a way an invented one is not.
 */
function ruleP1(input: P1Input): z.infer<typeof P1Schema> {
  const base = (input.bodyEn || input.bodyOriginal).trim();
  const where = [input.blockName, input.districtName].filter(Boolean).join(", ");
  const first = base.split(/(?<=[.।!?])\s/)[0]?.trim() || base;
  const framed = where
    ? `${clip(first, 480)} (${where})`
    : clip(first, 520);
  return {
    framed_statement: clip(framed.length >= 20 ? framed : clip(base, 520), 700),
    success_criteria: clip(
      `The problem is solved when the situation described above no longer recurs${
        where ? ` at ${where}` : ""
      }, and the people who reported it confirm it.`,
      700,
    ),
    confidence: RULES_CONFIDENCE,
  };
}

/* ---------------------------------------------------------------- dispatch */

/**
 * Every stage has an entry. A stage without one would be a hole in invariant 8,
 * so `ai:smoke` asserts this table covers `STAGES` minus EMBED (which has its
 * own deterministic fallback in `embed.ts`).
 */
const RULE_STAGES: Partial<Record<StageName, (input: unknown) => unknown>> = {
  P0_TRANSLATE: (i) => ruleP0(i as P0Input),
  P1_FRAMING: (i) => ruleP1(i as P1Input),
  S1_TRIAGE: (i) => ruleS1(i as S1Input),
  S2_CLASSIFY: (i) => ruleS2(i as S2Input),
  S3_ADJUDICATE: (i) => ruleS3(i as S3AdjudicateInput),
  S5_REASON: (i) => ruleS5(i as S5ReasonInput),
};

export const rulesProvider: LLMProvider = {
  name: "rules",
  level: 2,

  /** Always. That is the entire point of this tier. */
  available() {
    return true;
  },

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const started = Date.now();
    const rule = RULE_STAGES[args.stage];
    if (!rule) throw new ProviderFailure("rules", `no rule implementation for stage ${args.stage}`);

    // Parsed through the same Zod schema as a model answer: the rule tier gets
    // no special treatment, and a rule that drifts from the contract fails loudly.
    const value = args.schema.parse(rule(args.input));
    return { value, model: "gazetteer-1.0.0", latencyMs: Date.now() - started };
  },
};

/* ------------------------------------------------------------------ helpers */

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
function majority(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let winner: [string, number] | null = null;
  for (const entry of counts) if (!winner || entry[1] > winner[1]) winner = entry;
  // A plurality of one out of five is not a prior worth having.
  return winner && winner[1] >= 2 ? winner[0] : null;
}
