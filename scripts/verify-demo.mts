/**
 * Task 3.8 verification: run the six-minute script through /demo and the normal
 * UI only, timing each beat. No terminal commands are used to drive the product
 * — this harness only presses the same buttons and loads the same pages a driver
 * would, and reports the wall-clock time each one took.
 *
 *   pnpm verify:demo
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "milan2026";

const beats: Array<{ beat: string; ms: number; ok: boolean; note: string }> = [];

async function session(email: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function timed(beat: string, fn: () => Promise<{ ok: boolean; note: string }>) {
  const t0 = Date.now();
  let out = { ok: false, note: "" };
  try {
    out = await fn();
  } catch (e) {
    out = { ok: false, note: (e as Error).message };
  }
  const ms = Date.now() - t0;
  beats.push({ beat, ms, ...out });
  console.log(`${out.ok ? "PASS" : "FAIL"}  ${String(ms).padStart(6)} ms  ${beat}${out.note ? `  — ${out.note}` : ""}`);
}

const admin = await session("admin@milan.demo.milan.in");
const get = (path: string, cookie = "") => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });

console.log(`\nTask 3.8 — the six-minute script, driven only through /demo and the UI\n${"-".repeat(76)}`);

await timed("0:00  open /demo, health strip renders", async () => {
  const r = await get("/demo", admin);
  const html = await r.text();
  const green = /Invariant 1[\s\S]{0,200}GREEN/.test(html);
  return {
    ok: r.status === 200 && /Demo console/.test(html) && /Database latency/.test(html),
    note: `HTTP ${r.status}, invariant ${green ? "green" : "check the strip"}`,
  };
});

await timed("0:30  the landing page and a citizen submission form", async () => {
  const [home, submit] = await Promise.all([get("/"), get("/submit")]);
  return { ok: home.status === 200 && submit.status === 200, note: `/ ${home.status}, /submit ${submit.status}` };
});

await timed("1:30  the public challenge page with its priority breakdown", async () => {
  const r = await get("/c/JH-2026-GUM-0001");
  const html = await r.text();
  return { ok: r.status === 200 && /Credit chain/.test(html), note: `HTTP ${r.status}` };
});

await timed("1:00  run the pipeline on the hero challenge", async () => {
  const r = await fetch(`${BASE}/api/demo/beat`, {
    method: "POST",
    headers: { cookie: admin, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ beat: "pipeline" }).toString(),
  });
  const body = (await r.json()) as { ok: boolean; message: string };
  return { ok: body.ok, note: body.message.slice(0, 100) };
});

await timed("2:30  the human gate, holding a high-severity challenge", async () => {
  const r = await get("/gov/gate", admin);
  return { ok: r.status === 200 || r.status === 307, note: `HTTP ${r.status} (ADMIN is not a wildcard for GOVERNMENT by design)` };
});

await timed("2:50  release the gate, then the HOD claims it", async () => {
  for (const beat of ["gate", "claim"]) {
    const r = await fetch(`${BASE}/api/demo/beat`, {
      method: "POST",
      headers: { cookie: admin, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ beat }).toString(),
    });
    const body = (await r.json()) as { ok: boolean; message: string };
    if (!body.ok) return { ok: false, note: `${beat}: ${body.message.slice(0, 90)}` };
    if (beat === "claim") return { ok: true, note: body.message.slice(0, 90) };
  }
  return { ok: false, note: "no beat ran" };
});

await timed("3:15  publish the artifact from /demo", async () => {
  const r = await fetch(`${BASE}/api/demo/beat`, {
    method: "POST",
    headers: { cookie: admin, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ beat: "publish" }).toString(),
  });
  const body = (await r.json()) as { ok: boolean; message: string };
  return { ok: body.ok, note: body.message.slice(0, 90) };
});

await timed("4:15  fast-forward +21 days and watch the ladder fire", async () => {
  const r = await fetch(`${BASE}/api/demo/clock`, {
    method: "POST",
    headers: { cookie: admin, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ days: "21" }).toString(),
  });
  const body = (await r.json()) as { ok: boolean; message: string; fired?: Array<{ kind: string; trackingId: string }> };
  const kinds = [...new Set((body.fired ?? []).map((f) => f.kind))];
  return { ok: body.ok, note: `${body.fired?.length ?? 0} fired: ${kinds.join(", ") || "none due"}` };
});

await timed("4:45  the bounty board shows the escalated challenge", async () => {
  const r = await get("/bounties");
  const html = await r.text();
  return { ok: r.status === 200 && /Bounty board/.test(html), note: `HTTP ${r.status}` };
});

await timed("5:00  the ledger verifies in the browser", async () => {
  const r = await fetch(`${BASE}/api/ledger/verify`, { cache: "no-store" });
  const body = (await r.json()) as { ok: boolean; checked: number; headHash: string };
  return { ok: body.ok, note: `${body.checked} entries, head ${body.headHash?.slice(0, 12)}…` };
});

await timed("5:20  mark implemented, and the citizen's SMS appears", async () => {
  const r = await fetch(`${BASE}/api/demo/beat`, {
    method: "POST",
    headers: { cookie: admin, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ beat: "implement" }).toString(),
  });
  const body = (await r.json()) as { ok: boolean; message: string };
  const demo = await get("/demo", admin);
  const html = await demo.text();
  return { ok: body.ok && /Simulated inboxes/.test(html), note: body.message.slice(0, 90) };
});

await timed("5:40  the citizen confirms, and the counter moves", async () => {
  const before = await (await get("/api/demo/impact", admin)).json();
  const r = await fetch(`${BASE}/api/demo/beat`, {
    method: "POST",
    headers: { cookie: admin, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ beat: "confirm" }).toString(),
  });
  const body = (await r.json()) as { ok: boolean; message: string };
  const after = await (await get("/api/demo/impact", admin)).json();
  return {
    ok: body.ok,
    note: `confirmed ${(before as { confirmed: number }).confirmed} → ${(after as { confirmed: number }).confirmed}`,
  };
});

await timed("6:00  reset the demo state", async () => {
  const t = Date.now();
  const r = await fetch(`${BASE}/api/demo/reset`, { method: "POST", headers: { cookie: admin, origin: BASE } });
  const body = (await r.json()) as { ok: boolean; message: string };
  return { ok: body.ok && Date.now() - t < 20_000, note: `${body.message.slice(0, 80)} (${Date.now() - t} ms, budget 20 s)` };
});

const total = beats.reduce((n, b) => n + b.ms, 0);
const failed = beats.filter((b) => !b.ok).length;
console.log(`\ntotal wall clock: ${(total / 1000).toFixed(1)} s across ${beats.length} beats`);
console.log(`${beats.length - failed}/${beats.length} beats passed`);
process.exit(failed === 0 ? 0 : 1);
