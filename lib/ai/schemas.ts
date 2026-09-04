/**
 * One Zod schema per stage, shared by everything: the prompt's response schema
 * is derived from it, the provider output is parsed by it, the rules tier is
 * type-checked against it, and the trace renders it. If these drift, the
 * pipeline stops being explainable, so they are all in one file.
 *
 * Every stage returns a `confidence` and a short `rationale`. The confidence is
 * the input to a threshold that deterministic code owns; the rationale goes on
 * screen. Neither is decoration.
 */
import { z } from "zod";

import { domainEnum, hazardEnum } from "@/lib/db/schema";

export const DOMAINS = domainEnum.enumValues;
export const HAZARDS = hazardEnum.enumValues;

const confidence = z.number().min(0).max(1);
const unitInterval = z.number().min(0).max(1);

/* ------------------------------------------------------- P0: translation */

export interface P0Input {
  bodyOriginal: string;
  bodyLang: string;
}

export const P0Schema = z.object({
  body_en: z.string().min(1).max(6000),
  /** The model's own reading of the source language; we keep the citizen's. */
  detected_lang: z.string().max(16),
  confidence,
});
export type P0Output = z.infer<typeof P0Schema>;

/* ------------------------------------------------------- P1: the framing */

export interface P1Input {
  bodyOriginal: string;
  bodyEn: string;
  districtName: string | null;
  blockName: string | null;
}

export const P1Schema = z.object({
  framed_statement: z.string().min(20).max(700),
  success_criteria: z.string().min(10).max(700),
  confidence,
});
export type P1Output = z.infer<typeof P1Schema>;

/* ---------------------------------------------------- S1: safety + triage */

export interface S1Input {
  title: string;
  bodyOriginal: string;
  bodyEn: string | null;
  districtCode: string | null;
}

export const S1Schema = z.object({
  is_unsafe: z.boolean(),
  /** SELF_HARM VIOLENCE_THREAT SEXUAL_VIOLENCE CHILD_SAFETY TARGETED_HARASSMENT, or null. */
  unsafe_category: z.string().max(40).nullable(),
  is_grievance: z.boolean(),
  /** CPGRAMS or JharSewa when it is a grievance, otherwise null. */
  grievance_target: z.string().max(40).nullable(),
  confidence,
  rationale: z.string().max(240),
});
export type S1Output = z.infer<typeof S1Schema>;

/* ------------------------------------------ S2: domain, hazard, severity */

export interface S2Input {
  title: string;
  bodyOriginal: string;
  bodyEn: string | null;
  districtCode: string | null;
  districtName: string | null;
  blockName: string | null;
  peopleAffected: number | null;
  recurrence: string | null;
  /** The embedding kNN prior — our declared substitute for fine-tuning. */
  priors: Array<{ title: string; domain: string; hazard: string; similarity: number }>;
}

export const S2Schema = z.object({
  domain: z.enum(DOMAINS),
  hazard: z.enum(HAZARDS),
  /** How strongly this problem is linked to that NDMA hazard. 0 when NONE. */
  hazard_strength: unitInterval,
  severity: unitInterval,
  /** RESEARCH, ENGINEERING, POLICY or CAPITAL_WORKS — what kind of answer it needs. */
  solvability: z.enum(["RESEARCH", "ENGINEERING", "POLICY", "CAPITAL_WORKS"]),
  /** True when the fix is a tender and a contractor, not a research question. */
  capital_works: z.boolean(),
  confidence,
  rationale: z.string().max(240),
});
export type S2Output = z.infer<typeof S2Schema>;

/* --------------------------------------------------- S3: dedup adjudication */

export interface S3AdjudicateInput {
  a: { trackingId: string; title: string; body: string; block: string | null };
  b: { trackingId: string; title: string; body: string; block: string | null };
  similarity: number;
}

export const S3Schema = z.object({
  same_problem: z.boolean(),
  confidence,
  rationale: z.string().max(240),
});
export type S3Output = z.infer<typeof S3Schema>;

/* ------------------------------------------------- S5: the reason sentence */

/**
 * Everything the reason model is allowed to know.
 *
 * Invariant 4: the model writes the sentence around these facts and nothing
 * else. `lib/ai/stages/s5.ts` then re-checks the output for any number that is
 * not in this payload and rejects it. That is a guardrail in code, not a
 * politely-worded instruction.
 */
export interface S5ReasonInput {
  institution: string;
  department: string;
  lab: string | null;
  /** The top three contributors, already computed as weight x value. */
  terms: Array<{ label: string; detail: string; contribution: number }>;
}

export const S5Schema = z.object({
  reason: z.string().min(30).max(320),
  confidence,
});
export type S5Output = z.infer<typeof S5Schema>;
