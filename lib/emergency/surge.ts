/**
 * The Emergency Mode display re-rank, as a pure function.
 *
 * When the state pins a hazard, lists re-sort so linked challenges surface
 * first — but the stored `priority_score` is never rewritten. Instead each
 * linked challenge gets a *display* multiplier derived from its own hazard
 * strength, and the arithmetic is shown beside the number, because invariant 10
 * ("every number is clickable through to its derivation") does not take an
 * emergency off.
 *
 * The multiplier is capped and additive in log space, deliberately modest:
 * a surge must be able to lift a linked challenge above a slightly-higher
 * unlinked one, never float a trivial problem above a severe one. The boost is
 * bounded by SURGE_BOOST_MAX of the score, so an emergency re-orders the top of
 * the list, it does not manufacture a new top of the list.
 */

/** Maximum display boost for a perfect hazard match. */
export const SURGE_BOOST_MAX = 0.25;

export interface SurgeInput {
  /** Stored priority score, 0..100 as displayed, or null when not yet scored. */
  priorityScore: number | null;
  /** The challenge's NDMA hazard class, or null/NONE. */
  hazard: string | null;
  /** The challenge's hazard strength, 0..1. Defaults to 0.5 when unknown. */
  hazardStrength?: number | null;
  /** The hazard the state has pinned, or null when Emergency Mode is off. */
  emergencyHazard: string | null;
}

export interface SurgeResult {
  /** The number to sort by. Equals the stored score when not surged. */
  sortKey: number;
  /** The multiplier applied — always exactly 1 when not surged. */
  multiplier: number;
  /** True when this challenge is linked to the pinned hazard. */
  matched: boolean;
  /** The stored score, untouched, for display beside the sort key. */
  storedScore: number | null;
}

export function surgeRank(input: SurgeInput): SurgeResult {
  const stored = input.priorityScore;
  const base = stored ?? 0;
  const matched =
    Boolean(input.emergencyHazard) &&
    Boolean(input.hazard) &&
    input.hazard !== "NONE" &&
    input.hazard === input.emergencyHazard;

  if (!matched) return { sortKey: base, multiplier: 1, matched: false, storedScore: stored };

  // Unknown strength counts as half-linked: S2 has not measured it, and an
  // emergency list that dropped unmeasured reports would hide the very
  // problems a field officer most needs to see.
  const strength = input.hazardStrength == null ? 0.5 : Math.max(0, Math.min(1, input.hazardStrength));
  const multiplier = 1 + SURGE_BOOST_MAX * strength;
  return { sortKey: base * multiplier, multiplier, matched: true, storedScore: stored };
}

/**
 * The one-line explanation shown beside a surged score. Numbers spelled
 * exactly as computed, so the visible arithmetic checks out by hand.
 */
export function surgeLabel(result: SurgeResult): string | null {
  if (!result.matched || result.storedScore === null) return null;
  return `×${result.multiplier.toFixed(2)} emergency surge = ${result.sortKey.toFixed(1)} (display only; stored score ${result.storedScore.toFixed(1)} unchanged)`;
}

/** Sort helper: descending by sortKey, scored above unscored. */
export function bySurgeDesc(a: SurgeResult & { id?: string }, b: SurgeResult & { id?: string }): number {
  return b.sortKey - a.sortKey;
}
