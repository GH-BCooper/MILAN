/**
 * Every timestamp in Milan flows through here.
 *
 * The Phase 3 demo fast-forward works by moving a single offset, so that a judge
 * can watch a 72-hour SLA breach happen in ten seconds. That only works if
 * nothing in the codebase calls `Date.now()` or `new Date()` directly.
 * `tests/no-raw-date.test.ts` enforces this by grepping `app/` and `lib/`.
 *
 * Phase 1: the offset comes from the `CLOCK_OFFSET_DAYS` environment variable.
 * Phase 3: `demo_state.clock_offset_days` becomes the authority and this module
 * reads it through a request-scoped cache. The signature does not change.
 */

const MS_PER_DAY = 86_400_000;

/** Parsed once per process. An unparseable value is treated as zero offset — the
 *  demo console must never be able to crash production time. */
function offsetDays(): number {
  const raw = process.env.CLOCK_OFFSET_DAYS;
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The current time as Milan understands it. Use this everywhere. */
export function clockNow(): Date {
  // The one sanctioned read of wall-clock time in the whole codebase.
  const wall = Date.now();
  return new Date(wall + offsetDays() * MS_PER_DAY);
}

/** Milliseconds since epoch, Milan time. */
export function clockNowMs(): number {
  return clockNow().getTime();
}

/** `d` days from Milan-now. Used by the SLA engine to compute `due_at`. */
export function clockPlusDays(days: number): Date {
  return new Date(clockNowMs() + days * MS_PER_DAY);
}

/** `h` hours from Milan-now. */
export function clockPlusHours(hours: number): Date {
  return new Date(clockNowMs() + hours * 3_600_000);
}

/** The active demo offset, for display in the admin console. */
export function currentClockOffsetDays(): number {
  return offsetDays();
}

/**
 * Real elapsed milliseconds, never Milan time.
 *
 * `clockNow()` is what the product means by "now" and the Phase 3 demo console
 * can move it by thirty days. Two kinds of measurement must NOT move with it:
 *
 *   - how long a provider call took. A latency of "-2,592,000,000 ms" in the
 *     trace panel would be a bug in the receipt, not a fast-forward.
 *   - how long a rate-limit cool-off has left. Jump the clock forward and a
 *     cool-off would expire instantly; jump it back and it would never expire.
 *
 * Those are durations against the real world, so they read the real wall clock
 * through here. Anything a citizen, a deadline or a ledger entry can see uses
 * `clockNow()` instead. If you are not sure which you need, you need clockNow().
 */
export function elapsedMs(): number {
  return Date.now();
}
