/**
 * Open a deadline on every non-terminal challenge that has none.
 *
 * Phase 1 and Phase 2 wrote 34 challenges through a state machine whose
 * `deadlinesFor()` returned an empty list, so every one of them is currently an
 * invariant-1 violation. This is the one-time repair. Re-running it is a no-op:
 * it only touches challenges with no open row.
 *
 * The seed calls this too, so a fresh `pnpm seed --reset` comes up compliant.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
const { clockNow } = await import("@/lib/clock");
const { syncClockOffset } = await import("@/lib/clock/server");
const { deadlinesFor } = await import("@/lib/sla/deadlines");
const { slaDeadlines, projects } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

await syncClockOffset(true);
const now = clockNow();

const orphans = (await db.execute<{ id: string; tracking_id: string; status: string }>(
  sql`SELECT c.id, c.tracking_id, c.status::text AS status
      FROM challenges c
      WHERE c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE')
        AND NOT EXISTS (
          SELECT 1 FROM sla_deadlines d
          WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL
        )
      ORDER BY c.tracking_id`,
)) as unknown as Array<{ id: string; tracking_id: string; status: string }>;

let opened = 0;
for (const c of orphans) {
  const [project] = await db
    .select({ id: projects.id, lastActivityAt: projects.lastActivityAt })
    .from(projects)
    .where(eq(projects.challengeId, c.id))
    .limit(1);

  const specs = deadlinesFor(c.status as never, {
    now,
    projectId: project?.id ?? null,
    lastActivityAt: project?.lastActivityAt ?? null,
  });
  if (specs.length === 0) continue;

  await db.insert(slaDeadlines).values(
    specs.map((s) => ({
      challengeId: c.id,
      projectId: s.projectId ?? project?.id ?? null,
      kind: s.kind,
      dueAt: s.dueAt,
      payload: { ...(s.payload ?? {}), backfilled: true },
      createdAt: now,
    })),
  );
  opened += specs.length;
  console.log(`${c.tracking_id.padEnd(18)} ${c.status.padEnd(22)} ${specs.map((s) => s.kind).join(", ")}`);
}

const [{ n }] = (await db.execute<{ n: number }>(
  sql`SELECT count(*)::int AS n FROM challenges c
      WHERE c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE','PARKED')
        AND NOT EXISTS (SELECT 1 FROM sla_deadlines d WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL)`,
)) as unknown as Array<{ n: number }>;

console.log(`\n${orphans.length} challenge(s) repaired, ${opened} deadline(s) opened. Invariant orphans now: ${n}`);
process.exit(n === 0 ? 0 : 1);
