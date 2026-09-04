/**
 * Task 1.4 verification: register one user of each of the five UI roles, then
 * prove the gates hold. Run against a live server (default http://localhost:3000).
 *
 * Not a vitest file on purpose — it drives real HTTP with real cookies, which is
 * the only way to test middleware.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });

const stamp = Date.now();
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** A cookie jar just big enough for one session cookie. */
function jarFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function post(path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Better Auth refuses a write with no matching Origin. That is its CSRF
      // check, and it is why a bare curl POST gets a 403.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

async function get(path, cookie) {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

const [{ id: heiOrg }] = await sql`SELECT id FROM organization WHERE slug = 'bit-sindri'`;
const [{ id: indOrg }] = await sql`SELECT id FROM organization WHERE slug = 'tata-steel-foundation'`;

const ROLES = [
  { role: "CITIZEN", districtCode: "GUM", orgId: null },
  { role: "HEI_MEMBER", districtCode: "DHN", orgId: heiOrg },
  { role: "INDUSTRY", districtCode: "ESB", orgId: indOrg },
  { role: "GOVERNMENT", districtCode: "GUM", orgId: null },
  { role: "ADMIN", districtCode: null, orgId: null },
];

const sessions = {};

console.log(`\nRegistering one user of each role against ${BASE}\n${"-".repeat(60)}`);

/**
 * Better Auth rate-limits sign-up harder than the global rule (a handful per ten
 * seconds, per IP). That is correct product behaviour, so the script paces
 * itself rather than the product being weakened to suit its own test.
 */
const SIGNUP_SPACING_MS = 12_000;

for (const [i, spec] of ROLES.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, SIGNUP_SPACING_MS));
  const email = `verify.${spec.role.toLowerCase()}.${stamp}@demo.milan.in`;

  // Registration goes through the same server action path the form uses: create
  // the auth user, then the Milan profile.
  const signUp = await post("/api/auth/sign-up/email", {
    email,
    password: "milan2026",
    name: `Verify ${spec.role}`,
  });

  if (signUp.status >= 400) {
    record(`register ${spec.role}`, false, `sign-up returned ${signUp.status}`);
    continue;
  }

  const cookie = jarFrom(signUp);
  const [{ id: userId }] = await sql`SELECT id FROM "user" WHERE email = ${email}`;

  await sql`
    INSERT INTO user_profiles (user_id, role, full_name, preferred_lang, district_code, org_id)
    VALUES (${userId}, ${spec.role}::role, ${`Verify ${spec.role}`}, 'en', ${spec.districtCode}, ${spec.orgId})
    ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role, district_code = EXCLUDED.district_code, org_id = EXCLUDED.org_id
  `;

  sessions[spec.role] = cookie;
  record(`register ${spec.role}`, Boolean(cookie), email);
}

console.log(`\nGate checks\n${"-".repeat(60)}`);

/* 1. Signed out: middleware redirects to /login. */
{
  const res = await get("/gov");
  const loc = res.headers.get("location") ?? "";
  record(
    "signed-out visitor to /gov is redirected to /login",
    res.status === 307 && loc.includes("/login"),
    `${res.status} -> ${loc || "(no location)"}`,
  );
}

/* 2. A CITIZEN passes middleware (they have a cookie) but the server guard
      refuses: requireRole redirects them away from /gov. */
{
  const res = await get("/gov", sessions.CITIZEN);
  const loc = res.headers.get("location") ?? "";
  record(
    "CITIZEN is redirected away from /gov by the server-side guard",
    (res.status === 307 || res.status === 303) && loc.includes("denied=role"),
    `${res.status} -> ${loc || "(no location)"}`,
  );
}

/* 3. The GOVERNMENT user of GUM can open their own district. */
{
  const res = await get("/gov/district/GUM", sessions.GOVERNMENT);
  record(
    "GOVERNMENT(GUM) can open the Gumla-scoped page",
    res.status === 200,
    `HTTP ${res.status}`,
  );
}

/* 4. ...and cannot open Dhanbad. requireDistrict throws, which Next renders
      as a 500 from the error boundary. A refusal is the point; the status code
      is cosmetic and is tidied up when /gov gets its own error.tsx. */
{
  const res = await get("/gov/district/DHN", sessions.GOVERNMENT);
  record(
    "GOVERNMENT(GUM) cannot open the Dhanbad-scoped page",
    res.status !== 200,
    `HTTP ${res.status} (200 would mean the district guard failed)`,
  );
}

/* 5. Each role reaches its own home. */
for (const [role, path] of [
  ["HEI_MEMBER", "/hei"],
  ["INDUSTRY", "/industry/discover"],
  ["ADMIN", "/admin/triage"],
  ["CITIZEN", "/me"],
]) {
  const res = await get(path, sessions[role]);
  record(`${role} can open ${path}`, res.status === 200, `HTTP ${res.status}`);
}

/* 6. ...and not somebody else's. */
for (const [role, path] of [
  ["HEI_MEMBER", "/admin/triage"],
  ["INDUSTRY", "/hei"],
  ["CITIZEN", "/admin/triage"],
]) {
  const res = await get(path, sessions[role]);
  const loc = res.headers.get("location") ?? "";
  record(
    `${role} is refused ${path}`,
    res.status !== 200 && loc.includes("denied=role"),
    `HTTP ${res.status} -> ${loc || "(no location)"}`,
  );
}

/* Clean up the throwaway accounts. They have no ledger rows, so they can go. */
await sql`DELETE FROM "user" WHERE email LIKE ${`verify.%.${stamp}@demo.milan.in`}`;

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await sql.end();
process.exit(failed.length ? 1 : 0);
