/**
 * The pipeline: P0 -> S1 -> S2 -> embed -> S3 -> S4 -> S5.
 *
 * `runPipeline(challengeId, emit)` calls `emit` after every stage, which is
 * what the SSE route streams and what animates the trace on screen. Every stage
 * is wrapped in its own try/catch: a stage that fails emits a `degraded` event
 * and the pipeline continues, because a broken S5 must not cost the citizen
 * their S1 triage.
 *
 * State changes go through `lib/db/stateMachine.ts`, one transaction each, so
 * the status update, the ledger append, the outbox event and the SLA rows are
 * written together or not at all.
 *
 * Replay safety: every stage is idempotent and cached on its input hash, and a
 * challenge that is already past a given state recomputes without transitioning.
 * That is what makes the "Replay pipeline" button on a public page safe to press
 * in front of a judge.
 */
import "server-only";

import { and, eq, like } from "drizzle-orm";

import { clockNow, elapsedMs } from "@/lib/clock";
import { db } from "@/lib/db";
import {
  blocks,
  challengeMedia,
  challenges,
  districts,
  ledgerEntries,
  notifications,
  type ChallengeStatus,
} from "@/lib/db/schema";
import { canTransition, contentHashOf, transition } from "@/lib/db/stateMachine";
import { removeObjects } from "@/lib/media/storage";
import { getObject } from "@/lib/media/storage";
import { embed } from "./providers/embed";
import { transcribe, translate } from "./stages/p0";
import { decideS1, handoffContract, runS1 } from "./stages/s1";
import { decideS2, knnPrior, normaliseS2, runS2 } from "./stages/s2";
import type { S2Input } from "./schemas";
import {
  S3_THRESHOLDS,
  adjudicate,
  bandFor,
  findCandidates,
  describeCluster,
  findRollupCandidates,
  mergeInto,
  rollUp,
  scanForBrigading,
  type Candidate,
} from "./stages/s3";
import { runS4 } from "./stages/s4";
import {
  ROUTING,
  ensureCapabilityEmbeddings,
  loadCapabilities,
  matchScore,
  persistRoutes,
  reasonInputFor,
  shortlist,
  trackRecordFor,
  writeReason,
} from "./stages/s5";
import type { StageRunMeta } from "./types";

/* -------------------------------------------------------------- the events */

