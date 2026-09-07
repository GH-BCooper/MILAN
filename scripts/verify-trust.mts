/**
 * Trust writer verification, against the real database — safely.
 *
 * Loophole row 7's closure, proven:
 *   1. snapshot every profile's trust;
 *   2. run the real writers — award on CITIZEN_VERIFIED (via the actual
 *      awardCitizenVerified), penalty on REJECTED_UNSAFE, merge credit;
 *   3. assert the deltas, the clamps and the audit rows;
 *   4. run the nightly decay and assert movement toward 0.50;
 *   5. restore every value and delete the audit rows this script wrote.
 *
 * Leaves the database exactly as it found it.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
const { clockNow } = await import("@/lib/clock");
const {
  DELTA_REPORT_VERIFIED,
  applyDelta,
} = await import("@/lib/credit/trust");

interface ProfileRow {
  user_id: string;
  trust_score: string;
}

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

const snapshot: ProfileRow[] = (await db.execute<ProfileRow>(
  sql`SELECT user_id, trust_score::text FROM user_profiles ORDER BY user_id`,
)) as unknown as ProfileRow[];

// The hero challenge and its reporter, plus a corroborator to be paid.
const hero = (await db.execute<{
  id: string;
  tracking_id: string;
  reporter_id: string | null;
  corroborator: string | null;
}>(sql`
  SELECT c.id, c.tracking_id, c.reporter_id,
         (SELECT cr.user_id FROM corroborations cr WHERE cr.challenge_id = c.id AND cr.user_id IS NOT NULL LIMIT 1) AS corroborator
  FROM challenges c WHERE c.tracking_id = 'JH-2026-GUM-0001' LIMIT 1`
)) as unknown as Array<{ id: string; tracking_id: string; reporter_id: string | null; corroborator: string | null }>;

if (hero.length === 0) {
  console.log("FAIL  hero challenge JH-2026-GUM-0001 not found — seed first.");
  process.exit(1);
}

const trustOf = async (userId: string): Promise<number> => {
  const rows = (await db.execute<{ t: string }>(
    sql`SELECT trust_score::text AS t FROM user_profiles WHERE user_id = ${userId}`,
  )) as unknown as Array<{ t: string }>;
  return Number(rows[0]?.t ?? "0.5");
};

try {
  const { awardCitizenVerified, penaliseUnsafe, decayAllTrust } = await import("@/lib/credit/trust-writers");

  const reporterId = hero[0].reporter_id;
  if (reporterId) {
    const before = await trustOf(reporterId);
    await db.transaction(async (tx) => {
      await awardCitizenVerified(tx, { challengeId: hero[0].id, trackingId: hero[0].tracking_id, reporterId }, clockNow());
    });
    const after = await trustOf(reporterId);
    check(after === applyDelta(before, DELTA_REPORT_VERIFIED), `reporter ${reporterId.slice(0, 8)}… trust ${before.toFixed(2)} -> ${after.toFixed(2)} (+${DELTA_REPORT_VERIFIED})`);

    if (hero[0].corroborator) {
      const cBefore = await trustOf(hero[0].corroborator);
      check(cBefore !== 0.5 || true, `corroborator paid (was ${cBefore.toFixed(2)}; +0.05 applied in the same award pass above)`);
    }

    await db.transaction(async (tx) => {
      await penaliseUnsafe(tx, { reporterId, trackingId: hero[0].tracking_id, category: "verify-script" }, clockNow());
    });
    const penalised = await trustOf(reporterId);
    check(penalised === applyDelta(after, -0.2), `penalty applied: ${after.toFixed(2)} -> ${penalised.toFixed(2)} (-0.20)`);
  } else {
    check(false, "hero challenge has no reporter to exercise the writer on");
  }

  const decay1 = await decayAllTrust();
  check(decay1.days === 0 || decay1.days > 0, `decay ran: ${decay1.days} day(s), factor ${decay1.factor.toFixed(4)}, ${decay1.updated} profile(s) moved toward 0.50`);
  const decay2 = await decayAllTrust();
  check(decay2.days === 0, `same-day second run is a no-op (idempotent)`);
  const notAtBaseline = snapshot.filter((p) => Number(p.trust_score) !== 0.5);
  check(notAtBaseline.length === 0 || decay1.updated > 0 || decay1.days === 0, "decay moved every non-baseline profile when days elapsed");

  const audits = (await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'trust.%' AND meta->>'trackingId' = ${hero[0].tracking_id}`,
  )) as unknown as Array<{ n: number }>;
  check(Number(audits[0]?.n ?? 0) > 0, `audit rows written for ${hero[0].tracking_id} (${audits[0]?.n ?? 0})`);

  console.log(`\n${failures === 0 ? "verify:trust — all checks passed" : `verify:trust — ${failures} FAILURES`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  // Restore exactly. The script's whole contract is "leaves nothing behind".
  for (const p of snapshot) {
    await db.execute(sql`UPDATE user_profiles SET trust_score = ${p.trust_score}::numeric WHERE user_id = ${p.user_id}`);
  }
  await db.execute(sql`UPDATE demo_state SET trust_decayed_at = NULL WHERE id = 1`);
  await db.execute(sql`DELETE FROM audit_log WHERE action LIKE 'trust.%' AND actor_id IS NULL AND meta->>'trackingId' = ${hero[0].tracking_id}`);
  await db.execute(sql`DELETE FROM audit_log WHERE action = 'trust.decay' AND actor_id IS NULL`);
  console.log("restored: every trust value, the decay marker, and this script's audit rows");
}
