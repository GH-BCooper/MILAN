/**
 * `pnpm ai:smoke` — run one prompt through every provider level and print the table.
 *
 * Then unplug the network and run it again. Levels 0 and 1 must fail cleanly
 * inside their timeout and level 2 must still return, because CLAUDE.md
 * invariant 8 says nothing on the demo path may depend on a live third-party
 * API succeeding.
 *
 *   pnpm ai:smoke              # all three levels
 *   pnpm ai:smoke --offline    # simulate a dead network without unplugging
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const OFFLINE = process.argv.includes("--offline");
if (OFFLINE) {
  // Same observable behaviour as a dead network: every outbound request fails
  // fast rather than hanging. Not a substitute for the real unplugged run --
  // we do both and report both.
  globalThis.fetch = (async () => {
    throw new Error("simulated offline: fetch is disabled");
  }) as typeof fetch;
}

const { geminiProvider } = await import("../lib/ai/providers/gemini");
const { groqProvider } = await import("../lib/ai/providers/groq");
const { rulesProvider } = await import("../lib/ai/providers/rules");
const { S1Schema, S2Schema } = await import("../lib/ai/schemas");
const s1 = await import("../lib/ai/prompts/s1");
const s2 = await import("../lib/ai/prompts/s2");

const S1_CASE = {
  title: "Crack spreading along the South Koel embankment near Basia",
  bodyOriginal:
    "I am from Basia. The mud embankment on the South Koel river beside our tola has a crack that " +
    "started after last monsoon near the culvert. It was one hand wide in October, now I can put " +
    "my whole arm in it and it is getting longer towards the village side. When the river rises " +
    "in July the water will come straight through it into forty houses and the school. Nobody " +
    "from the block has come to see it even after we told the mukhiya twice.",
  bodyEn: null,
  districtCode: "GUM",
};

const S2_CASE = {
  ...S1_CASE,
  districtName: "Gumla",
  blockName: "Basia",
  peopleAffected: 550,
  recurrence: "yearly",
  priors: [
    { title: "Chandil dam water enters the village every monsoon", domain: "WATER", hazard: "FLOOD", similarity: 0.81 },
    { title: "Harmu river overflows into the colony", domain: "URBAN_INFRA", hazard: "FLOOD", similarity: 0.74 },
  ],
};

const providers = [geminiProvider, groqProvider, rulesProvider];

interface Row {
  level: number;
  provider: string;
  stage: string;
  status: string;
  model: string;
  latency: string;
  confidence: string;
  result: string;
}

const rows: Row[] = [];

/**
 * One entry per stage under test, each closing over its own schema and prompt.
 * Written as closures rather than a loop over a union because the two stages
 * have genuinely different result types and erasing that with a cast would hide
 * exactly the kind of drift this script exists to catch.
 */
const CASES: Array<{
  stage: "S1_TRIAGE" | "S2_CLASSIFY";
  run: (provider: (typeof providers)[number]) => Promise<{ model: string; latencyMs: number; confidence: number; summary: string }>;
}> = [
  {
    stage: "S1_TRIAGE",
    async run(provider) {
      const out = await provider.complete({
        stage: "S1_TRIAGE",
        system: s1.SYSTEM,
        user: s1.render(S1_CASE),
        schema: S1Schema,
        timeoutMs: TIMEOUT_MS,
        input: S1_CASE,
      });
      return {
        model: out.model,
        latencyMs: out.latencyMs,
        confidence: out.value.confidence,
        summary: `unsafe=${out.value.is_unsafe} grievance=${out.value.is_grievance}`,
      };
    },
  },
  {
    stage: "S2_CLASSIFY",
    async run(provider) {
      const out = await provider.complete({
        stage: "S2_CLASSIFY",
        system: s2.SYSTEM,
        user: s2.render(S2_CASE),
        schema: S2Schema,
        timeoutMs: TIMEOUT_MS,
        input: S2_CASE,
      });
      return {
        model: out.model,
        latencyMs: out.latencyMs,
        confidence: out.value.confidence,
        summary: `${out.value.domain}/${out.value.hazard} sev=${out.value.severity} hs=${out.value.hazard_strength}`,
      };
    },
  },
];

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 3000);

for (const testCase of CASES) {
  for (const provider of providers) {
    if (!provider.available()) {
      rows.push({
        level: provider.level,
        provider: provider.name,
        stage: testCase.stage,
        status: "SKIPPED",
        model: "-",
        latency: "-",
        confidence: "-",
        result: "no API key configured",
      });
      continue;
    }

    try {
      const out = await testCase.run(provider);
      rows.push({
        level: provider.level,
        provider: provider.name,
        stage: testCase.stage,
        status: "OK",
        model: out.model,
        latency: `${out.latencyMs}ms`,
        confidence: out.confidence.toFixed(2),
        result: out.summary,
      });
    } catch (e) {
      rows.push({
        level: provider.level,
        provider: provider.name,
        stage: testCase.stage,
        status: "FAILED",
        model: "-",
        latency: "-",
        confidence: "-",
        result: (e instanceof Error ? e.message : String(e)).slice(0, 90),
      });
    }
  }
}

const headers: Array<keyof Row> = ["level", "provider", "stage", "status", "model", "latency", "confidence", "result"];
const widths = headers.map((h) =>
  Math.max(h.length, ...rows.map((r) => String(r[h]).length)),
);

console.log(`\n=== ai:smoke ${OFFLINE ? "(simulated offline)" : "(network available)"} ===\n`);
console.log(headers.map((h, i) => h.toUpperCase().padEnd(widths[i])).join("  "));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) {
  console.log(headers.map((h, i) => String(row[h]).padEnd(widths[i])).join("  "));
}

const level2 = rows.filter((r) => r.level === 2);
const level2Ok = level2.length > 0 && level2.every((r) => r.status === "OK");
console.log(
  `\nLevel 2 (deterministic rules) returned for every stage: ${level2Ok ? "YES" : "NO"}` +
    `  <- CLAUDE.md invariant 8\n`,
);
process.exit(level2Ok ? 0 : 1);
