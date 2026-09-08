/**
 * The pipeline trace, projected backwards from its own receipts.
 *
 * The live trace streams events as the pipeline runs; everything below
 * reconstructs the same stage cards from what the run actually left behind:
 * the `ai_runs` rows (receipt per model call), the `routes` rows S5 persisted,
 * and the challenge's own columns (bodyEn, priorityBreakdown, status).
 *
 * Two readers need this:
 *
 * - the success page, for a challenge that has already been through the
 *   pipeline (the demo walks a pre-synced seed most of the time — it must
 *   render complete, not spin), and
 * - the trace poller, which ticks stage cards off as rows land while a run is
 *   still going.
 *
 * The rule that makes this honest: every card renders only from state that
 * provably happened — a row, a persisted score, a written route. Where the
 * live trace had ephemeral detail (S3's comparison table, S2's kNN priors)
 * that was never persisted, the card says so rather than inventing it.
 */
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { decideS1 } from "@/lib/ai/triage";
import type { S2Output } from "@/lib/ai/schemas";
import { decideS2 } from "@/lib/ai/stages/s2";
import { S3_THRESHOLDS } from "@/lib/ai/stages/s3";
import { ROUTING } from "@/lib/ai/routing";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { aiRuns, capabilities, challenges, organization, routes } from "@/lib/db/schema";

export type TraceStageKey = "P0" | "S1" | "S2" | "S3" | "S4" | "S5";
export type TraceStageStatus = "waiting" | "done" | "degraded" | "skipped";

export interface TraceMeta {
  provider: string;
  model: string | null;
  fallbackLevel: number;
  confidence: number | null;
  latencyMs: number;
  cached: boolean;
}

export interface TraceStage {
  status: TraceStageStatus;
  result?: unknown;
  rationale?: string | null;
  decision?: string | null;
  note?: string | null;
  meta?: TraceMeta | null;
  at?: string | null;
}

export interface TraceProjection {
  stages: Record<TraceStageKey, TraceStage>;
  /** Every stage reached a terminal glyph (done / degraded / skipped). */
  complete: boolean;
  status: string;
}

export const TRACE_KEY_ORDER: readonly TraceStageKey[] = ["P0", "S1", "S2", "S3", "S4", "S5"];

/* How each stage knows its receipts: the ai_runs stage keys it may read. */
type RunStage = "P0_TRANSLATE" | "S1_TRIAGE" | "S2_CLASSIFY" | "S5_REASON";

const EARLY_STATUSES = ["SUBMITTED", "NEEDS_MORE_INFO"] as const;

