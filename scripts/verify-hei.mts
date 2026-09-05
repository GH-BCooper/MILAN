/**
 * Task 2.9 verification: the whole HEI beat, driven over HTTP.
 *
 * Sign in as the seeded BIT Sindri HOD, follow the notification link for the
 * Sunita embankment challenge, claim it, form a team, and prove the credit
 * chain on the PUBLIC page reads citizen → corroborators → team → mentor.
 *
 *   pnpm verify:hei
 *   pnpm verify:hei JH-2026-GUM-0001
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "milan2026";
const HOD = "hod.civil@bitsindri.demo.milan.in";
const sql = postgres(process.env.DIRECT_URL ?? "", { max: 1, prepare: false });

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const target = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "JH-2026-GUM-0001").toUpperCase();

/* ------------------------------------------------------------- sign in */

const cookieJar = new Map<string, string>();
function cookieHeader() {
  return [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; ");
}
function absorb(response: Response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookieJar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  // Better Auth refuses a write with no matching Origin. That is its CSRF
  // protection working, not a bug to route around.
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ email: HOD, password: PASSWORD }),
});
absorb(signIn);
record("signed in as the BIT Sindri HOD", signIn.ok && cookieJar.size > 0, `${signIn.status}, ${cookieJar.size} cookie(s)`);

if (!signIn.ok) {
  console.error(await signIn.text());
  await sql.end();
  process.exit(1);
}

async function authed(path: string) {
  return fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader() } });
}

/* ------------------------------------ make sure there is an offer to take */

const [challenge] = await sql`
  select id, tracking_id, status, severity, reporter_id, reporter_name
  from challenges where tracking_id = ${target}`;

if (!challenge) {
  record(`${target} exists`, false);
  await sql.end();
  process.exit(1);
}

const [org] = await sql`select id, name from organization where name = 'BIT Sindri'`;
const offers = await sql`
  select r.id, r.rank, r.state, r.notified_at, o.name as org
  from routes r join organization o on o.id = r.org_id
  where r.challenge_id = ${challenge.id} order by r.rank`;

record(
  "the challenge has a routed shortlist",
  offers.length > 0,
  offers.map((o) => `#${o.rank} ${o.org} ${o.state}`).join(", "),
);

// A previous run may already have released the gate, so the assertion is about
// what S5 DID when it routed — recorded in the ledger — not about the state a
// re-run happens to find. Re-running a verification must not change its verdict.
const gateEntries = await sql`
  select payload from ledger_entries
  where challenge_id = ${challenge.id} and kind = 'STATE_CHANGE'
    and payload->>'to' = 'VERIFIED'`;
const heldAtGate =
  offers.every((o) => o.notified_at === null) ||
  gateEntries.some((e) => String((e.payload as Record<string, unknown>)?.reason ?? "").includes("human gate"));

record(
  "the human gate held it (severity >= 0.7)",
  Number(challenge.severity) >= 0.7 ? heldAtGate : true,
  `severity ${challenge.severity}, ${heldAtGate ? "held for a district officer" : "released automatically"}`,
);

// Held is a property of the OFFERS, not of one status: a challenge waits at the
// gate when a shortlist exists and nobody has been told about it.
const gated = offers.length > 0 && offers.every((o) => o.notified_at === null);

/**
 * Release the gate the way a District Collector would.
 *
 * /gov/gate is Phase 3's screen; the release path it calls is S5's
 * `releaseNotifications`, which is what this invokes. Doing it here rather than
 * writing `notified_at` by hand keeps the verification on the real code path.
 */
if (gated) {
  const { releaseGate } = await import("../lib/ai/stages/s5");
  const released = await releaseGate({
    challengeId: challenge.id as string,
    trackingId: challenge.tracking_id as string,
    reason: "Confirmed by the Deputy Commissioner, Gumla (verification harness).",
  });
  record(
    "a district officer released the gate",
    released.notified > 0 && released.status === "ROUTED",
    `${released.notified} notification(s) sent, challenge now ${released.status}`,
  );
}

/* -------------------------------------------- the notification link works */

const notifications = await sql`
  select n.title, n.action_url from notifications n
  join user_profiles p on p.user_id = n.user_id
  join "user" u on u.id = p.user_id
  where u.email = ${HOD} and n.action_url like ${"%" + target + "%"}
  order by n.created_at desc limit 1`;

record(
  "the HOD has a notification linking straight to the claim page",
  notifications.length > 0,
  notifications[0]?.action_url ?? "none",
);
record(
  "push, never browse: it links to the challenge, not to a list",
  Boolean(notifications[0]?.action_url?.includes(target)),
  notifications[0]?.action_url ?? "",
);

const claimPage = await authed(`/hei/challenges/${target}/claim`);
const claimHtml = await claimPage.text();
record("the claim page loads for the HOD", claimPage.ok, `${claimPage.status}`);
record(
  "it carries the routing reason and the priority breakdown",
  claimHtml.includes("Why you") && claimHtml.includes("Priority score"),
);
record("it shows the citizen's own words", claimHtml.includes("As it was reported"));

/* --------------------------------------------------------------- claim it */

