/**
 * `packages/scoring` — the priority function.
 *
 * Pure by contract: no database, no network, no clock, no imports from `app/`,
 * no imports from `lib/`. `tests/scoring.test.ts` asserts that contract by
 * reading the source of every file in this directory, so it cannot rot into a
 * comment that used to be true.
 */
export { computePriority, topContributors, type ScoreResult, type ScoringInput, type Term } from "./score";
export {
  SCORING_VERSION,
  TERM_LABELS,
  TERM_ORDER,
  WEIGHTS,
  weightsSum,
  type TermKey,
} from "./weights";
export * as normalise from "./normalise";
export {
  CORROBORATION_CEILING,
  PEOPLE_CEILING,
  RECURRENCE_VALUES,
} from "./normalise";
