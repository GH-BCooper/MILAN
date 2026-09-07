/**
 * The trust score's writers — the only code allowed to touch
 * `user_profiles.trust_score`, which is enforced by there being exactly one
 * private `adjust()` here and everything else going through a named, audited
 * event. Loophole row 7's "declared partial" ends at this file.
 *
 * Every write carries an audit_log row: who moved, by how much, and the
 * challenge that earned it. Trust is never adjusted by a human, never
 * configurable per district, and never derived from anything but outcomes —
 * which is the whole anti-brigading argument: you cannot farm it, you can only
 * be right, repeatedly, recently (see lib/credit/trust.ts for the arithmetic).
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { auditLog, corroborations, demoState, userProfiles } from "@/lib/db/schema";
import {
  DELTA_CORROBORATION_VERIFIED,
  DELTA_MERGE_CREDITED,
  DELTA_REJECTED_UNSAFE,
  DELTA_REPORT_VERIFIED,
  TRUST_DAILY_DECAY,
  decayTrust,
} from "./trust";

interface TrustEvent {
  userId: string | null;
  delta: number;
  /** e.g. "report.verified" — the named event, for the audit trail. */
  event: string;
  trackingId?: string;
  note?: string;
}

/** The single writer. Returns the userId actually adjusted, or null. */
async function adjust(tx: Tx, e: TrustEvent, at: Date): Promise<string | null> {
  if (!e.userId || e.delta === 0) return null;

  // Numeric arithmetic in SQL with the same clamp+round as lib/credit/trust.ts,
  // so a concurrent write cannot read-modify-write past the bounds.
  const updated = await tx
    .update(userProfiles)
    .set({
      trustScore: sql`ROUND(LEAST(1, GREATEST(0, ${userProfiles.trustScore} + ${e.delta.toFixed(2)}::numeric))::numeric, 2)`,
    })
    .where(eq(userProfiles.userId, e.userId))
    .returning({ userId: userProfiles.userId, trustScore: userProfiles.trustScore });
  if (updated.length === 0) return null;

  await tx.insert(auditLog).values({
    actorId: null,
    action: `trust.${e.event}`,
    targetType: "user_profiles",
    targetId: e.userId,
    reason: e.note ?? `Trust ${e.delta > 0 ? "+" : ""}${e.delta.toFixed(2)} from ${e.event}`,
    meta: { delta: e.delta, event: e.event, trackingId: e.trackingId ?? null, to: updated[0].trustScore },
    createdAt: at,
  });
  return e.userId;
}

/**
 * The citizen confirmed the fix. The one event Milan treats as ground truth
 * (invariant 7) is therefore also the only event that earns real trust: the
 * reporter whose problem was real and solved, and everyone whose
 * corroboration backed it.
 */
export async function awardCitizenVerified(
  tx: Tx,
  input: { challengeId: string; trackingId: string; reporterId: string | null },
  at: Date = clockNow(),
): Promise<{ reporter: string | null; corroborators: string[] }> {
  const reporter = await adjust(
    tx,
    {
      userId: input.reporterId,
      delta: DELTA_REPORT_VERIFIED,
      event: "report.verified",
      trackingId: input.trackingId,
      note: `The citizen confirmed the fix on ${input.trackingId}. The strongest evidence of a real report there is.`,
    },
    at,
  );

  const backs = await tx
    .select({ userId: corroborations.userId })
    .from(corroborations)
    .where(eq(corroborations.challengeId, input.challengeId));

  const seen = new Set<string>(reporter ? [reporter] : []);
  const corroborators: string[] = [];
  for (const b of backs) {
    if (!b.userId || seen.has(b.userId)) continue; // the reporter is not their own corroborator
    seen.add(b.userId);
    const done = await adjust(
      tx,
      {
        userId: b.userId,
        delta: DELTA_CORROBORATION_VERIFIED,
        event: "corroboration.verified",
        trackingId: input.trackingId,
        note: `Corroborated ${input.trackingId}, which the citizen confirmed as fixed.`,
      },
      at,
    );
    if (done) corroborators.push(done);
  }
  return { reporter, corroborators };
}

