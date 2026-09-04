/**
 * The priority weights. The most important config file in the repository.
 *
 * Who chose these numbers? We did, informed by NDMA's risk framing. That is the
 * honest answer and it is a better one than pretending they are objective. What
 * makes it defensible is everything around them: they are versioned, every score
 * records the version it was computed under, the whole breakdown is on the
 * public challenge page, and a state authority can change them without a
 * redeploy or a migration.
 *
 * They sum to exactly 1.00. `tests/scoring.test.ts` asserts it, because a
 * weights file that silently stopped summing to one would make every score on
 * every screen quietly wrong and nothing would fail.
 */

export const SCORING_VERSION = "1.0.0";

export const WEIGHTS = {
  /** From S2. What happens if nothing is done. */
  severity: 0.22,
  /** From S2. Second-highest on purpose: this is a Disaster Management mandate,
   *  and mitigating a hazard-linked problem is the whole point. */
  hazard: 0.2,
  /** From intake, log-normalised. See normalise.ts for why. */
  peopleAffected: 0.15,
  /** Seeded from the JSDMA district disaster management plans. */
  blockVulnerability: 0.15,
  /** From S3, with diminishing returns so brigading has a bounded payoff. */
  corroborations: 0.12,
  /** From intake. A constant problem outranks a one-off of equal severity. */
  recurrence: 0.1,
  /** A block officer's verification. Small: it should help, never decide. */
  officialEndorsement: 0.06,
} as const;

export type TermKey = keyof typeof WEIGHTS;

export const TERM_ORDER: TermKey[] = [
  "severity",
  "hazard",
  "peopleAffected",
  "blockVulnerability",
  "corroborations",
  "recurrence",
  "officialEndorsement",
];

/** What each term is called on screen, and where its raw value came from. */
export const TERM_LABELS: Record<TermKey, { label: string; source: string }> = {
  severity: { label: "Severity", source: "AI classification (S2)" },
  hazard: { label: "Hazard linkage", source: "AI classification (S2), NDMA hazard class" },
  peopleAffected: { label: "People affected", source: "The reporter's estimate at intake" },
  blockVulnerability: { label: "Block vulnerability", source: "Seeded district disaster management plan" },
  corroborations: { label: "Corroborations", source: "Other people reporting the same problem (S3)" },
  recurrence: { label: "How often it happens", source: "The reporter's answer at intake" },
  officialEndorsement: { label: "Official endorsement", source: "Block officer verification" },
};

/** Guards the invariant at module load as well as in the test. */
export function weightsSum(): number {
  return TERM_ORDER.reduce((sum, key) => sum + WEIGHTS[key], 0);
}