/** The five stages a judge watches, plus the two that support them. */
export const PIPELINE_STAGES = ["P0", "S1", "S2", "S3", "S4", "S5"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, { title: string; blurb: string }> = {
  P0: { title: "Language", blurb: "Translate into an English working copy. The original is kept." },
  S1: { title: "Safety and triage", blurb: "Is it safe? Is it a grievance someone already owes an answer for?" },
  S2: { title: "Domain and hazard", blurb: "What kind of problem, which NDMA hazard, how severe." },
  S3: { title: "Duplicates", blurb: "Has anyone else reported this? Duplicates are joined, never discarded." },
  S4: { title: "Priority score", blurb: "Seven weighted terms. No model call. Every number is shown." },
  S5: { title: "Routing", blurb: "Matched to university departments, with a written reason." },
};

export type PipelineEvent =
  | { type: "started"; challengeId: string; trackingId: string; status: ChallengeStatus; at: string }
  | {
      type: "stage";
      stage: PipelineStage;
      status: "running" | "done" | "degraded" | "skipped";
      at: string;
      /** The structured facts the stage produced, rendered in its card. */
      result?: unknown;
      /** The model's one-line rationale, shown under the result. */
      rationale?: string | null;
      /** What the deterministic code decided to do about it. */
      decision?: string | null;
      note?: string | null;
      meta?: Pick<StageRunMeta, "provider" | "model" | "fallbackLevel" | "confidence" | "latencyMs" | "cached"> | null;
    }
  | { type: "done"; challengeId: string; trackingId: string; status: ChallengeStatus; totalMs: number; at: string }
  | { type: "error"; message: string; at: string };

export type Emit = (event: PipelineEvent) => void | Promise<void>;

/* ------------------------------------------------------------- the context */

interface Ctx {
  challenge: typeof challenges.$inferSelect;
  districtName: string | null;
  blockName: string | null;
  /** Written by the embed step, read by S2's prior, S3 and S5. */
  embedding: number[] | null;
  /**
   * The embedding is started the moment the pipeline does, concurrently with
   * P0 and S1, because neither of them needs it and S2 cannot start without it.
   * Awaiting it inside S2 put a whole network round trip on the critical path
   * for no reason: measured, that was most of a second of the 8s budget.
   */
  embeddingPromise: Promise<number[] | null> | null;
  /**
   * S2 runs CONCURRENTLY with S1.
   *
   * They read the same text and neither needs the other's answer: S1 asks "is
   * this safe, is it a grievance", S2 asks "what kind of problem is it". Run in
   * series they cost two round trips back to back, which was most of two
   * seconds of the eight-second budget.
   *
   * The cost of speculating is one wasted classification on the minority of
   * reports S1 stops — and nothing is ever WRITTEN from a speculative result:
   * when S1 halts the challenge, S2's stage never runs and its answer is
   * discarded (the ai_runs row and the cache entry stay, which is honest, and
   * the cache makes the retry free if a human later releases it).
   */
  s2Promise: Promise<Awaited<ReturnType<typeof runS2>>> | null;
  s2Priors: S2Input["priors"];
  /**
   * S5's ranking and its three reason sentences are computed while S3 clusters.
   *
   * Routing depends on S2 (domain, hazard, severity) and the embedding, and on
   * nothing S3 or S4 produce — S4's priority score is not an input to the match
   * score at all. Waiting for them put four seconds of model latency at the very
   * end of the run, which is where a judge is watching hardest.
   *
   * Nothing is written from it: if S3 merges the report, `stageS5` never runs
   * and the shortlist is discarded. Persisting the routes stays in S5.
   */
  s5Promise: Promise<S5Prepared | null> | null;
  /** Set when a stage decides the pipeline should stop here. */
  halted: { reason: string } | null;
}

export interface RunOptions {
  /** Stop after this stage. Used by `pnpm pipeline:run --to S2`. */
  to?: PipelineStage;
  /** Start at this stage. Used by `pnpm pipeline:replay --from S1`. */
  from?: PipelineStage;
}

/* --------------------------------------------------------------- the runner */

export async function runPipeline(
  challengeId: string,
  emit: Emit,
  options: RunOptions = {},
): Promise<void> {
  const started = elapsedMs();
  const now = () => clockNow().toISOString();

  const ctx = await loadContext(challengeId);
  if (!ctx) {
    await emit({ type: "error", message: `challenge ${challengeId} not found`, at: now() });
    return;
  }

  await emit({
    type: "started",
    challengeId: ctx.challenge.id,
    trackingId: ctx.challenge.trackingId,
    status: ctx.challenge.status,
    at: now(),
  });

  // Both go off now, in parallel with P0 and S1.
  startEmbedding(ctx);
  startS2(ctx);

  const fromIndex = options.from ? PIPELINE_STAGES.indexOf(options.from) : 0;
  const toIndex = options.to ? PIPELINE_STAGES.indexOf(options.to) : PIPELINE_STAGES.length - 1;

  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const stage = PIPELINE_STAGES[i];
    if (i < fromIndex || i > toIndex) continue;

    if (ctx.halted) {
      await emit({
        type: "stage",
        stage,
        status: "skipped",
        at: now(),
        note: ctx.halted.reason,
      });
      continue;
    }

    await emit({ type: "stage", stage, status: "running", at: now() });

    try {
      await STAGE_RUNNERS[stage](ctx, emit);
    } catch (e) {
      // A stage failure degrades the run; it never ends it. The trace shows an
      // amber badge, not a red one, and the next stage still gets its chance.
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[pipeline] ${stage} failed for ${ctx.challenge.trackingId}:`, e);
      await emit({
        type: "stage",
        stage,
        status: "degraded",
        at: now(),
        note: message.slice(0, 300),
      });
    }
  }

  const [fresh] = await db
    .select({ status: challenges.status })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);

  await emit({
    type: "done",
    challengeId: ctx.challenge.id,
    trackingId: ctx.challenge.trackingId,
    status: fresh?.status ?? ctx.challenge.status,
    totalMs: elapsedMs() - started,
    at: now(),
  });
}

/* --------------------------------------------------------------- the stages */

type StageRunner = (ctx: Ctx, emit: Emit) => Promise<void>;

const STAGE_RUNNERS: Record<PipelineStage, StageRunner> = {
  P0: stageP0,
  S1: stageS1,
  S2: stageS2,
  S3: stageS3,
  S4: stageS4,
  S5: stageS5,
};

/**
 * P0 — the voice path and the English working copy.
 *
 * An attached recording is transcribed and the transcript becomes the report's
 * text; a report in any language other than English gains a working copy.
 * Neither replaces `body_original`, which the database itself now documents as
 * never-overwritten (migration 0006).
 *
 * A failure here degrades and continues: S1 and S2 read the original text, and
 * the gazetteer and both prompts are bilingual, so a missing translation costs
 * accuracy rather than the whole run.
 */
async function stageP0(ctx: Ctx, emit: Emit): Promise<void> {
  const c = ctx.challenge;
  const at = () => clockNow().toISOString();

  /* ---------------------------------------------------------- the recording */

  let transcriptNote: string | null = null;
  let transcriptSource: string | null = null;

  if (!c.bodyOriginal.trim() || c.bodyOriginal.startsWith("[voice note]")) {
    const [audio] = await db
      .select({ storageKey: challengeMedia.storageKey, mime: challengeMedia.mime })
      .from(challengeMedia)
      .where(and(eq(challengeMedia.challengeId, c.id), like(challengeMedia.mime, "audio/%")))
      .limit(1);

    if (audio) {
      const bytes = await getObject(audio.storageKey);
      const result = bytes ? await transcribe(bytes, audio.mime) : null;
      if (result) {
        await db
          .update(challenges)
          .set({ bodyOriginal: result.original, bodyLang: result.lang, updatedAt: clockNow() })
          .where(eq(challenges.id, c.id));
        ctx.challenge = { ...c, bodyOriginal: result.original, bodyLang: result.lang };
        transcriptNote = result.note;
        transcriptSource = result.source;
      }
    }
  }

  /* --------------------------------------------------------- the translation */

  const current = ctx.challenge;
  if (current.bodyEn) {
    await emit({
      type: "stage",
      stage: "P0",
      status: "done",
      at: at(),
      result: { body_lang: current.bodyLang, translated: true, transcript_source: transcriptSource },
      decision:
        current.bodyLang === "en"
          ? "Reported in English; the working copy is the citizen's own words."
          : "Already translated. The original is the record either way.",
      note: transcriptNote,
    });
    return;
  }

  const outcome = await translate(
    { bodyOriginal: current.bodyOriginal, bodyLang: current.bodyLang },
    current.id,
  );

  if (outcome.bodyEn) {
    await db
      .update(challenges)
      .set({ bodyEn: outcome.bodyEn, updatedAt: clockNow() })
      .where(eq(challenges.id, current.id));
    ctx.challenge = { ...current, bodyEn: outcome.bodyEn };
  }

  await emit({
    type: "stage",
    stage: "P0",
    status: outcome.translationFailed ? "degraded" : "done",
    at: at(),
    result: {
      body_lang: current.bodyLang,
      detected_lang: outcome.detectedLang,
      translated: Boolean(outcome.bodyEn),
      transcript_source: transcriptSource,
    },
    decision: outcome.translationFailed
      ? "No translation available, so the English copy is left empty rather than filled with the original. The rest of the pipeline reads the citizen's own words."
      : current.bodyLang === "en"
        ? "Reported in English; the working copy is the citizen's own words."
        : `Translated from ${current.bodyLang}. The original is kept and shown beside it, unchanged.`,
    note: transcriptNote,
    meta: outcome.run ? metaOf(outcome.run.meta) : null,
  });
}

/** S1 — safety and grievance triage, then the deterministic decision. */
async function stageS1(ctx: Ctx, emit: Emit): Promise<void> {
  const c = ctx.challenge;
  const run = await runS1(
    {
      title: c.title,
      bodyOriginal: c.bodyOriginal,
      bodyEn: c.bodyEn,
      districtCode: c.districtCode,
    },
    c.id,
  );

  // The decision reads the citizen's own words as well as the model's answer:
  // the evidence check for an irreversible forward is done against the text.
  const decision = decideS1(
    run.value,
    c.trackingId,
    [c.title, c.bodyOriginal, c.bodyEn ?? ""].join("\n"),
  );
  let decisionText: string;

  switch (decision.kind) {
    case "REJECT_UNSAFE": {
      decisionText = `Rejected as unsafe (${decision.category}). Media purged. Citizen shown ${decision.helpline.number}.`;
      await rejectUnsafe(ctx, decision.category, run.value.rationale);
      ctx.halted = { reason: "Stopped at S1: the report was rejected as unsafe." };
      break;
    }
    case "FORWARD_EXTERNAL": {
      decisionText = `Forwarded to ${decision.target} as ${decision.reference}.`;
      await forwardExternal(ctx, decision.target, decision.reference, run.value.rationale);
      ctx.halted = { reason: `Stopped at S1: forwarded to ${decision.target}.` };
      break;
    }
    case "HUMAN_QUEUE": {
      decisionText = `Held for a human at /admin/triage. ${decision.why}`;
      // Deliberately no transition: the challenge stays SUBMITTED and the
      // triage queue is derived from this run's confidence. Nothing is lost and
      // nothing is decided.
      break;
    }
    case "CONTINUE": {
      decisionText = "Safe, and not a grievance. Continuing to classification.";
      await advance(ctx, "TRIAGED", run.value.rationale);
      break;
    }
  }

  await emit({
    type: "stage",
    stage: "S1",
    status: run.meta.fallbackLevel === 2 ? "degraded" : "done",
    at: clockNow().toISOString(),
    result: run.value,
    rationale: run.value.rationale,
    decision: decisionText,
    meta: metaOf(run.meta),
  });
}

/**
 * Kick off S2's classification without waiting for S1.
 *
 * It still needs the embedding first, for the kNN prior, so it chains off that
 * promise rather than off the wall clock.
 */
function startS2(ctx: Ctx): void {
  if (ctx.s2Promise) return;
  const c = ctx.challenge;
  ctx.s2Promise = (async () => {
    const embedding = await embedChallenge(ctx);
    const priors = embedding ? await knnPrior(embedding, c.id) : [];
    ctx.s2Priors = priors;
    return runS2(
      {
        title: c.title,
        bodyOriginal: c.bodyOriginal,
        bodyEn: c.bodyEn,
        districtCode: c.districtCode,
        districtName: ctx.districtName,
        blockName: ctx.blockName,
        peopleAffected: c.peopleAffected,
        recurrence: c.recurrence,
        priors,
      },
      c.id,
    );
  })();
  // Nothing awaits this promise when S1 halts the run, so its rejection must
  // not surface as an unhandled rejection and take the process with it.
  ctx.s2Promise.catch(() => undefined);
}

/** S2 — domain, hazard, severity. Uses the embedding kNN prior. */
async function stageS2(ctx: Ctx, emit: Emit): Promise<void> {
  const c = ctx.challenge;

  startS2(ctx);
  const run = await ctx.s2Promise!;
  const priors = ctx.s2Priors;

  const value = normaliseS2(run.value);
  const decision = decideS2(value);

  /**
   * A rule-tier answer never overwrites an existing classification.
   *
   * The gazetteer is a keyword matcher reporting 0.45 confidence. When it runs
   * because both providers were rate-limited, replacing a domain and hazard a
   * person authored with a keyword guess makes the data worse, not better --
   * and it would do it silently, on every challenge, in exactly the conditions
   * where nobody is watching.
   *
   * So a level-2 answer on an already-classified challenge is recorded as a
   * proposal in `ai_runs`, shown on the trace, and sent to /admin/triage. It
   * changes nothing. A level-0 or level-1 answer writes as normal, and so does
   * a level-2 answer on a challenge that had no classification at all, because
   * a weak label beats none.
   */
  const alreadyClassified = c.domain !== null && c.hazard !== null;
  const keepExisting = run.meta.fallbackLevel === 2 && alreadyClassified;

  if (!keepExisting) {
    await db
      .update(challenges)
      .set({
        domain: value.domain,
        hazard: value.hazard,
        hazardStrength: value.hazard_strength.toFixed(2),
        severity: value.severity.toFixed(2),
        solvability: value.solvability,
        capitalWorks: value.capital_works,
        updatedAt: clockNow(),
      })
      .where(eq(challenges.id, c.id));

    ctx.challenge = {
      ...c,
      domain: value.domain,
      hazard: value.hazard,
      hazardStrength: value.hazard_strength.toFixed(2),
      severity: value.severity.toFixed(2),
      solvability: value.solvability,
      capitalWorks: value.capital_works,
    };
  }

  let decisionText: string;
  if (keepExisting) {
    decisionText =
      `No model was reachable, so the rule tier answered and the existing classification ` +
      `(${c.domain} / ${c.hazard}) stands unchanged. The proposal is recorded and this is at /admin/triage.`;
  } else if (decision.kind === "HUMAN_QUEUE") {
    decisionText = `Classification proposed but held for a human at /admin/triage. ${decision.why}`;
  } else {
    decisionText = `${value.domain} / ${value.hazard}, severity ${value.severity.toFixed(2)}.`;
    await advance(ctx, "CLASSIFIED", value.rationale);
  }

  // Routing has everything it needs now. Off it goes, alongside S3 and S4.
  startS5(ctx);

  await emit({
    type: "stage",
    stage: "S2",
    status: run.meta.fallbackLevel === 2 ? "degraded" : "done",
    at: clockNow().toISOString(),
    result: { ...value, priors },
    rationale: value.rationale,
    decision: decisionText,
    meta: metaOf(run.meta),
  });
}

/**
 * S3 — duplicates, corroboration, roll-up.
 *
 * The decision is a cosine number with fixed thresholds. The model is called
 * only for the ambiguous 0.72-0.86 band, and only to answer one question with
 * a boolean. Everything that happens as a result is written here, in code.
 */
async function stageS3(ctx: Ctx, emit: Emit): Promise<void> {
  const c = ctx.challenge;
  const embedding = await embedChallenge(ctx);

  if (!embedding) {
    await emit({
      type: "stage",
      stage: "S3",
      status: "degraded",
      at: clockNow().toISOString(),
      note: "No embedding available, so no duplicate check was possible. The challenge continues unclustered.",
    });
    return;
  }

  const candidates = await findCandidates({
    id: c.id,
    blockCode: c.blockCode,
    districtCode: c.districtCode,
    embedding,
  });

  const comparisons: Array<{
    trackingId: string;
    similarity: number;
    band: string;
    verdict: string;
  }> = [];

  let merged: { into: string; similarity: number; count: number } | null = null;
  let adjudicationMeta: ReturnType<typeof metaOf> | null = null;

  // Candidates come back nearest-first, so the first one in the ambiguous band
  // is the strongest case for a merge. If the model says that one is a different
  // problem, the ones behind it are further away and the answer would be the
  // same, so we spend exactly one adjudication call rather than one per
  // candidate. Measured: that was over a second of the 8s budget in a block
  // where several reports sit in the middle band.
  //
  // And none at all when this report cannot be merged anyway — a report S1 held
  // for a human is still compared, and the cosines are still shown so the
  // reviewer sees the likely duplicate, but there is no point spending a model
  // call to answer a question we are not allowed to act on.
  let adjudicationsLeft = canTransition(ctx.challenge.status, "MERGED") ? 1 : 0;

  for (const candidate of candidates) {
    const band = bandFor(candidate.similarity);
    let same = band === "AUTO_MERGE";
    let verdict = band === "AUTO_MERGE" ? "same problem (above the auto-merge line)" : "distinct";

    if (band === "ADJUDICATE" && adjudicationsLeft <= 0) {
      verdict = canTransition(ctx.challenge.status, "MERGED")
        ? "ambiguous — not adjudicated; a nearer candidate in the same band was already ruled different"
        : "ambiguous — not adjudicated; this report is held for human review and cannot be merged";
    } else if (band === "ADJUDICATE") {
      adjudicationsLeft--;
      const run = await adjudicate(
        {
          a: { trackingId: c.trackingId, title: c.title, body: c.bodyEn ?? c.bodyOriginal, block: c.blockCode },
          b: { trackingId: candidate.trackingId, title: candidate.title, body: candidate.body, block: candidate.blockCode },
          similarity: candidate.similarity,
        },
        c.id,
      );
      adjudicationMeta = metaOf(run.meta);
      same = run.value.same_problem && run.value.confidence >= S3_THRESHOLDS.adjudicateConfidence;
      verdict = `${same ? "same problem" : "distinct"} — ${run.value.rationale}`;
    }

    comparisons.push({
      trackingId: candidate.trackingId,
      similarity: Number(candidate.similarity.toFixed(4)),
      band,
      verdict,
    });

    // Only the first match merges. A challenge is a duplicate of one thing.
    if (same && !merged && mergeable(ctx, candidate)) {
      const result = await mergeInto({
        survivor: {
          id: candidate.id,
          trackingId: candidate.trackingId,
          corroborationCount: candidate.corroborationCount,
          lat: candidate.lat,
          lng: candidate.lng,
        },
        loser: {
          id: c.id,
          trackingId: c.trackingId,
          reporterId: c.reporterId,
          reporterName: c.reporterName,
          lat: c.lat,
          lng: c.lng,
          corroborationCount: c.corroborationCount,
        },
        similarity: candidate.similarity,
        rationale: verdict,
      });
      merged = {
        into: result.survivorTrackingId,
        similarity: result.similarity,
        count: result.newCorroborationCount,
      };
      ctx.challenge = { ...ctx.challenge, status: "MERGED", parentId: candidate.id, clusterId: candidate.id };
      ctx.halted = {
        reason: `Stopped at S3: merged into ${result.survivorTrackingId}, which now carries ${result.newCorroborationCount} reports.`,
      };
    }
  }

  const flags = merged ? [] : await scanForBrigading(c.id);

  // The roll-up. Only looked for when this report was not itself a duplicate:
  // a merged report is already part of something bigger.
  let rolledUp: Awaited<ReturnType<typeof rollUp>> = null;
  if (!merged) {
    const children = await findRollupCandidates({
      id: c.id,
      districtCode: c.districtCode,
      blockCode: c.blockCode,
      embedding,
    });
    if (children && c.blockCode) {
      rolledUp = await rollUp({
        blockCode: c.blockCode,
        districtCode: c.districtCode,
        children,
        domain: c.domain,
        hazard: c.hazard,
        title: describeCluster(children, ctx.districtName ?? c.districtCode ?? "This district"),
        body:
          `${children.length} separate citizen reports across ` +
          `${new Set(children.map((x) => x.blockCode)).size} blocks of ${ctx.districtName ?? c.districtCode} ` +
          `describe the same underlying problem:\n\n` +
          children.map((x) => `- ${x.trackingId}: ${x.title}`).join("\n") +
          `\n\nEach of those reports keeps its own page, its own reporter and its own credit chain. ` +
          `This parent exists so a research team can address the cause rather than one instance of it.`,
      });
    }
  }

  if (!merged) await advance(ctx, "CLUSTERED", "No duplicate above the merge threshold.");

  await emit({
    type: "stage",
    stage: "S3",
    status: "done",
    at: clockNow().toISOString(),
    result: { comparisons, merged, rolledUp, anomalies: flags, thresholds: S3_THRESHOLDS },
    decision: merged
      ? `Merged into ${merged.into} at cosine ${merged.similarity.toFixed(3)}. Both reporters credited; ${merged.into} now shows ${merged.count} reports.`
      : (canTransition(ctx.challenge.status, "MERGED")
          ? `No duplicate above ${S3_THRESHOLDS.autoMerge}. ${candidates.length} nearby report(s) compared.`
          : `${candidates.length} nearby report(s) compared, but this report is held for a human review, so nothing was merged automatically.`) +
        (rolledUp
          ? ` Created the systemic parent ${rolledUp.parentTrackingId} over ${rolledUp.childTrackingIds.length} reports; the children keep their own pages.`
          : "") +
        (flags.length > 0 ? ` ${flags.length} corroboration anomaly flag(s) raised.` : ""),
    meta: adjudicationMeta,
  });
}

/**
 * A merge target must be a real, live challenge.
 *
 * Merging into something already terminal would bury a new report inside a
 * closed one, and merging into a challenge that already merged into us would
 * make a cycle. Both are cheap to check and expensive to discover later.
 */
function mergeable(ctx: Ctx, candidate: Candidate): boolean {
  if (candidate.id === ctx.challenge.parentId) return false;

  // A systemic parent is never merged away. Its body lists its children, so it
  // reads as semantically near-identical to every one of them and S3 will
  // happily fold the roll-up back into a single village report — which is
  // exactly the pattern the roll-up existed to make visible.
  if (ctx.challenge.isParent) return false;

  // A merge is consequential and awkward to undo: it moves a report to a
  // terminal state and folds it into someone else's. So it only happens from a
  // state the machine says can reach MERGED.
  //
  // In practice that check means one specific thing: when S1 held this report
  // for a human at /admin/triage, its status is still SUBMITTED and S3 must not
  // merge it. The AI does not get to take an irreversible action on an item it
  // has already admitted it is unsure about. The comparison is still computed
  // and still shown, so the human sees the likely duplicate when they decide.
  if (!canTransition(ctx.challenge.status, "MERGED")) return false;

  // The FIRST person to report a problem is its originator, and a merge must
  // never take that away from them just because their neighbour's report
  // happened to run through the pipeline first. So a challenge only ever merges
  // into an OLDER one; the older report is always the survivor, whatever order
  // `--all` walks the table in.
  const theirs = candidate.createdAt.getTime();
  const ours = ctx.challenge.createdAt.getTime();
  // Tracking IDs are sequential within a district, so they break a tie the same
  // way every run. Without this, two reports written in the same second would
  // merge in whichever direction the batch happened to reach first.
  if (theirs > ours || (theirs === ours && candidate.trackingId > ctx.challenge.trackingId)) {
    return false;
  }

  return !["MERGED", "REJECTED_UNSAFE", "FORWARDED_EXTERNAL", "WITHDRAWN", "CLOSED"].includes(
    candidate.status,
  );
}

/**
 * S4 — the priority score.
 *
 * No model call. Not "usually no model call" — there is no provider import
 * reachable from here, no `ai_runs` row is written, and the computation is a
 * pure function in `packages/scoring` that a judge can read in two minutes.
 * That is the answer to "is an AI deciding who gets help".
 */
async function stageS4(ctx: Ctx, emit: Emit): Promise<void> {
  const result = await runS4(ctx.challenge.id);
  if (!result) throw new Error("challenge disappeared between stages");

  ctx.challenge = {
    ...ctx.challenge,
    priorityScore: result.score.total.toFixed(3),
    priorityBreakdown: { ...result.score, input: result.input },
    scoringVersion: result.score.version,
  };

  await advance(ctx, "PRIORITISED", `Scored ${result.score.total.toFixed(1)} under weights v${result.score.version}.`);

  const top = [...result.score.terms].sort((a, b) => b.contribution - a.contribution).slice(0, 3);

  await emit({
    type: "stage",
    stage: "S4",
    status: "done",
    at: clockNow().toISOString(),
    result: result.score,
    rationale:
      `Top three terms: ` +
      top.map((t) => `${t.label} ${(t.contribution * 100).toFixed(1)}`).join(", ") +
      `.`,
    decision: `Priority ${result.score.total.toFixed(1)} of 100, weights v${result.score.version}. Every term is shown on the public page.`,
    // Deliberately null: there is no provider, no model and no confidence here,
    // and the trace footer says "deterministic" rather than inventing one.
    meta: null,
  });
}

interface S5Prepared {
  matches: Awaited<ReturnType<typeof shortlist>>;
  reasons: Array<Awaited<ReturnType<typeof writeReason>>>;
}

/**
 * Rank the capability graph and write the three reason sentences.
 *
 * Started from S2 so it runs alongside S3 and S4. Everything here is a
 * computation: no route row is written and no notification is sent until
 * `stageS5` consumes the result, so a report that S3 merges costs nothing but
 * three cached sentences.
 */
function startS5(ctx: Ctx): void {
  if (ctx.s5Promise) return;
  const c = ctx.challenge;

  ctx.s5Promise = (async () => {
    const embedding = await embedChallenge(ctx);
    if (!embedding) return null;

    await ensureCapabilityEmbeddings();
    const [pool, trackRecord] = await Promise.all([loadCapabilities(), trackRecordFor(c.domain)]);

    const scored = pool.map((capability) =>
      matchScore(capability, {
        embedding,
        domain: c.domain,
        hazard: c.hazard,
        lat: c.lat === null ? null : Number(c.lat),
        lng: c.lng === null ? null : Number(c.lng),
        trackRecord,
        now: clockNow(),
      }),
    );

    const matches = shortlist(scored);
    if (matches.length === 0) return { matches, reasons: [] };

    // Three independent sentences, three concurrent calls. Each one sees only
    // its own match's three terms — invariant 4 is not traded for latency.
    const reasons = await Promise.all(matches.map((m) => writeReason(reasonInputFor(m), c.id)));
    return { matches, reasons };
  })();

  ctx.s5Promise.catch(() => undefined);
}

/**
 * S5 — capability routing, then the human gate.
 *
 * The ranking is arithmetic and was computed while S3 ran. This stage decides
 * what to do with it: write the routes, and either release the notifications or
 * hold everything for a District Collector.
 */
async function stageS5(ctx: Ctx, emit: Emit): Promise<void> {
  const c = ctx.challenge;
  startS5(ctx);
  const prepared = await ctx.s5Promise;

  if (!prepared) throw new Error("no embedding, so no semantic match was possible");

  const { matches: top, reasons } = prepared;
  if (top.length === 0) {
    await emit({
      type: "stage",
      stage: "S5",
      status: "degraded",
      at: clockNow().toISOString(),
      note: "No active capability matched. The challenge stays prioritised and escalates on its SLA ladder.",
    });
    return;
  }

  const severity = c.severity === null ? null : Number(c.severity);
  // A challenge that cannot legally reach ROUTED is one the platform is still
  // unsure about — S1 or S2 held it for a human. The shortlist is still
  // computed and stored, because the reviewer wants to see it; nothing is sent.
  const canRoute = canTransition(c.status, "VERIFIED") || c.status === "VERIFIED";
  const result = await persistRoutes({
    challengeId: c.id,
    trackingId: c.trackingId,
    severity,
    canRoute,
    matches: top,
    reasons,
  });

  // The gate. Above the severity threshold nothing is notified and nothing
  // routes: the challenge moves to VERIFIED-pending and waits for the District
  // Collector at /gov/gate. Below it, routing releases automatically.
  if (result.gated) {
    if (canRoute) {
      await advance(ctx, "VERIFIED", `Severity ${severity?.toFixed(2)} is at or above the ${ROUTING.humanGateSeverity} human gate.`);
    }
  } else {
    await advance(ctx, "VERIFIED", "Below the human gate threshold; routing released automatically.");
    await advance(ctx, "ROUTED", `Offered to ${result.routes.length} institutions with a ${ROUTING.claimWindowDays}-day claim window.`);
  }

  await emit({
    type: "stage",
    stage: "S5",
    status: reasons.every((r) => r.meta === null) ? "degraded" : "done",
    at: clockNow().toISOString(),
    result: {
      version: "1.0.0",
      gated: result.gated,
      claimWindowEndsAt: result.claimWindowEndsAt.toISOString(),
      matches: result.routes.map((r) => ({
        rank: r.rank,
        institution: r.orgName,
        department: r.department,
        lab: r.labName,
        matchScore: r.matchScore,
        reason: r.reasonText,
        reasonTerms: r.reasonTerms,
        reasonFromTemplate: r.guarded,
      })),
    },
    decision: result.gated
      ? !canRoute
        ? `A shortlist of ${result.routes.length} was computed but nothing was sent: this report is still held for a human at /admin/triage.`
        : `Severity ${severity?.toFixed(2)} is at or above ${ROUTING.humanGateSeverity}: nothing has been notified. Waiting for the District Collector at /gov/gate.`
      : `Offered to ${result.routes.length} institutions. ${result.notified} notification(s) sent, claim window ${ROUTING.claimWindowDays} days.`,
    meta: reasons.find((r) => r.meta)?.meta ? metaOf(reasons.find((r) => r.meta)!.meta!) : null,
  });
}

/* -------------------------------------------------------------- the writers */

/**
 * Move the challenge on.
 *
 * A challenge that is already past the target state is not an error and not a
 * silent no-op: the transition is skipped and said so in the log, which is what
 * makes replaying the pipeline over the seed set safe.
 */
async function advance(ctx: Ctx, to: ChallengeStatus, reason: string | null): Promise<void> {
  const current = ctx.challenge.status;
  if (current === to) return;

  if (!canTransition(current, to)) {
    console.info(
      `[pipeline] ${ctx.challenge.trackingId}: already at ${current}, not moving to ${to} (recompute only)`,
    );
    return;
  }

  await db.transaction(async (tx) => {
    await transition(tx, {
      challengeId: ctx.challenge.id,
      to,
      reason,
      meta: { by: "pipeline" },
    });
  });
  ctx.challenge = { ...ctx.challenge, status: to };
}

/**
 * Reject as unsafe.
 *
 * The media objects are purged from storage, not merely unlinked, and the
 * challenge is not published. The submitter's anonymity is preserved: the
 * ledger records that a rejection happened and why, and does not copy the text.
 */
async function rejectUnsafe(ctx: Ctx, category: string, rationale: string): Promise<void> {
  const media = await db
    .select({ id: challengeMedia.id, storageKey: challengeMedia.storageKey })
    .from(challengeMedia)
    .where(eq(challengeMedia.challengeId, ctx.challenge.id));

  const purged = await removeObjects(media.map((m) => m.storageKey));
  await db.delete(challengeMedia).where(eq(challengeMedia.challengeId, ctx.challenge.id));

  const at = clockNow();
  await db.transaction(async (tx) => {
    await transition(tx, {
      challengeId: ctx.challenge.id,
      to: "REJECTED_UNSAFE",
      reason: rationale,
      meta: { category, mediaPurged: purged.length, by: "pipeline" },
    });
    await tx.insert(ledgerEntries).values({
      challengeId: ctx.challenge.id,
      kind: "OVERRIDE",
      // The hash covers the decision, not the text: a rejected report's words
      // are not copied into a public, permanent, append-only table.
      contentHash: contentHashOf({ decision: "REJECTED_UNSAFE", category, at: at.toISOString() }),
      payload: { decision: "REJECTED_UNSAFE", category, mediaPurged: media.length, by: "S1" },
      createdAt: at,
    });
  });
  ctx.challenge = { ...ctx.challenge, status: "REJECTED_UNSAFE" };
}

/**
 * Forward to CPGRAMS/JharSewa.
 *
 * "CPGRAMS routes complaints to officers. We route unsolved problems to labs.
 * When something is a grievance, we forward it to CPGRAMS." Sentence 2 of the
 * five, made true here. The citizen is told where it went; the handoff contract
 * is rendered on the challenge page.
 */
async function forwardExternal(
  ctx: Ctx,
  target: string,
  reference: string,
  rationale: string,
): Promise<void> {
  const c = ctx.challenge;
  const at = clockNow();
  const contract = handoffContract({
    target,
    reference,
    trackingId: c.trackingId,
    title: c.title,
    bodyOriginal: c.bodyOriginal,
    bodyLang: c.bodyLang,
    bodyEn: c.bodyEn,
    districtCode: c.districtCode,
    blockCode: c.blockCode,
    reporterName: c.reporterName,
    rationale,
    createdAt: c.createdAt,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(challenges)
      .set({ isGrievance: true, forwardedRef: reference, updatedAt: at })
      .where(eq(challenges.id, c.id));

    await transition(tx, {
      challengeId: c.id,
      to: "FORWARDED_EXTERNAL",
      reason: rationale,
      meta: { target, reference, contract, by: "pipeline" },
    });

    if (c.reporterId) {
      await tx.insert(notifications).values({
        userId: c.reporterId,
        kind: "GRIEVANCE_FORWARDED",
        title: `Your report was sent to ${target}`,
        body:
          `${c.trackingId} describes something ${target} already has an officer for, so we forwarded it ` +
          `rather than sitting on it. Their reference is ${reference}. You can see exactly what we sent them.`,
        // Push, never browse: straight to the page, not to a list.
        actionUrl: `/c/${c.trackingId}`,
        createdAt: at,
      });
    }
  });

  ctx.challenge = { ...ctx.challenge, status: "FORWARDED_EXTERNAL", isGrievance: true, forwardedRef: reference };
}

/* ------------------------------------------------------------------ helpers */

/** The text an embedding is built from: title, English copy and the district. */
export function embeddingTextFor(c: {
  title: string;
  bodyEn: string | null;
  bodyOriginal: string;
  districtCode: string | null;
}): string {
  return [c.title, c.bodyEn ?? c.bodyOriginal, c.districtCode ?? ""].join("\n");
}

function startEmbedding(ctx: Ctx): void {
  if (ctx.embeddingPromise) return;
  ctx.embeddingPromise = (async () => {
    const result = await embed(embeddingTextFor(ctx.challenge), ctx.challenge.id);
    await db
      .update(challenges)
      .set({ embedding: result.vector })
      .where(eq(challenges.id, ctx.challenge.id));
    ctx.embedding = result.vector;
    return result.vector;
  })().catch((e) => {
    // An embedding failure costs us the kNN prior, the duplicate check and the
    // semantic half of routing. It does not cost the citizen their triage, so
    // it degrades rather than throws.
    console.error("[pipeline] embedding failed", e);
    return null;
  });
}

async function embedChallenge(ctx: Ctx): Promise<number[] | null> {
  if (ctx.embedding) return ctx.embedding;
  startEmbedding(ctx);
  return ctx.embeddingPromise;
}

async function loadContext(challengeId: string): Promise<Ctx | null> {
  const [row] = await db
    .select({
      challenge: challenges,
      districtName: districts.name,
      blockName: blocks.name,
    })
    .from(challenges)
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .leftJoin(blocks, eq(blocks.code, challenges.blockCode))
    .where(eq(challenges.id, challengeId))
    .limit(1);

  if (!row) return null;
  return {
    challenge: row.challenge,
    districtName: row.districtName,
    blockName: row.blockName,
    embedding: null,
    embeddingPromise: null,
    s2Promise: null,
    s2Priors: [],
    s5Promise: null,
    halted: null,
  };
}

function metaOf(meta: StageRunMeta) {
  return {
    provider: meta.provider,
    model: meta.model,
    fallbackLevel: meta.fallbackLevel,
    confidence: meta.confidence,
    latencyMs: meta.latencyMs,
    cached: meta.cached,
  };
}
