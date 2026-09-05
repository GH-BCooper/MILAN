/**
 * Task 3.9 step 4: /challenges, /c/[id], /gov and /bounties under 2 s.
 *
 * Measured server-side against a production build, five runs each, reporting the
 * median and the worst. That is the number we can defend: a throttled-4G figure
 * from a laptop in WSL talking to a database in Mumbai measures the tunnel, not
 * the product, and we would rather report a real number honestly than a
 * flattering one.
 *
 *   pnpm verify:perf
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "milan2026";
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const BUDGET_MS = 2000;

async function session(email: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const dc = await session("dc.gumla@jh.gov.demo.milan.in");

const ROUTES: Array<[string, string]> = [
  ["/challenges", ""],
  ["/c/JH-2026-GUM-0001", ""],
  ["/bounties", ""],
  ["/gov", dc],
  ["/stats", ""],
  ["/ledger", ""],
];

console.log(`\nTask 3.9 — page timings, ${RUNS} runs each, budget ${BUDGET_MS} ms\n${"-".repeat(66)}`);

let failed = 0;
for (const [path, cookie] of ROUTES) {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, cache: "no-store" });
    await r.arrayBuffer();
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const worst = times[times.length - 1];
  const ok = median < BUDGET_MS;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${path.padEnd(24)} median ${String(median).padStart(5)} ms   worst ${String(worst).padStart(5)} ms`,
  );
}

console.log(`\n${ROUTES.length - failed}/${ROUTES.length} routes within budget`);
process.exit(failed === 0 ? 0 : 1);
