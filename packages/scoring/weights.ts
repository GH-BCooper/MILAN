/**
 * The priority weights. The most important config file in the repository.
 *
 * Who chose these numbers? We did, informed by the problem statement's demand
 * for transparent, explainable prioritisation across eleven societal domains.
 * That is the honest answer and it is a better one than pretending they are
 * objective. What makes it defensible is everything around them: they are
 * versioned, every score records the version it was computed under, the whole
 * breakdown is on the public challenge page, and a state authority can change
 * them without a redeploy or a migration.
 *
 * v2.0.0 removed the hazard-linkage term: the PS categorises challenges by
 * thematic domain, not by hazard class, so a hazard term would score the
 * framing rather than the problem. Its weight moved mostly into severity and
 * people affected.
 *
 * They sum to exactly 1.00. `tests/scoring.test.ts` asserts it, because a
 * weights file that silently stopped summing to one would make every score on
 * every screen quietly wrong and nothing would fail.
 */

export const SCORING_VERSION = "2.0.0";

export const WEIGHTS = {
  /** From S2. What happens if nothing is done. */
  severity: 0.28,
  /** From intake, log-normalised. See normalise.ts for why. */
  peopleAffected: 0.2,
  /** The equity term: a seeded block need index, falling back to district. */
  blockVulnerability: 0.18,
  /** From S3, with diminishing returns so brigading has a bounded payoff. */
  corroborations: 0.14,
  /** From intake. A constant problem outranks a one-off of equal severity. */
  recurrence: 0.12,
  /** A block officer's verification. Small: it should help, never decide. */
  officialEndorsement: 0.08,
} as const;

export type TermKey = keyof typeof WEIGHTS;

export const TERM_ORDER: TermKey[] = [
  "severity",
  "peopleAffected",
  "blockVulnerability",
  "corroborations",
  "recurrence",
  "officialEndorsement",
];

/** What each term is called on screen, and where its raw value came from. */
export const TERM_LABELS: Record<TermKey, { label: string; source: string }> = {
  severity: { label: "Severity", source: "AI classification (S2)" },
  peopleAffected: { label: "People affected", source: "The reporter's estimate at intake" },
  blockVulnerability: { label: "Block vulnerability", source: "Seeded block need index (district fallback)" },
  corroborations: { label: "Corroborations", source: "Other people reporting the same problem (S3), weighted by reporter trust (v1.1.0)" },
  recurrence: { label: "How often it happens", source: "The reporter's answer at intake" },
  officialEndorsement: { label: "Official endorsement", source: "Block officer verification" },
};

/** Guards the invariant at module load as well as in the test. */
export function weightsSum(): number {
  return TERM_ORDER.reduce((sum, key) => sum + WEIGHTS[key], 0);
}
