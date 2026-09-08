/**
 * Restoring the demo to its seeded state, from a button, in under twenty seconds.
 *
 * This does something the rest of Milan is forbidden to do: it writes
 * `challenges.status` directly, without going through the state machine. That is
 * deliberate and it is the same exception migration 0002 makes for TRUNCATE — a
 * demo reset is an OPERATIONAL reset, not a state transition. There is no legal
 * edge out of CLOSED and there should not be; pretending otherwise by adding one
 * would put a hole in the lifecycle for the rest of the product's life so that a
 * button could work.
 *
 * The ledger is deliberately untouched. It is append-only and a reset that
 * erased it would be exactly the thing we tell judges cannot happen. The chain
 * therefore carries the history of every rehearsal, which is the honest outcome.
 */
import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { slaDeadlines, type ChallengeStatus } from "@/lib/db/schema";
import { deadlinesFor } from "@/lib/sla/deadlines";

interface SeedRow {
  district_code: string;
  title: string;
  seed_status?: string;
}

export interface DemoResetReport {
  statusesRestored: number;
  routesCleared: number;
  creditEdgesCleared: number;
  interestsCleared: number;
  flagsCleared: number;
  deadlinesCancelled: number;
  deadlinesOpened: number;
  orphansRemaining: number;
  usedSeedCsv: boolean;
}

