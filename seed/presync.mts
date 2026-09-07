/**
 * Task 4.3 — pre-sync the seed through the real pipeline.
 *
 *   pnpm seed:ai                     every non-terminal challenge, hero included
 *   pnpm seed --reset --ai           the seeder calls this same module at the end
 *   pnpm seed:ai -- --hero JH-…      point the hero release somewhere else
 *
 * What "pre-synced" means: every seeded challenge has been through the REAL
 * pipeline — `runPipeline`, not a lookalike — so its embeddings, S1/S2
 * proposals, S3 dedupe verdicts, S4 priority factors and S5 shortlist all
 * exist as ordinary rows and `ai_runs` receipts, exactly as if a citizen had
 * just submitted it. Nothing here writes a classification column by hand, and
 * nothing invents a row the pipeline would not have emitted.
 *
 * The hero challenge gets one more step, because the demo walks through it:
 * its low-confidence holds are accepted through the same mechanism the human
 * queue uses (`training_corrections` with corrected = proposed, a mandatory
 * written reason, and an audit row), then the pipeline is replayed so the
 * state machine, the ledger, the SLA deadlines and the stored routes all move
 * for real. Severity at or above the human gate deliberately stops at the DC
 * gate — that is the designed story, not a failure of this script.
 *
 * Idempotent: the pipeline is replay-safe by construction, re-accepted queue
 * items are no longer in the queue, and re-runs are cheap because the AI
 * cache hits on unchanged inputs. On a live-key chain this spends tokens only
 * for inputs that changed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const argv = process.argv.slice(2);
const heroFlag = argv.indexOf("--hero");
const HERO_TRACKING = (
  heroFlag !== -1 && argv[heroFlag + 1] ? argv[heroFlag + 1] : "JH-2026-GUM-0001"
).toUpperCase();

const startedAt = new Date();

const { db } = await import("../lib/db");
import type { ChallengeStatus } from "../lib/db/schema";
import type { PipelineEvent } from "../lib/ai/pipeline";

const {
  aiRuns,
  auditLog,
  challenges,
  organization,
  routes,
  trainingCorrections,
  user,
  userProfiles,
} = await import("../lib/db/schema");
const { TERMINAL_STATES, canTransition, transition } = await import("../lib/db/stateMachine");
const { runPipeline } = await import("../lib/ai/pipeline");
const { triageQueue } = await import("../app/(admin)/admin/triage/queue");
const { clockNow } = await import("../lib/clock");
const { asc, desc, eq, gte, notInArray, sql } = await import("drizzle-orm");

const STAGE_ORDER = ["P0", "S1", "S2", "S3", "S4", "S5"] as const;
const STAGE_MARK: Record<string, string> = {
  done: "✓",
  degraded: "△",
  skipped: "·",
  running: "…",
};

async function runOne(id: string): Promise<{ stages: Map<string, string>; totalMs: number; finalStatus: string }> {
  const stages = new Map<string, string>();
  let totalMs = 0;
  let finalStatus = "?";
  await runPipeline(id, async (event: PipelineEvent) => {
    if (event.type === "stage") stages.set(event.stage, String(event.status));
    if (event.type === "done") {
      totalMs = event.totalMs;
      finalStatus = String(event.status);
    }
  });
  return { stages, totalMs, finalStatus };
}

function printRunLine(trackingId: string, r: { stages: Map<string, string>; totalMs: number; finalStatus: string }): void {
  const marks = STAGE_ORDER.map((s) => `${s}${STAGE_MARK[r.stages.get(s) ?? "skipped"] ?? "?"}`).join(" ");
  console.log(`${trackingId}  ${marks}  ${(r.totalMs / 1000).toFixed(1)}s  → ${r.finalStatus}`);
}

/** The human release, replicated 1:1 from /admin/triage's accept action, so
 *  the hero leaves the queue by the same path a person would have used. */
async function releaseHeldItems(trackingId: string): Promise<number> {
  const [admin] = await db
    .select({ id: user.id, fullName: userProfiles.fullName })
    .from(userProfiles)
    .innerJoin(user, eq(user.id, userProfiles.userId))
    .where(eq(userProfiles.role, "ADMIN"))
    .limit(1);
  if (!admin) {
    console.warn("! no ADMIN user found — skipping the hero release step");
    return 0;
  }

  const queue = await triageQueue(200);
  const held = queue.filter((item) => item.trackingId === trackingId);
  if (held.length === 0) return 0;

  const at = clockNow();
  const reason =
    "Seed pre-sync (Task 4.3): the proposal for the demo hero challenge is accepted from the " +
    "rules-tier run, recorded as labelled data exactly as an /admin/triage accept would.";
  for (const item of held) {
    await db.transaction(async (tx) => {
      const next: ChallengeStatus = item.stage === "S1_TRIAGE" ? "TRIAGED" : "CLUSTERED";
      if (canTransition(item.status as ChallengeStatus, next)) {
        await transition(tx, {
          challengeId: item.challengeId,
          to: next,
          actorId: admin.id,
          reason,
          meta: { by: "seed-presync", decision: "ACCEPT", stage: item.stage },
        });
      }
      await tx.insert(trainingCorrections).values({
        challengeId: item.challengeId,
        stage: item.stage,
        inputText: item.bodyOriginal.slice(0, 2000),
        inputHash: item.inputHash,
        proposed: item.proposal,
        corrected: item.proposal,
        reason,
        correctedBy: admin.id,
        createdAt: at,
      });
      await tx.insert(auditLog).values({
        actorId: admin.id,
        action: "TRIAGE_ACCEPT",
        targetType: "challenge",
        targetId: item.challengeId,
        reason,
        meta: { stage: item.stage, trackingId: item.trackingId, by: "seed-presync" },
        createdAt: at,
      });
    });
  }
  return held.length;
}

