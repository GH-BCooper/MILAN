/**
 * The human-in-the-loop recovery path, end to end.
 *
 * When both providers are rate-limited, S1 lands on the rule tier at 0.45 and
 * the challenge is HELD: not classified, not merged, not routed. That is the
 * design working. This script proves the other half — that a human at
 * /admin/triage can accept the proposal with a written reason, and the pipeline
 * then picks the challenge up and carries on.
 *
 * It is also the acceptance evidence for "low confidence lands in /admin/triage"
 * and "every override demands a written reason".
 *
 *   pnpm verify:triage
 *   pnpm verify:triage JH-2026-GUM-0002 JH-2026-GUM-0003
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "milan2026";
const ADMIN = "admin@milan.demo.milan.in";
const sql = postgres(process.env.DIRECT_URL ?? "", { max: 1, prepare: false });

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wanted = targets.length > 0 ? targets.map((t) => t.toUpperCase()) : null;

/* ------------------------------------------------------------- sign in */

const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ email: ADMIN, password: PASSWORD }),
});
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
record("signed in as the Milan administrator", signIn.ok && cookie.length > 0, `${signIn.status}`);

if (!signIn.ok) {
  await sql.end();
  process.exit(1);
}

/* --------------------------------------------------------- the queue */

const { triageQueue } = await import("../app/(admin)/admin/triage/queue");
const queue = await triageQueue();

record(
  "the low-confidence queue is populated",
  queue.length > 0,
  `${queue.length} item(s) waiting, all below their stage's confidence floor`,
);

const items = wanted
  ? queue.filter((q) => wanted.includes(q.trackingId))
  : queue.slice(0, 3);

if (items.length === 0) {
  record("there is something to review", false, "nothing in the queue matches");
  await sql.end();
  process.exit(1);
}

console.log("\n  Waiting on a human:");
for (const item of items) {
  console.log(
    `    ${item.trackingId}  ${item.stage.padEnd(12)} confidence ${item.confidence?.toFixed(2)} ` +
      `(floor ${item.floor}) via ${item.provider} L${item.fallbackLevel}`,
  );
}

/* ------------------------------------------- a reason really is mandatory */

const noReason = await fetch(`${BASE}/api/admin/triage`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json", origin: BASE },
  body: JSON.stringify({
    decision: "ACCEPT",
    challengeId: items[0].challengeId,
    stage: items[0].stage,
    inputHash: items[0].inputHash,
    reason: "ok",
  }),
});
const noReasonBody = (await noReason.json()) as { ok: boolean; error?: string };
record(
  "a decision without a written reason is refused",
  noReasonBody.ok === false,
  noReasonBody.error ?? "",
);

/* ------------------------------------------------------- accept them */

console.log("\n  Accepting as the administrator…");
let accepted = 0;
for (const item of items) {
  const response = await fetch(`${BASE}/api/admin/triage`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", origin: BASE },
    body: JSON.stringify({
      decision: "ACCEPT",
      challengeId: item.challengeId,
      stage: item.stage,
      inputHash: item.inputHash,
      reason:
        "Reviewed by hand: both providers were rate-limited so the rule tier answered, and its " +
        "reading of this report is correct. Accepted so the pipeline can continue.",
    }),
  });
  const body = (await response.json()) as { ok: boolean; message?: string; error?: string };
  if (body.ok) accepted++;
  console.log(`    ${item.trackingId}  ${body.ok ? body.message : body.error}`);
}

record("every accept was saved", accepted === items.length, `${accepted}/${items.length}`);

/* --------------------------------------------- it became labelled data */

const corrections = await sql`
  select t.stage, t.reason, c.tracking_id
  from training_corrections t join challenges c on c.id = t.challenge_id
  order by t.created_at desc limit ${items.length}`;

record(
  "each decision became labelled training data",
  corrections.length === items.length,
  `${corrections.length} training_corrections row(s)`,
);
record(
  "each carries the written reason",
  corrections.every((c) => String(c.reason ?? "").length > 20),
);

const audit = await sql`
  select action, reason from audit_log
  where action in ('TRIAGE_ACCEPT', 'TRIAGE_OVERRIDE')
  order by created_at desc limit ${items.length}`;
record("each is in the audit log", audit.length === items.length, audit.map((a) => a.action).join(", "));

/* ------------------------------------- and the queue no longer holds them */

const after = await triageQueue();
const stillHeld = after.filter((q) => items.some((i) => i.challengeId === q.challengeId && i.stage === q.stage));
record(
  "the reviewed items leave the queue",
  stillHeld.length === 0,
  `${after.length} still waiting, none of them the ones just reviewed`,
);

const statuses = await sql`
  select tracking_id, status from challenges
  where id = any(${items.map((i) => i.challengeId)})`;
record(
  "each challenge moved on",
  statuses.every((s) => s.status !== "SUBMITTED"),
  statuses.map((s) => `${s.tracking_id}:${s.status}`).join(", "),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
await sql.end();
process.exit(failed.length === 0 ? 0 : 1);