/** The statuses the seed assigns, keyed by title, straight from the CSV. */
function seededStatuses(): Map<string, string> {
  const path = join(process.cwd(), "seed-data", "challenges.csv");
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;

  const parsed = Papa.parse<SeedRow>(readFileSync(path, "utf8").replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  for (const row of parsed.data) {
    if (!row?.title) continue;
    out.set(row.title.trim(), (row.seed_status ?? "SUBMITTED").trim() || "SUBMITTED");
  }
  return out;
}

export async function resetToSeedState(): Promise<DemoResetReport> {
  const at = clockNow();
  const atIso = at.toISOString();
  const statuses = seededStatuses();

  // 1. Statuses, back to what the seed CSV says. Matched on title, because that
  //    is the only column the CSV and the database certainly share.
  let statusesRestored = 0;
  if (statuses.size > 0) {
    const values = [...statuses.entries()].map(([title, status]) => sql`(${title}, ${status})`);
    const restored = (await db.execute<{ n: number }>(sql`
      UPDATE challenges c
      SET status = v.status::challenge_status, updated_at = ${atIso}::timestamptz
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(title, status)
      WHERE c.title = v.title AND c.status::text IS DISTINCT FROM v.status
      RETURNING 1 AS n
    `)) as unknown as Array<{ n: number }>;
    statusesRestored = restored.length;
  }

  // 2. Every flag Phase 3 sets, cleared. The impact flags included: a rehearsal
  //    that leaves the counter at 7 makes the next run-through a lie.
  const flags = (await db.execute<{ n: number }>(sql`
    UPDATE challenges SET
      escalation_stage = NULL,
      open_to_all = false,
      grand_challenge = false,
      fork_open = false,
      at_risk_flag = false,
      sla_breached_at = NULL,
      routed_at = NULL,
      impact_confirmed = (status = 'CITIZEN_VERIFIED'),
      impact_partial = false,
      impact_disputed = false,
      citizen_verified_at = CASE WHEN status = 'CITIZEN_VERIFIED' THEN ${atIso}::timestamptz ELSE NULL END,
      citizen_verification_note = NULL,
      updated_at = ${atIso}::timestamptz
    RETURNING 1 AS n
  `)) as unknown as Array<{ n: number }>;

  /**
   * 3. Roll back the work a rehearsal created, for any challenge the CSV has
   *    just put back to a pre-claim status.
   *
   *    Statuses alone are not the demo's state. A run routes the hero challenge
   *    to three institutions, BIT Sindri claims it, a project and its team are
   *    created and the credit chain gains TEAM_MEMBER / MENTOR / FUNDER edges.
   *    Restoring `status` to SUBMITTED and stopping there leaves all of that
   *    behind, so the second rehearsal opens on a "SUBMITTED" challenge whose
   *    routes are already spent, whose claim page says "not available", and
   *    whose public credit chain already names the student team — the ending,
   *    on screen, before the demo begins. It also gives credit for work that,
   *    in the restored world, nobody has done yet.
   *
   *    The cut is by status: routes belong to ROUTED and later, and claim-side
   *    credit to CLAIMED and later. ORIGINATOR and CORROBORATOR
   *    edges are never touched — they come from intake and from a merge, not
   *    from a claim, and erasing them would break the one promise the credit
   *    chain makes. The ledger is untouched here as everywhere else: it still
   *    carries every rehearsal, which is the honest outcome.
   */
  const PRE_ROUTED = sql`('SUBMITTED','TRIAGED','CLASSIFIED','CLUSTERED','PRIORITISED','VERIFIED')`;
  const PRE_CLAIMED = sql`('SUBMITTED','TRIAGED','CLASSIFIED','CLUSTERED','PRIORITISED','VERIFIED','ROUTED')`;

  const routesCleared = (await db.execute<{ n: number }>(sql`
    DELETE FROM routes r USING challenges c
    WHERE r.challenge_id = c.id AND c.status::text IN ${PRE_ROUTED}
    RETURNING 1 AS n
  `)) as unknown as Array<{ n: number }>;

  /**
   * `projects` is deliberately NOT deleted, and cannot be.
   *
   * `ledger_entries.project_id` has a foreign key to it, so dropping the row
   * would either break that reference or force a cascade into the ledger — and
   * the ledger is the one table this reset must never touch. A project pinned by
   * a ledger entry is the chain doing its job: the rehearsal happened, and the
   * evidence that it happened does not get to disappear because we would like a
   * tidier stage. The project is unlinked from the demo instead — its routes and
   * its claim-side credit are cleared, so the challenge presents as unclaimed —
   * and the row itself stays, pinned, exactly as the record says it must.
   */

  const creditEdgesCleared = (await db.execute<{ n: number }>(sql`
    DELETE FROM credit_edges e USING challenges c
    WHERE e.challenge_id = c.id
      AND c.status::text IN ${PRE_CLAIMED}
      AND e.relation::text NOT IN ('ORIGINATOR','CORROBORATOR')
    RETURNING 1 AS n
  `)) as unknown as Array<{ n: number }>;

  const interestsCleared = (await db.execute<{ n: number }>(sql`
    DELETE FROM industry_interests i USING challenges c
    WHERE i.challenge_id = c.id AND c.status::text IN ${PRE_CLAIMED}
    RETURNING 1 AS n
  `)) as unknown as Array<{ n: number }>;

  // 4. Cancel every open deadline — cancelled, never deleted, so the rehearsal
  //    is still visible on /gov/sla afterwards.
  const cancelled = (await db.execute<{ n: number }>(sql`
    UPDATE sla_deadlines SET cancelled_at = ${atIso}::timestamptz
    WHERE fired_at IS NULL AND cancelled_at IS NULL
    RETURNING 1 AS n
  `)) as unknown as Array<{ n: number }>;

  // 5. Re-open the clocks, through the same table the CI invariant checks.
  const open = (await db.execute<{ id: string; status: string }>(sql`
    SELECT id, status::text AS status FROM challenges
    WHERE status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE')
  `)) as unknown as Array<{ id: string; status: string }>;

  const rows: Array<{ challengeId: string; kind: (typeof slaDeadlines.$inferInsert)["kind"]; dueAt: Date; payload: Record<string, unknown>; createdAt: Date }> = [];
  for (const c of open) {
    for (const spec of deadlinesFor(c.status as ChallengeStatus, { now: at })) {
      rows.push({ challengeId: c.id, kind: spec.kind, dueAt: spec.dueAt, payload: { ...(spec.payload ?? {}), demoReset: true }, createdAt: at });
    }
  }
  // One statement rather than one per challenge: the button has a 20-second budget.
  if (rows.length > 0) await db.insert(slaDeadlines).values(rows);

  const orphans = (await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM challenges c
    WHERE c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE','PARKED')
      AND NOT EXISTS (SELECT 1 FROM sla_deadlines d WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL)
  `)) as unknown as Array<{ n: number }>;

  return {
    statusesRestored,
    routesCleared: routesCleared.length,
    creditEdgesCleared: creditEdgesCleared.length,
    interestsCleared: interestsCleared.length,
    flagsCleared: flags.length,
    deadlinesCancelled: cancelled.length,
    deadlinesOpened: rows.length,
    orphansRemaining: Number(orphans[0]?.n ?? 0),
    usedSeedCsv: statuses.size > 0,
  };
}