export async function projectTrace(challengeId: string): Promise<TraceProjection | null> {
  const parent = alias(challenges, "parent");
  const [row] = await db
    .select({ challenge: challenges, parentTrackingId: parent.trackingId })
    .from(challenges)
    .leftJoin(parent, eq(parent.id, challenges.parentId))
    .where(eq(challenges.id, challengeId))
    .limit(1);
  if (!row) return null;
  const c = row.challenge;

  const [runRows, routeRows] = await Promise.all([
    db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.challengeId, challengeId))
      .orderBy(desc(aiRuns.createdAt)),
    db
      .select({
        rank: routes.rank,
        orgName: organization.name,
        department: capabilities.department,
        lab: capabilities.labName,
        matchScore: routes.matchScore,
        reasonText: routes.reasonText,
        reasonTerms: routes.reasonTerms,
        notifiedAt: routes.notifiedAt,
        claimWindowEndsAt: routes.claimWindowEndsAt,
        createdAt: routes.createdAt,
      })
      .from(routes)
      .innerJoin(organization, eq(organization.id, routes.orgId))
      .leftJoin(capabilities, eq(capabilities.id, routes.capabilityId))
      .where(eq(routes.challengeId, challengeId))
      .orderBy(routes.rank),
  ]);

  const latestOf = (stage: RunStage) =>
    runRows.find((r) => r.stage === stage) ?? null;

  const metaOf = (r: (typeof runRows)[number] | null): TraceMeta | null =>
    r === null
      ? null
      : {
          provider: r.provider ?? "unknown",
          model: r.model,
          fallbackLevel: r.fallbackLevel,
          confidence: r.confidence === null ? null : Number(r.confidence),
          latencyMs: r.latencyMs ?? 0,
          cached: r.provider === "cache",
        };

  const outputOf = (r: (typeof runRows)[number] | null): unknown =>
    (r?.output as { value?: unknown } | null)?.value ?? null;

  /* ------------------------------------------------------------ halted? */

  const halted =
    c.status === "REJECTED_UNSAFE" || c.status === "FORWARDED_EXTERNAL" || c.status === "MERGED";

  /* ------------------------------------------------------------ P0 */

  const p0 = latestOf("P0_TRANSLATE");
  let P0: TraceStage = { status: "waiting" };
  if (p0) {
    const translated = c.bodyEn !== null;
    P0 = {
      status: translated ? (p0.fallbackLevel === 2 && !translated ? "degraded" : "done") : "degraded",
      result: {
        body_lang: c.bodyLang,
        translated,
        transcript_source: null,
      },
      decision: translated
        ? "Translated into an English working copy. The original is the record either way."
        : "No translation available, so the English copy is left empty rather than filled with the original. The rest of the pipeline reads the citizen's own words.",
      meta: metaOf(p0),
      at: p0.createdAt.toISOString(),
    };
    if (p0.fallbackLevel === 2) P0.status = "degraded";
  } else if (!EARLY_STATUSES.includes(c.status as (typeof EARLY_STATUSES)[number]) || c.bodyLang === "en") {
    /* An English report never calls the translator, so there is no receipt to
     * point at — the challenge's own language column is the receipt. */
    P0 = {
      status: "done",
      result: { body_lang: c.bodyLang, translated: false, transcript_source: null },
      decision:
        c.bodyLang === "en"
          ? "Reported in English; the working copy is the citizen's own words."
          : "Translated into an English working copy. The original is the record either way.",
      meta: null,
    };
  }

  /* ------------------------------------------------------------ S1 */

  const s1 = latestOf("S1_TRIAGE");
  let S1: TraceStage = { status: "waiting" };
  if (s1) {
    const value = outputOf(s1) as Parameters<typeof decideS1>[0] | null;
    const decision = value
      ? decideS1(value, c.trackingId, [c.title, c.bodyOriginal, c.bodyEn ?? ""].join("\n"))
      : null;
    S1 = {
      status: s1.fallbackLevel === 2 ? "degraded" : "done",
      result: value,
      rationale: (value as { rationale?: string } | null)?.rationale ?? null,
      decision:
        decision === null
          ? null
          : decision.kind === "REJECT_UNSAFE"
            ? `Rejected as unsafe (${decision.category}). Media purged. Citizen shown ${decision.helpline.number}.`
            : decision.kind === "FORWARD_EXTERNAL"
              ? `Forwarded to ${decision.target} as ${decision.reference}.`
              : decision.kind === "HUMAN_QUEUE"
                ? `Held for a human at /admin/triage. ${decision.why}`
                : "Safe, and not a grievance. Continuing to classification.",
      meta: metaOf(s1),
      at: s1.createdAt.toISOString(),
    };
  }

  /* ------------------------------------------------------------ S2 */

  const s2 = latestOf("S2_CLASSIFY");
  let S2: TraceStage = { status: "waiting" };
  if (s2) {
    const raw = outputOf(s2);
    const value = raw ? (raw as S2Output) : null;
    let decisionText: string | null = null;
    if (value) {
      const decision = decideS2(value);
      decisionText =
        decision.kind === "HUMAN_QUEUE"
          ? `Classification proposed but held for a human at /admin/triage. ${decision.why}`
          : `${value.domain}, severity ${value.severity.toFixed(2)}.`;
    }
    S2 = {
      status: s2.fallbackLevel === 2 ? "degraded" : "done",
      result: value,
      rationale: (value as { rationale?: string } | null)?.rationale ?? null,
      decision: decisionText,
      meta: metaOf(s2),
      at: s2.createdAt.toISOString(),
    };
  }

  /* ------------------------------------------------------------ S3 */

  let S3: TraceStage = { status: "waiting" };
  if (halted) {
    S3 = { status: "skipped", note: haltedNote(c.status, row.parentTrackingId) };
  } else if (c.isParent) {
    S3 = {
      status: "done",
      result: { comparisons: [], merged: null },
      decision:
        `This report became a systemic parent over its near-duplicate cluster ` +
        `(children are linked from the public page). The comparison detail streams on the live trace.`,
      meta: null,
    };
  } else if (
    !["SUBMITTED", "NEEDS_MORE_INFO", "TRIAGED", "CLASSIFIED"].includes(c.status) ||
    c.priorityScore !== null
  ) {
    /* S3 advanced the report to CLUSTERED (or a later state) — or S4 wrote a
     * score, which only ever happens downstream of S3. The second shape is
     * the held-for-human seed: S3 ran and compared, was forbidden to merge,
     * and the status never moved, exactly as designed. The comparison table
     * itself was ephemeral — computed live, never written — so the replayed
     * card states the outcome and says plainly where the full table lives
     * instead of faking rows. */
    S3 = {
      status: "done",
      result: { comparisons: [], merged: null },
      decision:
        `No duplicate above ${S3_THRESHOLDS.autoMerge}; the report continued unmerged. ` +
        `The full comparison table streams on the live trace the moment the run happens — it is computed, not stored.`,
      meta: null,
    };
  }

  /* ------------------------------------------------------------ S4 */

  let S4: TraceStage = { status: "waiting" };
  if (c.priorityBreakdown !== null && c.priorityScore !== null) {
    const breakdown = c.priorityBreakdown as { version?: number; total?: number; terms?: Array<{ label: string; contribution: number }> };
    const top = [...(breakdown.terms ?? [])]
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3);
    S4 = {
      status: "done",
      result: breakdown,
      rationale:
        top.length > 0
          ? `Top three terms: ` +
            top.map((t) => `${t.label} ${(t.contribution * 100).toFixed(1)}`).join(", ") +
            `.`
          : null,
      decision: `Priority ${Number(c.priorityScore).toFixed(1)} of 100, weights v${breakdown.version ?? c.scoringVersion ?? "?"}. Every term is shown on the public page.`,
      meta: null,
    };
  }

  /* ------------------------------------------------------------ S5 */

  const s5 = latestOf("S5_REASON");
  let S5: TraceStage = { status: "waiting" };
  if (routeRows.length > 0) {
    const gated = routeRows.every((r) => r.notifiedAt === null);
    const matches = routeRows.map((r) => {
      const terms = (r.reasonTerms as { terms?: Array<{ label: string; detail: string; contribution: number }>; guardrailFallback?: boolean } | null);
      return {
        rank: r.rank,
        institution: r.orgName,
        department: r.department,
        lab: r.lab,
        matchScore: Number(r.matchScore),
        reason: r.reasonText ?? "",
        reasonTerms: terms?.terms ?? [],
        reasonFromTemplate: terms?.guardrailFallback ?? true,
      };
    });
    const severity = c.severity === null ? null : Number(c.severity);
    S5 = {
      status: matches.every((m) => m.reasonFromTemplate) ? "degraded" : "done",
      result: {
        version: "1.0.0",
        gated,
        claimWindowEndsAt:
          routeRows[0]?.claimWindowEndsAt?.toISOString() ?? clockNow().toISOString(),
        matches,
      },
      decision: gated
        ? severity !== null && severity >= ROUTING.humanGateSeverity
          ? `Severity ${severity.toFixed(2)} is at or above ${ROUTING.humanGateSeverity}: nothing has been notified. Waiting for the District Collector at /gov/gate.`
          : `A shortlist of ${matches.length} was computed but nothing was sent: this report is still held for a human at /admin/triage.`
        : `Offered to ${matches.length} institutions. Claim window ${ROUTING.claimWindowDays} days.`,
      meta: metaOf(s5),
      at: routeRows[0]?.createdAt.toISOString() ?? null,
    };
  } else if (halted && c.status === "MERGED") {
    S5 = { status: "skipped", note: haltedNote("MERGED", row.parentTrackingId) };
  }

  /* Halted reports skip everything downstream of the halting stage. */
  if (c.status === "REJECTED_UNSAFE" || c.status === "FORWARDED_EXTERNAL") {
    if (S2.status === "waiting") S2 = { status: "skipped", note: haltedNote(c.status, null) };
    if (S3.status === "waiting") S3 = { status: "skipped", note: haltedNote(c.status, null) };
    if (S4.status === "waiting") S4 = { status: "skipped", note: haltedNote(c.status, null) };
    if (S5.status === "waiting") S5 = { status: "skipped", note: haltedNote(c.status, null) };
  }
  if (c.status === "MERGED") {
    if (S4.status === "waiting") S4 = { status: "skipped", note: haltedNote("MERGED", row.parentTrackingId) };
    if (S5.status === "waiting") S5 = { status: "skipped", note: haltedNote("MERGED", row.parentTrackingId) };
    S3 = {
      status: "done",
      result: {
        comparisons: [],
        merged: {
          into: row.parentTrackingId ?? "the survivor report",
          similarity: null,
          count: null,
        },
      },
      decision:
        `Merged into ${row.parentTrackingId ?? "the survivor report"}. Both reporters are credited; ` +
        `the survivor carries the corroboration count. The comparison detail streams on the live trace.`,
      meta: null,
    };
  }

  const stages: Record<TraceStageKey, TraceStage> = { P0, S1, S2, S3, S4, S5 };
  const complete = TRACE_KEY_ORDER.every((k) => stages[k].status !== "waiting");

  return { stages, complete, status: c.status };
}

function haltedNote(status: string, parentTrackingId: string | null): string {
  switch (status) {
    case "REJECTED_UNSAFE":
      return "Stopped at S1: the report was rejected as unsafe.";
    case "FORWARDED_EXTERNAL":
      return "Stopped at S1: forwarded to the grievance system that owns it.";
    case "MERGED":
      return `Stopped at S3: merged into ${parentTrackingId ?? "the survivor report"}.`;
    default:
      return "Stopped earlier in the pipeline.";
  }
}
