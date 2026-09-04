/**
 * One normaliser per term. Every one maps its raw value onto 0..1, and every
 * one is documented, because these functions are where the platform's values
 * actually live. A weight says how much a term matters; a normaliser says what
 * counts as "a lot" of it, and that is the more consequential choice.
 */

/** The population above which "people affected" stops adding much. Roughly the
 *  size of a large Jharkhand block headquarters town. */
export const PEOPLE_CEILING = 100_000;

/** The corroboration count at which the term saturates. */
export const CORROBORATION_CEILING = 50;

export const RECURRENCE_VALUES: Record<string, number> = {
  "one-off": 0.25,
  seasonal: 0.6,
  yearly: 0.8,
  constant: 1.0,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * People affected, log-normalised.
 *
 * `log(1+n) / log(1+100000)`.
 *
 * Linear scaling means a town of 6,000 always outranks a hamlet of 300, however
 * severe the hamlet's problem is, and the platform would then systematically
 * serve towns. That is the failure mode we most want to avoid: the villages
 * with the least political reach are exactly the ones whose problems nobody
 * else is going to solve.
 *
 * A log keeps small settlements visible while still preferring scale, all else
 * equal. Concretely: 50 people scores 0.34, 500 scores 0.54, 5,000 scores 0.74.
 * A 10x population buys about 0.2, not 10x.
 *
 * Equity here is a deliberate design choice and we can point at this line.
 */
export function peopleAffected(n: number | null): number {
  if (n === null || n <= 0) return 0;
  return clamp01(Math.log1p(n) / Math.log1p(PEOPLE_CEILING));
}

/**
 * Corroborations, with diminishing returns: `sqrt(n) / sqrt(50)`, capped at 1.
 *
 * Two reasons, and both matter. First, 200 reports of a blocked drain should
 * not outrank one report of a failing embankment — volume is evidence of
 * agreement, not of consequence. Second, it bounds the payoff of a brigading
 * attack: doubling the number of fake corroborations buys 1.41x, not 2x, and
 * the term is capped at 12% of the total score however far it is pushed.
 *
 * Combine with the identity cap and distance decay in S3 (loophole row 7).
 */
export function corroborations(n: number | null): number {
  if (n === null || n <= 0) return 0;
  return clamp01(Math.sqrt(n) / Math.sqrt(CORROBORATION_CEILING));
}

/**
 * Hazard linkage: `hazard_strength` from S2, or exactly 0 when the hazard is
 * NONE. A problem with no NDMA hazard linkage scores nothing here — that is
 * what makes this a disaster risk reduction pipeline rather than a public works
 * queue, and it is visible on the page as a zero-width bar.
 */
export function hazard(hazardClass: string | null, strength: number | null): number {
  if (!hazardClass || hazardClass === "NONE") return 0;
  return clamp01(strength ?? 0);
}

/** Recurrence, straight from the reporter's own answer at intake. */
export function recurrence(value: string | null): number {
  if (!value) return 0;
  return clamp01(RECURRENCE_VALUES[value.toLowerCase()] ?? 0.25);
}

/** The seeded block (or district) vulnerability index, already 0..1. */
export function blockVulnerability(index: number | null): number {
  return clamp01(index ?? 0);
}

/** A block officer has verified this on the ground, or has not. */
export function officialEndorsement(endorsed: boolean): number {
  return endorsed ? 1 : 0;
}

/** Severity, straight from S2. */
export function severity(value: number | null): number {
  return clamp01(value ?? 0);
}
