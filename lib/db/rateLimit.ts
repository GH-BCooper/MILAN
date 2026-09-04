import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "./index";
import { auditLog } from "./schema";

/**
 * Submission rate limiting, loophole row 7.
 *
 * The production design is a verified identity tier plus a trust score that
 * decays when a reporter's claims are repeatedly rejected. Phase 1 ships the two
 * cheap parts of that: a hard floor on report length (in the Zod schema) and
 * this counter.
 *
 * It is backed by `audit_log` rather than an in-memory map on purpose — the app
 * runs as serverless functions and an in-memory counter would reset on every
 * cold start, which is to say it would not exist.
 */
export const SUBMISSIONS_PER_HOUR = 5;

export interface RateLimitVerdict {
  allowed: boolean;
  used: number;
  limit: number;
  retryAfterMinutes: number;
}

/** IP + user, because either alone is trivially defeated. */
export async function checkSubmissionRate(key: {
  ip: string | null;
  userId: string | null;
}): Promise<RateLimitVerdict> {
  const since = new Date(clockNow().getTime() - 3_600_000);
  const identity = key.userId ?? `ip:${key.ip ?? "unknown"}`;

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "challenge.submitted"),
        eq(auditLog.targetType, "rate_key"),
        eq(auditLog.targetId, identity),
        gte(auditLog.createdAt, since),
      ),
    );

  const used = Number(row?.n ?? 0);
  return {
    allowed: used < SUBMISSIONS_PER_HOUR,
    used,
    limit: SUBMISSIONS_PER_HOUR,
    retryAfterMinutes: 60,
  };
}

/** Records one submission against the counter. Called inside the submit transaction. */
export async function recordSubmission(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  key: { ip: string | null; userId: string | null; challengeId: string; trackingId: string },
) {
  const identity = key.userId ?? `ip:${key.ip ?? "unknown"}`;
  await tx.insert(auditLog).values({
    actorId: key.userId,
    action: "challenge.submitted",
    targetType: "rate_key",
    targetId: identity,
    meta: { challengeId: key.challengeId, trackingId: key.trackingId, ip: key.ip },
    createdAt: clockNow(),
  });
}
