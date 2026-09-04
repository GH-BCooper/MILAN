/**
 * Task 1.7 verification: every public route returns 200 against a live server,
 * and the pages actually contain what they claim to.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const [sample] = await sql`
  SELECT tracking_id, body_original FROM challenges WHERE body_lang = 'hi' ORDER BY created_at LIMIT 1
`;

console.log(`\nRoute status against ${BASE}\n${"-".repeat(70)}`);

const ROUTES = [
  ["/", "landing"],
  ["/challenges", "map and list"],
  ["/challenges?district=GUM", "filtered list"],
  ["/track", "tracking lookup"],
  ["/stats", "public statistics"],
  ["/ledger", "ledger (declared stub)"],
  ["/bounties", "bounties (declared stub)"],
  ["/submit", "intake wizard"],
  [`/c/${sample.tracking_id}`, "canonical challenge page"],
  ["/login", "sign in"],
  ["/register", "register"],
];

const timings = [];
for (const [path, label] of ROUTES) {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const ms = performance.now() - started;
  timings.push([path, ms]);
  record(`${path} — ${label}`, res.status === 200, `HTTP ${res.status}, ${ms.toFixed(0)}ms`);
}

/* /me needs a session, so signed out it must redirect rather than 200. */
{
  const res = await fetch(`${BASE}/me`, { redirect: "manual" });
  record("/me redirects when signed out", res.status === 307, `HTTP ${res.status}`);
}

console.log(`\nPage content\n${"-".repeat(70)}`);

/* Invariant 6: the citizen's original text renders on the challenge page. */
{
  const html = await (await fetch(`${BASE}/c/${sample.tracking_id}`)).text();
  const escaped = sample.body_original.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  record("the original Hindi text is rendered on the page", html.includes(escaped.slice(0, 40)));
  record(
    "the English working copy sits beside it, not behind a toggle",
    html.includes("English working copy") && !/show original/i.test(html),
  );
  record(
    "the priority panel says it is scored in the AI pipeline",
    html.includes("Scored in the AI pipeline"),
  );
  record("the credit chain shows the originator", html.includes("ORIGINATOR"));
}

/* Invariant 7: the impact counter reads CITIZEN_VERIFIED and nothing else. */
{
  const html = await (await fetch(`${BASE}/stats`)).text();
  const [{ n: verified }] =
    await sql`SELECT count(*)::int AS n FROM challenges WHERE status = 'CITIZEN_VERIFIED'`;
  const [{ n: implemented }] =
    await sql`SELECT count(*)::int AS n FROM challenges WHERE status = 'IMPLEMENTED'`;

  record(
    "impact caption is present",
    html.includes("Impact counts only citizen-confirmed outcomes"),
  );
  record(
    `impact counter shows the CITIZEN_VERIFIED count (${verified})`,
    html.includes(`>${verified}<`) || html.includes(`>${verified.toLocaleString("en-IN")}<`),
    `verified=${verified}, implemented=${implemented}`,
  );
}

/* The tracking lookup actually resolves. */
{
  const form = new URLSearchParams({ trackingId: sample.tracking_id });
  const res = await fetch(`${BASE}/track`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: form,
    redirect: "manual",
  });
  // A server action responds 303/200 with a redirect instruction in its payload.
  record("submitting a known tracking ID does not error", res.status < 400, `HTTP ${res.status}`);
}

const slowest = timings.sort((a, b) => b[1] - a[1])[0];
console.log(`\nSlowest route: ${slowest[0]} at ${slowest[1].toFixed(0)}ms`);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
await sql.end();
process.exit(failed.length ? 1 : 0);