/** A report was rejected as unsafe. The sharp cost that makes brigading unprofitable. */
export async function penaliseUnsafe(
  tx: Tx,
  input: { reporterId: string | null; trackingId: string; category: string },
  at: Date = clockNow(),
): Promise<string | null> {
  return adjust(
    tx,
    {
      userId: input.reporterId,
      delta: DELTA_REJECTED_UNSAFE,
      event: "report.rejected_unsafe",
      trackingId: input.trackingId,
      note: `${input.trackingId} was rejected as unsafe (${input.category}).`,
    },
    at,
  );
}

/** Two people reported the same physical problem and both were right (S3 merge). */
export async function awardMerge(
  tx: Tx,
  input: { survivorReporterId: string | null; loserReporterId: string | null; survivorTrackingId: string; loserTrackingId: string },
  at: Date = clockNow(),
): Promise<void> {
  await adjust(
    tx,
    {
      userId: input.survivorReporterId,
      delta: DELTA_MERGE_CREDITED,
      event: "report.merged",
      trackingId: input.survivorTrackingId,
      note: `${input.loserTrackingId} merged into ${input.survivorTrackingId}: the problem was real enough for two independent reports.`,
    },
    at,
  );
  await adjust(
    tx,
    {
      userId: input.loserReporterId,
      delta: DELTA_MERGE_CREDITED,
      event: "report.merged",
      trackingId: input.loserTrackingId,
      note: `Merged into ${input.survivorTrackingId} as signal, not noise. Both reporters credited.`,
    },
    at,
  );
}

export interface DecayResult {
  /** Elapsed days applied. 0 means the no-op branch (already decayed today). */
  days: number;
  updated: number;
  factor: number;
}

/**
 * The nightly decay, applied to every profile in one statement.
 *
 * Idempotent by construction: the elapsed days come from
 * `demo_state.trust_decayed_at`, which is stamped in the same transaction, so
 * two cron runs in one night apply the second as a no-op and a cron that
 * disappears for a week applies seven days when it returns. Accounts exactly at
 * the baseline are skipped — it is a fixed point, and leaving them out of the
 * write keeps the demo database's audit trail free of no-op rows.
 */
export async function decayAllTrust(): Promise<DecayResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(demoState)
      .values({ id: 1, trustDecayedAt: null })
      .onConflictDoNothing({ target: demoState.id });

    const now = clockNow();
    const rows = (await tx.execute<{ last: string | null }>(
      sql`SELECT trust_decayed_at::text AS last FROM demo_state WHERE id = 1 FOR UPDATE`,
    )) as unknown as Array<{ last: string | null }>;
    const last = rows[0]?.last ? new Date(rows[0].last.replace(" ", "T").replace(/\+00$/, "Z")) : null;

    const MS_PER_DAY = 86_400_000;
    const elapsedDays = last ? (now.getTime() - last.getTime()) / MS_PER_DAY : 0;
    // A same-day double run is a no-op, not a double decay.
    const days = Math.floor(elapsedDays);
    const factor = Math.pow(TRUST_DAILY_DECAY, days);

    if (days < 1) {
      await tx
        .update(demoState)
        .set({ trustDecayedAt: last ?? now, updatedAt: now })
        .where(eq(demoState.id, 1));
      return { days: 0, updated: 0, factor: 1 };
    }

    const updated = (await tx.execute<{ id: string }>(sql`
      UPDATE user_profiles
      SET trust_score = ROUND((0.5 + (trust_score - 0.5) * ${factor}::float8)::numeric, 2)
      WHERE trust_score <> 0.5
      RETURNING user_id AS id
    `)) as unknown as Array<{ id: string }>;

    await tx.update(demoState).set({ trustDecayedAt: now, updatedAt: now }).where(eq(demoState.id, 1));

    await tx.insert(auditLog).values({
      actorId: null,
      action: "trust.decay",
      targetType: "user_profiles",
      targetId: null,
      reason: `Nightly trust decay: ${days} day(s) at factor ${factor.toFixed(4)} toward the 0.50 baseline`,
      meta: { days, factor, updated: updated.length, note: decayNote() },
      createdAt: now,
    });

    return { days, updated: updated.length, factor };
  });
}

function decayNote(): string {
  // Kept honest for the audit trail: the formula is public and pure.
  return `0.5 + (trust - 0.5) * ${TRUST_DAILY_DECAY}^days, clamped and rounded to 2dp. See lib/credit/trust.ts.`;
}

/** For the verification harness: the pure decay, exported through the writer's door. */
export { decayTrust };
