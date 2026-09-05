/**
 * The demo clock offset, as this process last understood it.
 *
 * `clockNow()` is synchronous — it is called from pure functions, from render
 * paths and from the scoring package, and making it async would rewrite the
 * codebase. So the authoritative value (`demo_state.clock_offset_days`) is read
 * asynchronously by `lib/clock/server.ts` and parked here; `clockNow()` reads
 * this cell. The environment variable is the floor, used before the first
 * successful read and if the database is unreachable.
 *
 * This module deliberately imports nothing: it is shared by server code, by the
 * client banner and by tests.
 */

let cachedDays: number | null = null;
let loadedAtMs = 0;

/** `CLOCK_OFFSET_DAYS`, the fallback authority. Unparseable is treated as zero —
 *  the demo console must never be able to crash production time. */
export function envOffsetDays(): number {
  const raw = typeof process !== "undefined" ? process.env.CLOCK_OFFSET_DAYS : undefined;
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function currentOffsetDays(): number {
  return cachedDays ?? envOffsetDays();
}

export function setCachedOffsetDays(days: number, atMs: number): void {
  cachedDays = Number.isFinite(days) ? days : 0;
  loadedAtMs = atMs;
}

export function cacheAgeMs(nowMs: number): number {
  return cachedDays === null ? Number.POSITIVE_INFINITY : nowMs - loadedAtMs;
}

export function clearCachedOffset(): void {
  cachedDays = null;
  loadedAtMs = 0;
}
