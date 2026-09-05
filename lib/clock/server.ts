/**
 * The database side of the demo clock.
 *
 * `demo_state` is a single row and it is the authority for the offset, for two
 * reasons. A serverless instance keeps no memory between invocations, so an
 * in-process offset would differ from function to function; and the reaper's SQL
 * has to agree with the application about what "now" means, which it can only do
 * if both read the same row (see the `clock_now()` SQL function, migration 0007).
 */
import "server-only";

import { eq, sql as raw } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog, demoState } from "@/lib/db/schema";
import { clockNow, elapsedMs } from "./index";
import { cacheAgeMs, envOffsetDays, currentOffsetDays, setCachedOffsetDays } from "./offset";

/** Long enough that a page render does not make several round trips; short
 *  enough that a judge pressing +7 on /demo sees it everywhere immediately. */
const TTL_MS = 5_000;

let inflight: Promise<number> | null = null;

/** Ensure the single `demo_state` row exists. Idempotent. */
async function ensureRow(): Promise<void> {
  await db.execute(
    raw`INSERT INTO demo_state (id, clock_offset_days, emergency_mode)
        VALUES (1, ${envOffsetDays()}::int, false)
        ON CONFLICT (id) DO NOTHING`,
  );
}

/**
 * Refresh the cached offset if it is older than the TTL. Safe to call on every
 * request; concurrent callers share one query. Never throws: an unreachable
 * database leaves the previous value (or the environment fallback) in place,
 * because a page that renders with a five-second-stale clock is a far better
 * outcome than a page that 500s.
 */
export async function syncClockOffset(force = false): Promise<number> {
  const now = elapsedMs();
  if (!force && cacheAgeMs(now) < TTL_MS) return currentOffsetDays();
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const rows = (await db.execute<{ clock_offset_days: number }>(
        raw`SELECT clock_offset_days FROM demo_state WHERE id = 1`,
      )) as unknown as Array<{ clock_offset_days: number }>;
      if (rows.length === 0) {
        await ensureRow();
        setCachedOffsetDays(envOffsetDays(), elapsedMs());
      } else {
        setCachedOffsetDays(Number(rows[0].clock_offset_days), elapsedMs());
      }
    } catch {
      // Leave whatever we had. See the doc comment.
    } finally {
      inflight = null;
    }
    return currentOffsetDays();
  })();

  return inflight;
}

export interface ClockChange {
  offsetDays: number;
  previousDays: number;
  now: Date;
}

async function writeOffset(days: number, actorId: string | null, action: string, reason: string): Promise<ClockChange> {
  await ensureRow();
  const previous = await syncClockOffset(true);
  const next = Math.trunc(days);

  await db.update(demoState).set({ clockOffsetDays: next, updatedAt: clockNow() }).where(eq(demoState.id, 1));
  setCachedOffsetDays(next, elapsedMs());

  await db.insert(auditLog).values({
    actorId,
    action,
    targetType: "demo_state",
    targetId: "1",
    reason,
    meta: { previousDays: previous, offsetDays: next },
    createdAt: clockNow(),
  });

  return { offsetDays: next, previousDays: previous, now: clockNow() };
}

/** Move the demo clock forward (or back, with a negative number) by `days`. */
export async function advanceClock(days: number, actorId: string | null = null): Promise<ClockChange> {
  const previous = await syncClockOffset(true);
  return writeOffset(previous + days, actorId, "demo.clock.advance", `advance ${days} day(s)`);
}

/** Put the demo clock back on real time. */
export async function resetClock(actorId: string | null = null): Promise<ClockChange> {
  return writeOffset(0, actorId, "demo.clock.reset", "reset to real time");
}

/** Set the offset to an absolute number of days. */
export async function setClockOffset(days: number, actorId: string | null = null): Promise<ClockChange> {
  return writeOffset(days, actorId, "demo.clock.set", `set to +${days} day(s)`);
}

/** The offset as the database has it, refreshed. For the banner and /demo. */
export async function clockOffsetDays(): Promise<number> {
  return syncClockOffset();
}

/** Emergency mode is a display-and-filter flag, never a stored-score change. */
export async function emergencyState(): Promise<{ on: boolean; hazard: string | null }> {
  try {
    const rows = (await db.execute<{ emergency_mode: boolean }>(
      raw`SELECT emergency_mode FROM demo_state WHERE id = 1`,
    )) as unknown as Array<{ emergency_mode: boolean }>;
    return { on: Boolean(rows[0]?.emergency_mode), hazard: null };
  } catch {
    return { on: false, hazard: null };
  }
}
