/**
 * Task 3.2 verification.
 *
 * Advance the demo clock to +7, +14 and +21 days, run the reaper at each step,
 * and report which ladder rung fired on the unclaimed seeded challenge and what
 * status it reached. Then run the invariant query, which must return 0.
 *
 * Resets the clock at the end, whatever happens.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
const { setClockOffset, resetClock } = await import("@/lib/clock/server");
const { runReaper } = await import("@/lib/sla/reaper");

const TARGET = process.env.SLA_TARGET ?? "JH-2026-ESB-0001";

async function statusOf(trackingId: string) {
  const rows = (await db.execute<{ status: string; escalation_stage: string | null; open_to_all: boolean; grand_challenge: boolean; sla_breached_at: string | null }>(
    sql`SELECT status::text AS status, escalation_stage, open_to_all, grand_challenge, sla_breached_at
        FROM challenges WHERE tracking_id = ${trackingId}`,
  )) as unknown as Array<{ status: string; escalation_stage: string | null; open_to_all: boolean; grand_challenge: boolean; sla_breached_at: string | null }>;
  return rows[0];
}

async function orphans(): Promise<number> {
  const rows = (await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM challenges c
        WHERE c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE','PARKED')
          AND NOT EXISTS (SELECT 1 FROM sla_deadlines d WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL)`,
  )) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

try {
  console.log(`target: ${TARGET}  start: ${JSON.stringify(await statusOf(TARGET))}\n`);

  for (const days of [7, 14, 21, 45]) {
    await setClockOffset(days, null);
    const result = await runReaper();
    const mine = result.fired.filter((f) => f.trackingId === TARGET);
    console.log(`+${String(days).padStart(2)}d  scanned ${String(result.scanned).padStart(3)}  fired ${String(result.fired.length).padStart(3)}  errors ${result.errors.length}  ${result.durationMs}ms`);
    for (const f of mine) {
      console.log(`      ${TARGET}  ${f.kind.padEnd(18)} ${f.fromStatus} -> ${f.toStatus}`);
      console.log(`         ${f.summary}`);
    }
    if (mine.length === 0) console.log(`      ${TARGET}: nothing fired at this step`);
    for (const e of result.errors.slice(0, 5)) console.log(`      ERROR ${e.kind}: ${e.message}`);
    console.log(`      state now: ${JSON.stringify(await statusOf(TARGET))}\n`);
  }

  const n = await orphans();
  console.log(`invariant orphans: ${n}  ${n === 0 ? "PASS" : "FAIL"}`);
  process.exitCode = n === 0 ? 0 : 1;
} finally {
  await resetClock(null);
  console.log("clock reset to 0");
}
process.exit(process.exitCode ?? 0);