async function heroReport(trackingId: string): Promise<void> {
  const [hero] = await db
    .select({ id: challenges.id, status: challenges.status, severity: challenges.severity })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);
  if (!hero) {
    console.warn(`! hero ${trackingId} not found — no seeded row carries that tracking ID`);
    return;
  }
  const shortlist = await db
    .select({
      rank: routes.rank,
      orgName: organization.name,
      matchScore: routes.matchScore,
      reasonText: routes.reasonText,
      state: routes.state,
    })
    .from(routes)
    .innerJoin(organization, eq(organization.id, routes.orgId))
    .where(eq(routes.challengeId, hero.id))
    .orderBy(asc(routes.rank));

  console.log(`\nHero ${trackingId}: status ${hero.status}, severity ${hero.severity ?? "?"}`);
  if (shortlist.length === 0) {
    console.log("  shortlist: EMPTY — the demo walkthrough has nothing to show; investigate before staging.");
  } else {
    for (const r of shortlist) {
      console.log(
        `  #${r.rank} ${r.orgName}  match ${Number(r.matchScore ?? 0).toFixed(3)}  [${r.state}]`,
      );
      if (r.rank === 1 && r.reasonText) console.log(`      “${r.reasonText.slice(0, 160)}”`);
    }
  }
}

async function runWindowStats(): Promise<void> {
  const stats = await db
    .select({
      stage: aiRuns.stage,
      n: sql<number>`count(*)::int`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${aiRuns.latencyMs})::int`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${aiRuns.latencyMs})::int`,
      rules: sql<number>`count(*) filter (where ${aiRuns.fallbackLevel} = 2)::int`,
      cached: sql<number>`count(*) filter (where ${aiRuns.provider} = 'cache')::int`,
    })
    .from(aiRuns)
    .where(gte(aiRuns.createdAt, startedAt))
    .groupBy(aiRuns.stage)
    .orderBy(aiRuns.stage);

  console.log("\nThis pre-sync's receipts (all providers incl. cache):");
  console.log(`${"stage".padEnd(14)} ${"n".padStart(4)} ${"p50 ms".padStart(8)} ${"p95 ms".padStart(8)} ${"rules".padStart(6)} ${"cache".padStart(6)}`);
  for (const s of stats) {
    console.log(
      `${s.stage.padEnd(14)} ${String(s.n).padStart(4)} ${String(s.p50).padStart(8)} ${String(s.p95).padStart(8)} ${String(s.rules).padStart(6)} ${String(s.cached).padStart(6)}`,
    );
  }
}

export async function presync(): Promise<void> {
  console.log(`Pre-syncing every non-terminal challenge through the real pipeline (hero: ${HERO_TRACKING}).\n`);

  const targets = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId })
    .from(challenges)
    .where(notInArray(challenges.status, [...TERMINAL_STATES]))
    .orderBy(asc(challenges.trackingId));

  for (const t of targets) {
    printRunLine(t.trackingId, await runOne(t.id));
  }

  /**
   * Converge the hero's queue instead of releasing once: a replay after an
   * accept legitimately mints a NEW held item — the S2 cache key carries the
   * kNN prior's labels, a correction moves those labels, and the rules tier
   * will hold the re-keyed input too. Accept, replay, repeat, bounded: the
   * corpus is finite and each iteration has strictly fewer fresh holds.
   */
  const [hero] = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId })
    .from(challenges)
    .where(eq(challenges.trackingId, HERO_TRACKING))
    .limit(1);
  let releases = 0;
  let replays = 0;
  if (hero) {
    while (replays < 4) {
      const released = await releaseHeldItems(HERO_TRACKING);
      if (released === 0) break;
      releases += released;
      replays += 1;
      printRunLine(hero.trackingId, await runOne(hero.id));
    }
  }
  console.log(
    hero
      ? `\nHero release: accepted ${releases} held item(s) as labelled data across ${replays} replay(s); ` +
          `${releases === 0 ? "nothing held (already accepted, or confidence was above the floor)." : "queue converged."}`
      : `\n! hero ${HERO_TRACKING} not found — no seeded row carries that tracking ID`,
  );
  const stillHeld = (await triageQueue(500)).filter((item) => item.trackingId === HERO_TRACKING);
  if (stillHeld.length > 0) {
    console.warn(
      `! hero still has ${stillHeld.length} held item(s) after the bounded release loop — ` +
        "this means replays keep minting fresh low-confidence keys; accept them by hand at /admin/triage.",
    );
  }

  await heroReport(HERO_TRACKING);
  await runWindowStats();

  const remaining = await triageQueue(500);
  console.log(
    `\nTriage queue afterwards: ${remaining.length} genuinely low-confidence item(s) ` +
      `(the queue is derived — it can only ever contain what the runs put there).`,
  );
  const histogram = await db
    .select({ status: challenges.status, n: sql<number>`count(*)::int` })
    .from(challenges)
    .groupBy(challenges.status)
    .orderBy(desc(sql`count(*)`));
  console.log("Statuses:", histogram.map((h) => `${h.status}×${h.n}`).join("  "));
}

/* Direct execution (`pnpm seed:ai`) vs. inline use from the seeder (--ai). */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await presync();
  process.exit(0);
}
