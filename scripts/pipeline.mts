/**
 * The pipeline CLI.
 *
 *   pnpm pipeline:run --all                 every non-terminal challenge
 *   pnpm pipeline:run --all --to S2         stop after S2
 *   pnpm pipeline:run JH-2026-GUM-0001      one challenge by tracking ID
 *   pnpm pipeline:replay JH-2026-GUM-0001 --from S1
 *   pnpm pipeline:run --all --fresh         ignore the AI cache (spends tokens)
 *
 * Prints one row per challenge: tracking ID, domain, hazard, severity,
 * confidence and fallback level, which is the table PHASE_2_BUILD.md Task 2.2
 * asks to see.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};

if (flag("fresh")) process.env.AI_CACHE = "off";

const { db } = await import("../lib/db");
const { challenges, aiRuns } = await import("../lib/db/schema");
const { TERMINAL_STATES } = await import("../lib/db/stateMachine");
const { runPipeline, PIPELINE_STAGES } = await import("../lib/ai/pipeline");
const { inArray, notInArray, eq, desc, asc } = await import("drizzle-orm");

type Stage = (typeof PIPELINE_STAGES)[number];
const asStage = (s: string | null): Stage | undefined =>
  s && (PIPELINE_STAGES as readonly string[]).includes(s) ? (s as Stage) : undefined;

const from = asStage(value("from"));
const to = asStage(value("to"));
const verbose = flag("verbose");

/* ------------------------------------------------------- choose the targets */

const positional = argv.filter((a) => !a.startsWith("--") && a !== from && a !== to);

let targets: Array<{ id: string; trackingId: string }>;

if (flag("all")) {
  targets = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId })
    .from(challenges)
    // A terminal challenge has nothing left to decide. Re-running the pipeline
    // over one would spend tokens to change nothing.
    .where(notInArray(challenges.status, [...TERMINAL_STATES]))
    .orderBy(asc(challenges.trackingId));
} else if (positional.length > 0) {
  targets = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId })
    .from(challenges)
    .where(inArray(challenges.trackingId, positional.map((p) => p.toUpperCase())));
  const found = new Set(targets.map((t) => t.trackingId));
  for (const p of positional) {
    if (!found.has(p.toUpperCase())) console.error(`  ! no challenge with tracking ID ${p}`);
  }
} else {
  console.error("Usage: pnpm pipeline:run --all | pnpm pipeline:run <trackingId> [--from S1] [--to S5]");
  process.exit(1);
}

if (targets.length === 0) {
  console.log("Nothing to run.");
  process.exit(0);
}

console.log(
  `Running the pipeline over ${targets.length} challenge(s)` +
    `${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}` +
    `${flag("fresh") ? " (cache off)" : ""}.\n`,
);

/* ------------------------------------------------------------------- run it */

interface Row {
  tracking: string;
  status: string;
  domain: string;
  hazard: string;
  severity: string;
  s1: string;
  s2: string;
  fb: string;
  ms: string;
}

const rows: Row[] = [];
const startedAll = Date.now();

for (const target of targets) {
  const seen = new Map<string, { confidence: number | null; level: number; note: string | null }>();
  let totalMs = 0;
  let finalStatus = "?";

  await runPipeline(
    target.id,
    (event) => {
      if (verbose) console.log(JSON.stringify(event));
      if (event.type === "stage" && event.status !== "running") {
        seen.set(event.stage, {
          confidence: event.meta?.confidence ?? null,
          level: event.meta?.fallbackLevel ?? -1,
          note: event.decision ?? event.note ?? null,
        });
      }
      if (event.type === "done") {
        totalMs = event.totalMs;
        finalStatus = event.status;
      }
    },
    { from, to },
  );

  const [fresh] = await db
    .select({
      domain: challenges.domain,
      hazard: challenges.hazard,
      severity: challenges.severity,
      status: challenges.status,
    })
    .from(challenges)
    .where(eq(challenges.id, target.id))
    .limit(1);

  const s1 = seen.get("S1");
  const s2 = seen.get("S2");
  rows.push({
    tracking: target.trackingId,
    status: fresh?.status ?? finalStatus,
    domain: fresh?.domain ?? "-",
    hazard: fresh?.hazard ?? "-",
    severity: fresh?.severity ?? "-",
    s1: s1?.confidence?.toFixed(2) ?? "-",
    s2: s2?.confidence?.toFixed(2) ?? "-",
    fb: `${s1?.level ?? "-"}/${s2?.level ?? "-"}`,
    ms: String(totalMs),
  });

  if (!verbose) {
    const last = rows[rows.length - 1];
    process.stdout.write(
      `  ${last.tracking}  ${last.status.padEnd(20)} ${last.domain}/${last.hazard} sev=${last.severity} (${last.ms}ms)\n`,
    );
    if (s1?.note && /Forwarded|Rejected|held for a human|Held for a human/i.test(s1.note)) {
      process.stdout.write(`      S1: ${s1.note}\n`);
    }
    if (s2?.note && /held for a human/i.test(s2.note)) {
      process.stdout.write(`      S2: ${s2.note}\n`);
    }
  }
}

/* ------------------------------------------------------------- the report */

const headers: Array<keyof Row> = ["tracking", "status", "domain", "hazard", "severity", "s1", "s2", "fb", "ms"];
const labels: Record<keyof Row, string> = {
  tracking: "TRACKING ID",
  status: "STATUS",
  domain: "DOMAIN",
  hazard: "HAZARD",
  severity: "SEV",
  s1: "S1 CONF",
  s2: "S2 CONF",
  fb: "FALLBACK",
  ms: "MS",
};
const widths = headers.map((h) => Math.max(labels[h].length, ...rows.map((r) => String(r[h]).length)));

console.log(`\n${"=".repeat(widths.reduce((a, b) => a + b + 2, 0))}`);
console.log(headers.map((h, i) => labels[h].padEnd(widths[i])).join("  "));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) console.log(headers.map((h, i) => String(row[h]).padEnd(widths[i])).join("  "));

/* Fallback-level distribution, straight out of ai_runs rather than out of the
   loop above, so the summary is the database's account and not the script's. */
const levels = await db
  .select({ stage: aiRuns.stage, level: aiRuns.fallbackLevel, provider: aiRuns.provider })
  .from(aiRuns)
  .orderBy(desc(aiRuns.createdAt))
  .limit(2000);

const byStage = new Map<string, Map<string, number>>();
for (const r of levels) {
  const key = `${r.provider}(L${r.level})`;
  const m = byStage.get(r.stage) ?? new Map<string, number>();
  m.set(key, (m.get(key) ?? 0) + 1);
  byStage.set(r.stage, m);
}
console.log("\nai_runs by stage and provider (most recent 2000 rows):");
for (const [stage, m] of [...byStage].sort()) {
  console.log(`  ${stage.padEnd(14)} ${[...m].map(([k, v]) => `${k}=${v}`).join("  ")}`);
}

console.log(`\nWall clock: ${((Date.now() - startedAll) / 1000).toFixed(1)}s for ${rows.length} challenge(s).`);
process.exit(0);