const [capability] = await sql`
  select c.id, c.department, c.declared_capacity
  from routes r join capabilities c on c.id = r.capability_id
  where r.challenge_id = ${challenge.id} and r.org_id = ${org.id} limit 1`;

console.log("\n  Claiming as the HOD, over HTTP, with the session cookie…");
const claimResponse = await fetch(`${BASE}/api/hei/claim`, {
  method: "POST",
  headers: { cookie: cookieHeader(), "content-type": "application/json", origin: BASE },
  body: JSON.stringify({
    trackingId: target,
    capabilityId: capability?.id,
    title: "Failure mechanism and low-cost reinforcement of the South Koel earthen embankment at Basia",
    ipTrack: "OPEN",
    members: [
      { name: "Priya Kumari", email: "priya.kumari@bitsindri.ac.in", declaredRole: "Field survey" },
      { name: "Rahul Mahto", email: "rahul.mahto@bitsindri.ac.in", declaredRole: "Modelling and analysis" },
      { name: "Aarti Singh", email: "aarti.singh@bitsindri.ac.in", declaredRole: "Design" },
    ],
    mentorEmail: HOD,
    mentorName: "Head of Civil Engineering, BIT Sindri",
    citizenRole: "Domain Informant",
    creditCitizen: true,
    confirmCapacity: true,
  }),
});
const claimResult = (await claimResponse.json()) as
  | { ok: true; projectId: string; message: string }
  | { ok: false; error: string };

record(
  "the claim succeeded",
  claimResult.ok,
  claimResult.ok ? claimResult.message : claimResult.error,
);

if (!claimResult.ok) {
  await sql.end();
  process.exit(1);
}

/* ------------------------------------------------- everything it wrote */

const [after] = await sql`select status from challenges where id = ${challenge.id}`;
record("the challenge is now CLAIMED", after.status === "CLAIMED", after.status);

const afterRoutes = await sql`
  select r.state, o.name as org from routes r join organization o on o.id = r.org_id
  where r.challenge_id = ${challenge.id} order by r.rank`;
record(
  "the winning offer is CLAIMED and the others EXPIRED",
  afterRoutes.some((r) => r.state === "CLAIMED") && afterRoutes.every((r) => r.state !== "OFFERED"),
  afterRoutes.map((r) => `${r.org}:${r.state}`).join(", "),
);

const [capAfter] = await sql`select declared_capacity from capabilities where id = ${capability.id}`;
record(
  "declared capacity was decremented",
  Number(capAfter.declared_capacity) === Number(capability.declared_capacity) - 1,
  `${capability.declared_capacity} → ${capAfter.declared_capacity}`,
);

const [project] = await sql`
  select id, title, ip_track, last_activity_at from projects where challenge_id = ${challenge.id}`;
record("a project exists with lastActivityAt set", Boolean(project?.last_activity_at), project?.title ?? "");

const ledger = await sql`
  select kind from ledger_entries where challenge_id = ${challenge.id} order by seq`;
record(
  "the ledger records the proposal and the state change",
  ledger.some((l) => l.kind === "PROPOSAL") && ledger.some((l) => l.kind === "STATE_CHANGE"),
  ledger.map((l) => l.kind).join(" → "),
);

/* ------------------------------------------- the credit chain, in public */

const credits = await sql`
  select relation, declared_role, created_at from credit_edges
  where challenge_id = ${challenge.id} order by created_at, relation`;

console.log("\n  The credit chain on the public page:");
for (const c of credits) console.log(`    ${String(c.relation).padEnd(14)} ${c.declared_role}`);

const relations = credits.map((c) => c.relation);
record("the citizen is the ORIGINATOR", relations.includes("ORIGINATOR"));
record("corroborators are credited", relations.includes("CORROBORATOR"));
record("the team is credited", relations.filter((r) => r === "TEAM_MEMBER").length >= 3);
record("the mentor is credited", relations.includes("MENTOR"));
record(
  "the citizen is on the team as Domain Informant",
  credits.some((c) => String(c.declared_role).includes("Domain Informant")),
);
record(
  "no email address is published on the credit chain",
  credits.every((c) => !String(c.declared_role).includes("@")),
  "credit_edges.declared_role renders publicly; it carries names, never emails",
);

const publicPage = await fetch(`${BASE}/c/${target}`);
const publicHtml = await publicPage.text();
record("the public page renders the credit chain", publicHtml.includes("Credit chain"));
record(
  "the public page shows every relation",
  ["ORIGINATOR", "CORROBORATOR", "TEAM MEMBER", "MENTOR"].every((r) => publicHtml.includes(r)),
);

/* -------------------------------------------------------- the workspaces */

for (const [label, path] of [
  ["dashboard", "/hei"],
  ["inbox", "/hei/inbox"],
  ["capability", "/hei/capability"],
  ["challenge bank", "/hei/challenge-bank"],
  ["project", `/hei/projects/${project.id}`],
] as const) {
  const response = await authed(path);
  record(`/hei ${label} loads`, response.ok, `${response.status} ${path}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
console.log(`Public page: ${BASE}/c/${target}`);
console.log(`Project:     ${BASE}/hei/projects/${project.id}`);
await sql.end();
process.exit(failed.length === 0 ? 0 : 1);
