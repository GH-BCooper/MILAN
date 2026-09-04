/**
 * The vocabulary shared by every AI stage.
 *
 * The one idea this whole directory exists to serve (PHASE_2_LEARN.md section 1):
 * the model returns structured facts with a confidence; deterministic code makes
 * every decision. Nothing in `lib/ai/stages/` branches on prose, and S4 does not
 * appear here at all because S4 contains no model call.
 */

/** Every stage that can reach a provider. S4 is deliberately absent. */
export const STAGES = [
  "P0_TRANSLATE",
  "P1_FRAMING",
  "S1_TRIAGE",
  "S2_CLASSIFY",
  "S3_ADJUDICATE",
  "S5_REASON",
  "EMBED",
] as const;

export type StageName = (typeof STAGES)[number];

/** 0 = Gemini, 1 = Groq, 2 = deterministic rules. Recorded on every run and
 *  rendered in the trace, because visible honesty about degradation is stronger
 *  than pretending it never happens. */
export type FallbackLevel = 0 | 1 | 2;

/** What the rules provider reports for anything it decides. It is worse than a
 *  model and it says so, so downstream thresholds treat it as a weak signal. */
export const RULES_CONFIDENCE = 0.45;

export interface ProviderError {
  provider: string;
  message: string;
}

export interface StageRunMeta {
  stage: StageName;
  provider: string;
  model: string | null;
  fallbackLevel: FallbackLevel;
  confidence: number | null;
  latencyMs: number;
  inputHash: string;
  /** True when the answer came out of `ai_cache` rather than off the wire. */
  cached: boolean;
  /** Present when a level fell through, so the trace can say what went wrong. */
  errors: ProviderError[];
}

export interface StageRun<T> {
  value: T;
  meta: StageRunMeta;
}
