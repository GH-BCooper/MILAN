/**
 * CLAUDE.md invariant 1: no challenge may silently die.
 *
 * Every challenge in a non-terminal state must have at least one open row in
 * `sla_deadlines`. This is the query that proves it.
 *
 * In Phase 1 it returns a NON-ZERO count, because `deadlinesFor()` in
 * lib/db/stateMachine.ts returns an empty list and nothing creates deadlines
 * yet. So the assertion is skipped — but the query still runs on every CI run
 * and reports the number, so the gap is visible rather than forgotten.
 *
 * PHASE 3 TASK 3.2: implement the SLA engine, then change `it.skip` to `it`
 * below. It must return 0. Do not make this pass any other way.
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
    console.log(
      `[invariant] ${orphans} non-terminal challenge(s) have no open SLA deadline. ` +
        `Expected to be non-zero until Phase 3 Task 3.2.`,
    );
    expect(orphans).toBeTypeOf("number");
  });

  it.skip("every non-terminal challenge has an open SLA deadline (un-skip in Phase 3 Task 3.2)", async () => {
    expect(await countOrphans()).toBe(0);
  });
});
