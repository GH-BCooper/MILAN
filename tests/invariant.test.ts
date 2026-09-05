/**
 * CLAUDE.md invariant 1: no challenge may silently die.
 *
 * Every challenge in a non-terminal state must have at least one open row in
 * `sla_deadlines`. This is the query that proves it.
 *
 * Phase 1 shipped this skipped, because `deadlinesFor()` returned an empty list
 * and nothing created deadlines. Phase 3 Task 3.2 built the engine and this is
 * now a required CI check that must return 0.
 *
 * If it fails, the missing state is a real hole in `lib/sla/deadlines.ts`. Fix
 * the table. Do not weaken this test, do not narrow the state list, and do not
 * add a status to TERMINAL_STATES to make a number go away.
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { TERMINAL_STATES } = await import("@/lib/db/stateMachine");
const { sql } = await import("drizzle-orm");

const orphanQuery = sql`
  SELECT count(*)::int AS n
  FROM challenges c
  WHERE c.status NOT IN (${sql.join(
    TERMINAL_STATES.map((s) => sql`${s}`),
    sql`, `,
  )})
    AND NOT EXISTS (
      SELECT 1 FROM sla_deadlines d
      WHERE d.challenge_id = c.id
        AND d.fired_at IS NULL
        AND d.cancelled_at IS NULL
    )
`;

async function countOrphans(): Promise<number> {
  const rows = (await db.execute<{ n: number }>(orphanQuery)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

describe("invariant 1: no challenge may silently die", () => {
  it("reports how many non-terminal challenges have no open deadline", async () => {
    const orphans = await countOrphans();
    // Phase 1 has no SLA engine, so this is expected to be non-zero. Printing it
    // keeps the number in front of us on every CI run.
    console.log(`[invariant] ${orphans} non-terminal challenge(s) have no open SLA deadline.`);
    expect(orphans).toBeTypeOf("number");
  });

  it("every non-terminal challenge has an open SLA deadline", async () => {
    expect(await countOrphans()).toBe(0);
  });
});
