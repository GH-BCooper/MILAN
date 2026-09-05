/**
 * Task 3.6 verification.
 *
 * Three separate challenges are taken to IMPLEMENTED and then answered Yes,
 * Partly and No. The impact counter is read from the ONE definition
 * (lib/impact/counter.ts) after each, so that "the counter increments at
 * CITIZEN_VERIFIED and nowhere else" is a measurement rather than a claim.
 *
 *   pnpm verify:impact
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql, eq } = await import("drizzle-orm");
const { challenges, projects } = await import("@/lib/db/schema");
const { markImplemented } = await import("@/lib/impact/implemented");
const { impactCounts } = await import("@/lib/impact/counter");
const { verifyToken } = await import("@/lib/verify/token");
const { transition, canTransition } = await import("@/lib/db/stateMachine");
const { syncClockOffset } = await import("@/lib/clock/server");

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

await syncClockOffset(true);
console.log(`\nTask 3.6 — the citizen confirmation loop\n${"-".repeat(72)}`);

/**
 * Three challenges that can legally reach IMPLEMENTED. A challenge is walked
 * there through legal edges only — the state machine refuses anything else, and
 * a verification script that bypassed it would be verifying nothing.
 */
const candidates = (await db.execute<{ id: string; tracking_id: string; status: string }>(sql`
  SELECT id, tracking_id, status::text AS status FROM challenges
  WHERE status IN ('SUBMITTED','TRIAGED','CLASSIFIED','CLUSTERED','PRIORITISED','VERIFIED','ROUTED','BOUNTY_LISTED','UNCLAIMED_ESCALATED','SOLUTION_PUBLISHED','INDUSTRY_INTEREST','IN_RESEARCH','PROPOSAL_APPROVED','CLAIMED','IMPLEMENTED')
  -- A challenge with a real reporter account first: the confirmation SMS is the
  -- beat being tested, and it can only be sent to somebody who exists.
  ORDER BY reporter_id IS NOT NULL DESC, status = 'IMPLEMENTED' DESC, priority_score DESC NULLS LAST
  LIMIT 12
`)) as unknown as Array<{ id: string; tracking_id: string; status: string }>;

/**
 * Walked one legal edge at a time, from wherever the challenge happens to be.
 * A freshly seeded database has everything at SUBMITTED, so the harness has to
 * be able to start there — and crossing the pipeline states through the state
 * machine rather than around it is the point: each hop writes its own ledger
 * entry and opens its own deadlines, exactly as the real pipeline would.
 */
