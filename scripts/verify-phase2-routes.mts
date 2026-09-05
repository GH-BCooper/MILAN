/**
 * Every Phase 2 surface, loaded against a live server as the role that owns it.
 *
 * Phase 1's `verify-routes.mjs` covers the public pages. This covers the ones
 * added in Phase 2, and it checks them as an ADMIN and as an HEI member,
 * because a page that 200s for nobody in particular is not evidence that the
 * person who needs it can open it.
 *
 *   pnpm verify:phase2
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "milan2026";
const sql = postgres(process.env.DIRECT_URL ?? "", { max: 1, prepare: false });

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function session(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jar: string[] = [];
  for (const raw of response.headers.getSetCookie?.() ?? []) jar.push(raw.split(";")[0]);
  if (!response.ok) throw new Error(`sign-in failed for ${email}: ${response.status}`);
  return jar.join("; ");
}

const admin = await session("admin@milan.demo.milan.in");
const hod = await session("hod.civil@bitsindri.demo.milan.in");
const citizen = await session("sunita@demo.milan.in");

const [challenge] = await sql`
  select tracking_id from challenges where priority_score is not null
  order by priority_score desc limit 1`;
const [project] = await sql`select id from projects limit 1`;

console.log(`\nPhase 2 surfaces against ${BASE}\n${"-".repeat(70)}`);

const ROUTES: Array<[string, string, string]> = [
  ["/admin/ai-runs", admin, "the AI run log — the receipt"],
  ["/admin/ai-runs?stage=S2_CLASSIFY", admin, "run log, filtered by stage"],
  ["/admin/ai-runs?level=2", admin, "run log, filtered to the rule tier"],
  ["/admin/triage", admin, "the low-confidence human queue"],
  ["/admin/routing", admin, "routing and the override surface"],
  ["/hei", hod, "department dashboard"],
  ["/hei/inbox", hod, "the routed inbox"],
  ["/hei/capability", hod, "the capability graph"],
  ["/hei/challenge-bank", hod, "real final-year projects"],
];

if (challenge) {
  ROUTES.push([`/c/${challenge.tracking_id}`, "", "public challenge page with the breakdown"]);
  ROUTES.push([`/hei/challenges/${challenge.tracking_id}/claim`, hod, "the claim page"]);
}
if (project) ROUTES.push([`/hei/projects/${project.id}`, hod, "the project workspace"]);

for (const [path, cookie, label] of ROUTES) {
  const started = performance.now();
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  const ms = performance.now() - started;
  record(`${path} — ${label}`, response.status === 200, `HTTP ${response.status}, ${ms.toFixed(0)}ms`);
}

/* ------------------------------------------------------------ role guards */

console.log(`\nRole guards\n${"-".repeat(70)}`);

for (const [path, cookie, who, label] of [
  ["/admin/ai-runs", citizen, "a citizen", "is refused the AI run log"],
  ["/admin/routing", hod, "an HEI member", "is refused the routing override"],
  ["/hei/inbox", citizen, "a citizen", "is refused the university inbox"],
  ["/admin/triage", hod, "an HEI member", "is refused the triage queue"],
] as const) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", headers: { cookie } });
  // The guard redirects rather than 200s. Either a redirect or a 403 is a pass;
  // a 200 means somebody can read a page that is not theirs.
  const refused = response.status !== 200;
  record(`${who} ${label}`, refused, `HTTP ${response.status} on ${path}`);
}

/* ------------------------------------------------- the content that matters */

console.log(`\nContent\n${"-".repeat(70)}`);

if (challenge) {
  const publicPage = await fetch(`${BASE}/c/${challenge.tracking_id}`);
  const html = await publicPage.text();
  record(
    "the priority breakdown is on the PUBLIC page, with no login",
    html.includes("Priority score") && html.includes("scoring function v"),
  );
  record(
    "every scoring term is named on it",
    ["Severity", "Hazard linkage", "People affected", "Corroborations"].every((t) => html.includes(t)),
  );
  record(
    "the caption states the claim",
    html.includes("Every challenge is scored by the same published function"),
  );
  record("the citizen's original words render beside the working copy", html.includes("As it was reported"));
  record("the pipeline is replayable from the public page", html.includes("Replay pipeline") || html.includes("Run pipeline"));
}

const runs = await fetch(`${BASE}/admin/ai-runs`, { headers: { cookie: admin } });
const runsHtml = await runs.text();
record("the run log shows p50/p95 per stage", runsHtml.includes("p50") && runsHtml.includes("p95"));
record(
  "the run log explains what it is for",
  runsHtml.includes("If the") && runsHtml.includes("animation"),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
await sql.end();
process.exit(failed.length === 0 ? 0 : 1);
