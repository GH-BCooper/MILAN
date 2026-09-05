/**
 * Every Phase 3 verification, in order, against a running server.
 *
 *   pnpm build && pnpm start &
 *   pnpm verify:phase3
 */
import { spawn } from "node:child_process";

const SCRIPTS: Array<[string, string]> = [
  ["verify-clock.mts", "3.1  the demo clock, SQL and app agree"],
  ["verify-sla.mts", "3.2  the SLA ladders on a fast-forwarded clock"],
  ["verify-gov.mts", "3.3  the DC dashboard, the gate and district scoping"],
  ["verify-provenance.mts", "3.4/3.5  the ledger, licensing and the access log"],
  ["verify-impact.mts", "3.6  the citizen confirmation loop"],
  ["verify-industry.mts", "3.7  industry and the CSR export"],
  ["verify-demo.mts", "3.8  the six-minute script through /demo"],
  ["verify-perf.mts", "3.9  page timings"],
  ["verify-seed-guard.mts", "3.9  no placeholder data"],
];

function run(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("node_modules/.bin/tsx", ["--conditions=react-server", `scripts/${script}`], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const results: Array<[string, number]> = [];
for (const [script, label] of SCRIPTS) {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  results.push([label, await run(script)]);
}

console.log(`\n${"=".repeat(78)}\nPhase 3 verification summary\n${"=".repeat(78)}`);
for (const [label, code] of results) console.log(`${code === 0 ? "PASS" : "FAIL"}  ${label}`);
const failed = results.filter(([, c]) => c !== 0).length;
console.log(`\n${results.length - failed}/${results.length} verifications passed`);
process.exit(failed === 0 ? 0 : 1);
