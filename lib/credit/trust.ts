/**
 * Reporter trust, as pure arithmetic.
 *
 * Loophole row 7 said the quiet part out loud: the decaying trust score had
 * columns and no writer. This module is the writer's maths, kept pure so the
 * whole policy fits in one read and `tests/trust.test.ts` can pin it down
 * without a database.
 *
 * The policy, in one breath: trust is EARNED only when a report or
 * corroboration is later proved real by the one event Milan treats as ground
 * truth — the citizen's own confirmation at CITIZEN_VERIFIED; it is LOST
 * sharply when a report is rejected as unsafe; and it DECAYS toward the 0.50
 * baseline every day, so last year's good deeds do not subsidise this week's
 * brigading. Nobody can buy trust; they can only be right, repeatedly, recently.
 */

/** The baseline every account starts at, and decay always returns toward. */
export const TRUST_BASELINE = 0.5;

/** Daily decay factor applied to the distance from baseline. ~23-day half-life. */
export const TRUST_DAILY_DECAY = 0.97;

/** A report of yours the citizen confirmed fixed: the strongest evidence there is. */
export const DELTA_REPORT_VERIFIED = 0.1;

/** A corroboration of yours on a challenge that reached CITIZEN_VERIFIED. */
export const DELTA_CORROBORATION_VERIFIED = 0.05;

/** Your duplicate report merged as signal (S3): both reporters were right. */
export const DELTA_MERGE_CREDITED = 0.03;

/** A report rejected as unsafe. Large on purpose: one bad actor must cost more
 *  than five good reports earn, or brigading stays profitable. */
export const DELTA_REJECTED_UNSAFE = -0.2;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return TRUST_BASELINE;
  return Math.max(0, Math.min(1, n));
}

/** Apply a delta, clamped to [0, 1]. Rounded to 2dp: the column is numeric(3,2)
 *  and a value that cannot be stored exactly would silently disagree with it. */
export function applyDelta(current: number, delta: number): number {
  return Math.round(clamp01(current + delta) * 100) / 100;
}

/**
 * Decay `current` toward the baseline over `days` elapsed days.
 *
 * `0.5 + (current − 0.5) · 0.97^days`: verified-good reporters come DOWN slowly,
 * penalised reporters come UP slowly (rehabilitation is possible — a person
 * whose report was rejected once is not banned forever), and the baseline
 * itself is a fixed point, so idle accounts neither gain nor lose.
 */
export function decayTrust(current: number, days: number): number {
  if (!Number.isFinite(days) || days <= 0) return Math.round(clamp01(current) * 100) / 100;
  const factor = Math.pow(TRUST_DAILY_DECAY, days);
  return Math.round(clamp01(TRUST_BASELINE + (clamp01(current) - TRUST_BASELINE) * factor) * 100) / 100;
}

/**
 * How much a corroboration from a reporter with this trust is worth, relative
 * to a baseline reporter's. The canonical definition lives in
 * packages/scoring/normalise.ts — beside the corroborations curve it
 * multiplies — and is re-exported here so trust writers and the score cannot
 * drift apart.
 */
export { corroborationTrustWeight as corroborationWeight } from "@/packages/scoring/normalise";

/** The tier label shown on a credit record. Identity tier, not a score band. */
export function tierLabel(verifiedTier: number): string {
  if (verifiedTier >= 3) return "Aadhaar-tier verified identity";
  if (verifiedTier === 2) return "Verified by an official";
  return "Phone-verified";
}
