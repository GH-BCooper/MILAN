/**
 * The reaper: the thing that makes "no challenge may silently die" true.
 *
 * One function, safe to run concurrently. Vercel Cron can and does overlap runs,
 * and /demo fires it by hand at the same time, so the claim of idempotence has
 * to be structural rather than hopeful:
 *
 *   - due rows are taken `FOR UPDATE SKIP LOCKED`, so a second run picks up
 *     different rows rather than blocking or double-firing;
 *   - the action, the `fired_at` stamp, the ledger entry, the notification rows
 *     and the outbox event are one transaction, so a crash halfway leaves the
 *     deadline unfired and it simply fires next time;
 *   - `due_at <= clock_now()` uses the SQL clock, which reads the same
 *     `demo_state` row the application does. The reaper and the app can never
 *     disagree about whether a deadline has passed.
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { clockNow, elapsedMs } from "@/lib/clock";
import { syncClockOffset } from "@/lib/clock/server";
import { db } from "@/lib/db";
import { challenges, slaDeadlines, type ChallengeStatus, type SlaKind } from "@/lib/db/schema";
import { ensureOpenDeadline, runAction, type ActionPrep, type ChallengeRow, type DeadlineRow } from "./actions";
import { prepareFor } from "./prepare";

export interface FiredDeadline {
  deadlineId: string;
  kind: SlaKind;
  trackingId: string;
  title: string;
  dueAt: string;
  fromStatus: ChallengeStatus;
  toStatus: ChallengeStatus;
  summary: string;
  backstopped: boolean;
}

export interface ReaperResult {
  ranAt: string;
  clockOffsetDays: number;
  scanned: number;
  fired: FiredDeadline[];
  errors: Array<{ deadlineId: string; kind: SlaKind; message: string }>;
  durationMs: number;
}

interface DueRow extends Record<string, unknown> {
  id: string;
  challenge_id: string;
  project_id: string | null;
  kind: SlaKind;
  due_at: string;
  payload: Record<string, unknown> | null;
}

/** How many deadlines one invocation will fire. A reaper that never returns is
 *  worse than a reaper that runs again in five minutes. */
const BATCH = 100;

export async function runReaper(options: { limit?: number } = {}): Promise<ReaperResult> {
  // A duration against the real world, not Milan time — see elapsedMs()'s doc comment.
  const startedAtReal = elapsedMs();
  const offset = await syncClockOffset(true);
  const ranAt = clockNow();
  const fired: FiredDeadline[] = [];
  const errors: ReaperResult["errors"] = [];

  // The claim query. Taken outside the per-row transaction so that a long action
  // does not hold a lock on rows it is not touching.
  const due = (await db.execute<DueRow>(
    sql`SELECT id, challenge_id, project_id, kind, due_at, payload
        FROM sla_deadlines
        WHERE fired_at IS NULL AND cancelled_at IS NULL AND due_at <= clock_now()
        ORDER BY due_at
        LIMIT ${options.limit ?? BATCH}
        FOR UPDATE SKIP LOCKED`,
  )) as unknown as DueRow[];

  for (const row of due) {
    const deadline: DeadlineRow = {
      id: row.id,
      challengeId: row.challenge_id,
      projectId: row.project_id,
      kind: row.kind,
      dueAt: new Date(row.due_at.replace(" ", "T").replace(/\+00$/, "Z")),
      payload: row.payload,
    };

    try {
      const [c] = await db
        .select({
          id: challenges.id,
          trackingId: challenges.trackingId,
          title: challenges.title,
          status: challenges.status,
          districtCode: challenges.districtCode,
          domain: challenges.domain,
          hazard: challenges.hazard,
          reporterId: challenges.reporterId,
        })
        .from(challenges)
        .where(eq(challenges.id, deadline.challengeId))
        .limit(1);

      if (!c) {
        await db.update(slaDeadlines).set({ cancelledAt: ranAt }).where(eq(slaDeadlines.id, deadline.id));
        continue;
      }

      const challenge: ChallengeRow = { ...c, domain: c.domain ?? null, hazard: c.hazard ?? null };
      const fromStatus = challenge.status;

      // Anything slow, external or model-shaped happens HERE, before the
      // transaction opens. Invariant 3 and plain operational sense: a provider
      // that takes four seconds must never be holding a row lock while it does.
      const prep: ActionPrep = await prepareFor(deadline, challenge);

      const result = await db.transaction(async (tx) => {
        // Re-read under lock. If another run already fired it, do nothing.
        const claimed = (await tx.execute<{ id: string }>(
          sql`SELECT id FROM sla_deadlines
              WHERE id = ${deadline.id} AND fired_at IS NULL AND cancelled_at IS NULL
              FOR UPDATE SKIP LOCKED`,
        )) as unknown as Array<{ id: string }>;
        if (claimed.length === 0) return null;

        const out = await runAction({ tx, now: ranAt, deadline, challenge, prep });

        await tx.update(slaDeadlines).set({ firedAt: ranAt }).where(eq(slaDeadlines.id, deadline.id));

        const backstopped = await ensureOpenDeadline(tx, challenge.id, out.newStatus, ranAt);
        return { out, backstopped };
      });

      if (!result) continue;

      fired.push({
        deadlineId: deadline.id,
        kind: deadline.kind,
        trackingId: challenge.trackingId,
        title: challenge.title,
        dueAt: deadline.dueAt.toISOString(),
        fromStatus,
        toStatus: result.out.newStatus,
        summary: result.out.summary,
        backstopped: result.backstopped,
      });

      // Out-of-process delivery, after commit, where a failure costs nothing.
      if (result.out.emails.length > 0) {
        const { deliverAfterCommit } = await import("./deliver");
        await deliverAfterCommit(result.out.emails);
      }
    } catch (e) {
      // Never swallowed: the row stays unfired and will be retried, and the
      // failure is reported to the caller and to /demo's log.
      errors.push({ deadlineId: deadline.id, kind: deadline.kind, message: (e as Error).message });
      console.error(`[sla/reaper] ${deadline.kind} on ${deadline.challengeId} failed:`, e);
    }
  }

  return {
    ranAt: ranAt.toISOString(),
    clockOffsetDays: offset,
    scanned: due.length,
    fired,
    errors,
    durationMs: elapsedMs() - startedAtReal,
  };
}

/** How many deadlines are open, and how many are already overdue. For /demo. */
export async function deadlineHealth(): Promise<{ open: number; overdue: number; fired: number; nextDueAt: string | null }> {
  const rows = (await db.execute<{ open: number; overdue: number; fired: number; next_due: string | null }>(
    sql`SELECT
          count(*) FILTER (WHERE fired_at IS NULL AND cancelled_at IS NULL)::int AS open,
          count(*) FILTER (WHERE fired_at IS NULL AND cancelled_at IS NULL AND due_at <= clock_now())::int AS overdue,
          count(*) FILTER (WHERE fired_at IS NOT NULL)::int AS fired,
          min(due_at) FILTER (WHERE fired_at IS NULL AND cancelled_at IS NULL)::text AS next_due
        FROM sla_deadlines`,
  )) as unknown as Array<{ open: number; overdue: number; fired: number; next_due: string | null }>;
  const r = rows[0];
  return { open: Number(r?.open ?? 0), overdue: Number(r?.overdue ?? 0), fired: Number(r?.fired ?? 0), nextDueAt: r?.next_due ?? null };
}