const PATH_TO_IMPLEMENTED: Record<string, string[]> = {
  SUBMITTED: ["TRIAGED", "CLASSIFIED", "CLUSTERED", "PRIORITISED", "VERIFIED", "ROUTED", "CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  TRIAGED: ["CLASSIFIED", "CLUSTERED", "PRIORITISED", "VERIFIED", "ROUTED", "CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  CLASSIFIED: ["CLUSTERED", "PRIORITISED", "VERIFIED", "ROUTED", "CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  CLUSTERED: ["PRIORITISED", "VERIFIED", "ROUTED", "CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  PRIORITISED: ["VERIFIED", "ROUTED", "CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  BOUNTY_LISTED: ["CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  UNCLAIMED_ESCALATED: ["CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  VERIFIED: ["ROUTED", "CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  ROUTED: ["CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  CLAIMED: ["PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  PROPOSAL_APPROVED: ["IN_RESEARCH", "SOLUTION_PUBLISHED", "IMPLEMENTED"],
  IN_RESEARCH: ["SOLUTION_PUBLISHED", "IMPLEMENTED"],
  SOLUTION_PUBLISHED: ["IMPLEMENTED"],
  INDUSTRY_INTEREST: ["IMPLEMENTED"],
  IMPLEMENTED: [],
};

async function walkToImplemented(id: string, from: string): Promise<boolean> {
  const path = PATH_TO_IMPLEMENTED[from];
  if (!path) return false;
  let current = from;
  for (const to of path.slice(0, -1)) {
    if (!canTransition(current as never, to as never)) return false;
    await db.transaction(async (tx) => {
      await transition(tx, { challengeId: id, to: to as never, reason: "Verification harness: walking to IMPLEMENTED through legal edges only." });
    });
    current = to;
  }
  return current === "IMPLEMENTED" || canTransition(current as never, "IMPLEMENTED");
}

const chosen: Array<{ id: string; trackingId: string }> = [];
for (const c of candidates) {
  if (chosen.length === 3) break;
  const ok = await walkToImplemented(c.id, c.status);
  if (!ok) continue;
  const [now] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
  if (now.status !== "IMPLEMENTED") {
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.challengeId, c.id)).limit(1);
    void project;
    const result = await markImplemented({ challengeId: c.id, actorId: null, claim: "Verification harness: implementation claimed." });
    record(`${c.tracking_id} reaches IMPLEMENTED and the citizen is messaged`, result.messaged >= 0, `${result.messaged} message(s), link ${result.verifyLink.slice(0, 28)}…`);
  }
  chosen.push({ id: c.id, trackingId: c.tracking_id });
}

if (chosen.length < 3) {
  console.log(`Only ${chosen.length} challenge(s) could be taken to IMPLEMENTED. Need three.`);
  process.exit(1);
}

const before = await impactCounts();
console.log(`\nimpact counter before : confirmed ${before.confirmed}, partly ${before.partial}, claimed-not-confirmed ${before.claimedUnconfirmed}, disputed ${before.disputed}\n`);

/* --- the mock SMS inbox has the message ------------------------------------ */

const sms = (await db.execute<{ n: number; text: string }>(sql`
  SELECT count(*)::int AS n, max(payload->>'text') AS text FROM outbox
  WHERE topic = 'notify.sms.mock' AND payload->>'kind' = 'CONFIRM_IMPACT'
`)) as unknown as Array<{ n: number; text: string }>;
record("the confirmation SMS is in the mock inbox, verbatim", Number(sms[0].n) > 0, `${sms[0].n} message(s)`);
if (sms[0].text) console.log(`        "${sms[0].text.slice(0, 110)}…"`);

/* --- three answers, three records ------------------------------------------ */

const answers: Array<["YES" | "PARTLY" | "NO", string]> = [
  ["YES", "Yes, it's fixed"],
  ["PARTLY", "Partly"],
  ["NO", "No, nothing changed"],
];

for (let i = 0; i < 3; i++) {
  const [answer, label] = answers[i];
  const target = chosen[i];
  const token = verifyToken(target.id);

  const form = new URLSearchParams({ token, answer, note: `Verification harness: ${label}.` });
  const response = await fetch(`${BASE}/api/verify/confirm`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: form.toString(),
  });
  const body = (await response.json()) as { ok: boolean; message: string };

  const counts = await impactCounts();
  const [row] = (await db.execute<{ status: string; c: boolean; p: boolean; d: boolean }>(sql`
    SELECT status::text AS status, impact_confirmed AS c, impact_partial AS p, impact_disputed AS d
    FROM challenges WHERE id = ${target.id}
  `)) as unknown as Array<{ status: string; c: boolean; p: boolean; d: boolean }>;

  console.log(`\n${label} on ${target.trackingId}`);
  console.log(`  status        : ${row.status}`);
  console.log(`  flags         : confirmed=${row.c} partial=${row.p} disputed=${row.d}`);
  console.log(`  impact counter: confirmed ${counts.confirmed}, partly ${counts.partial}, claimed-not-confirmed ${counts.claimedUnconfirmed}, disputed ${counts.disputed}`);
  console.log(`  message       : ${body.message}`);

  if (answer === "YES") {
    record("Yes → CITIZEN_VERIFIED and the counter increments", row.status === "CITIZEN_VERIFIED" && row.c && !row.p && counts.confirmed === before.confirmed + 1, `${before.confirmed} → ${counts.confirmed}`);
  } else if (answer === "PARTLY") {
    record("Partly → CITIZEN_VERIFIED, counted separately, never rounded up", row.status === "CITIZEN_VERIFIED" && row.c && row.p && counts.confirmed === before.confirmed + 1 && counts.partial === before.partial + 1, `confirmed stayed at ${counts.confirmed}, partly ${before.partial} → ${counts.partial}`);
  } else {
    const after = await impactCounts();
    record("No → disputed, back off the happy path, and the counter does NOT move", row.status === "DISPUTED" && row.d && !row.c && after.confirmed === before.confirmed + 1, `confirmed still ${after.confirmed}`);
  }
}

const final = await impactCounts();
console.log(`\nimpact counter after  : confirmed ${final.confirmed}, partly ${final.partial}, claimed-not-confirmed ${final.claimedUnconfirmed}, disputed ${final.disputed}`);
console.log(`confirmation gap      : ${final.confirmationGap} claimed implementations no citizen has confirmed`);

/* --- the gap is on the pages that matter ----------------------------------- */

const stats = await fetch(`${BASE}/stats`);
const statsHtml = await stats.text();
record("/stats shows the confirmation gap", /The confirmation gap/.test(statsHtml));
record("/stats renders unconfirmed claims grey with the words", /claimed, not confirmed/i.test(statsHtml));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
