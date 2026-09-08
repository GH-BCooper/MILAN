"use client";

/**
 * The pipeline trace.
 *
 * Six stage cards that tick over as the pipeline's own receipts land. The
 * wiring is deliberately boring: the page asks POST /api/pipeline/run to
 * begin the work, then polls GET /api/pipeline/trace every two seconds and
 * displays whatever the trace projection — `ai_runs` rows, `routes` rows and
 * the challenge's own columns — can prove has happened. No socket, no
 * optimistic ticking: a card lights up when its row exists, not before.
 *
 * A pre-processed challenge (the demo walks seeds, not fresh submits, most of
 * the time) renders already complete from the first paint, each card carrying
 * the real receipt — provider, model, fallback level, latency. A stage that
 * fell back to the rules tier renders amber and reads "fallback: rules",
 * never red, never an error.
 *
 * The staggered reveal stays: even when the poller returns with several
 * stages done at once, the cards turn over in order, a beat apart, so the eye
 * follows the pipeline's logic rather than a wall of green.
 *
 * If the run is still going when the poll budget runs out, the page stops
 * spinning and says so — "processing continues in the background; your
 * tracking ID works already." Nothing here is a promise the database didn't
 * write down first.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, MinusCircle, Play, RotateCcw } from "lucide-react";

import { PriorityBreakdown } from "@/components/priority-breakdown";
import { parseBreakdown } from "@/packages/scoring";
import { Button } from "@/components/ui/button";

type StageKey = "P0" | "S1" | "S2" | "S3" | "S4" | "S5";
type StageStatus = "waiting" | "running" | "done" | "degraded" | "skipped";

const STAGE_ORDER: readonly StageKey[] = ["P0", "S1", "S2", "S3", "S4", "S5"];

const STAGES: Array<{ key: StageKey; title: string; blurb: string }> = [
  { key: "P0", title: "Language", blurb: "Translate into an English working copy. Your own words are kept." },
  { key: "S1", title: "Safety and triage", blurb: "Is it safe? Is it a complaint someone already owes an answer for?" },
  { key: "S2", title: "Domain and hazard", blurb: "What kind of problem, which NDMA hazard, how severe." },
  { key: "S3", title: "Duplicates", blurb: "Has anyone else reported this? Duplicates are joined, never discarded." },
  { key: "S4", title: "Priority score", blurb: "Seven weighted terms. No AI. Every number is shown." },
  { key: "S5", title: "Routing", blurb: "Matched to university departments, with a written reason." },
];

interface StageMeta {
  provider: string;
  model: string | null;
  fallbackLevel: number;
  confidence: number | null;
  latencyMs: number;
  cached: boolean;
}

interface StageState {
  status: StageStatus;
  result?: unknown;
  rationale?: string | null;
  decision?: string | null;
  note?: string | null;
  meta?: StageMeta | null;
  at?: string | null;
}

interface TraceProjection {
  stages: Record<StageKey, Omit<StageState, "status"> & { status: StageStatus }>;
  complete: boolean;
  status: string;
}

interface Match {
  rank: number;
  institution: string;
  department: string;
  lab: string | null;
  matchScore: number;
  reason: string;
  reasonTerms: Array<{ label: string; detail: string; contribution: number }>;
  reasonFromTemplate: boolean;
}

/** Every 2 s, for ninety seconds; then the honest background message. */
const POLL_MS = 2000;
const MAX_TICKS = 45;

export function PipelineTrace({
  trackingId,
  districtCode,
  autoStart = false,
  replay = false,
  heading = "What Milan did with your report",
  initial,
}: {
  trackingId: string;
  districtCode: string | null;
  autoStart?: boolean;
  replay?: boolean;
  heading?: string;
  /** Server-rendered first read — a pre-processed challenge never spins. */
  initial?: TraceProjection | undefined;
}) {
  const assured: TraceProjection = initial ?? {
    stages: {
      P0: { status: "waiting" },
      S1: { status: "waiting" },
      S2: { status: "waiting" },
      S3: { status: "waiting" },
      S4: { status: "waiting" },
      S5: { status: "waiting" },
    },
    complete: false,
    status: "unknown",
  };
  /* What the projection says, and what the eye has been shown so far. The two
   * differ deliberately during the staggered reveal. */
  const [latest, setLatest] = useState<TraceProjection>(assured);
  const [shown, setShown] = useState<Record<StageKey, StageState>>(() =>
    autoStart ? blankShownFrom(assured.stages) : materialise(assured.stages),
  );
  const [phase, setPhase] = useState<"idle" | "running" | "capped" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const ticksRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Promote stages from `latest` into `shown`, in pipeline order, a beat
   * apart — the staggered reveal. A stage is promoted when the projection
   * says it settled (or the projection moved past it while cards were still
   * behind). */
  useEffect(() => {
    const timer = setInterval(() => {
      setShown((current) => {
        for (const key of STAGE_ORDER) {
          const target = latest.stages[key];
          const mine = current[key];
          const targetSettled = target.status !== "waiting";
          const behind =
            targetSettled &&
            (mine.status === "waiting" ||
              mine.status === "running" ||
              // A newer run replaced the receipt (replay).
              (target.at !== undefined && mine.at !== target.at));
          if (behind) {
            return { ...current, [key]: { ...target } };
          }
          /* The first still-waiting stage after settled ones reads as
           * "running" while a run is in flight — the pipeline works in
           * order, and that is the card that is on the clock. */
          if (phase === "running" && mine.status === "waiting") {
            return { ...current, [key]: { ...mine, status: "running" } };
          }
          return current;
        }
        return current;
      });
    }, 450);
    return () => clearInterval(timer);
  }, [latest, phase]);

  /* One trace fetch. Pulled out of the interval so it can also run immediately
   * when polling starts — the backend pipeline can finish inside a second
   * (rules-tier fallbacks are near-instant), and waiting a full POLL_MS for
   * the first look would show a static "waiting" screen for work that is
   * already done. */
  const tick = useCallback(async () => {
    ticksRef.current += 1;
    try {
      const res = await fetch(
        `/api/pipeline/trace?trackingId=${encodeURIComponent(trackingId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const projection = (await res.json()) as TraceProjection;
        setLatest(projection);
        if (projection.complete) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase("idle");
          return;
        }
      } else if (res.status === 403) {
        /* Mid-run past the fresh window, seen by a stranger: keep the last
         * honest frame and stop. The public page has the full story. */
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setPhase("idle");
        return;
      }
    } catch {
      /* A dropped poll is weather, not failure — the next tick retries. */
    }
    if (ticksRef.current >= MAX_TICKS && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setLatest((current) => {
        if (!current.complete) setPhase("capped");
        else setPhase("idle");
        return current;
      });
    }
  }, [trackingId]);

  const poll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    ticksRef.current = 0;
    void tick();
    pollRef.current = setInterval(() => void tick(), POLL_MS);
  }, [tick]);

  const start = useCallback(
    async (isReplay: boolean) => {
      setError(null);
      setPhase("running");
      try {
        const res = await fetch(
          `/api/pipeline/run?trackingId=${encodeURIComponent(trackingId)}${isReplay ? "&replay=1" : ""}`,
          { method: "POST" },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setPhase("idle");
          setError(body.error ?? "The run could not be started.");
          return;
        }
      } catch {
        setPhase("idle");
        setError("The request did not reach the server. Nothing was lost — press again to retry.");
        return;
      }
      poll();
    },
    [trackingId, poll],
  );

  useEffect(() => {
    if (autoStart && !assured.complete) {
      void start(false);
    } else if (autoStart) {
      /* Pre-processed: render complete immediately (already the shown state
       * via materialise), no fake spinner, no run. */
      setPhase("idle");
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settled = latest.complete;

  return (
    <section aria-labelledby="trace-heading" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="trace-heading" className="text-lg font-semibold milan-gradient-text">
            {heading}
          </h2>
          <p className="text-sm text-muted-foreground">
            Every step below is a real run, recorded with the model that answered and how long it
            took.
          </p>
        </div>
        {replay || phase === "running" || phase === "capped" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void start(true)}
            disabled={phase === "running"}
          >
            {phase === "running" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> Running
              </>
            ) : (
              <>
                <RotateCcw className="size-4" aria-hidden /> Replay pipeline
              </>
            )}
          </Button>
        ) : !settled && phase === "idle" && !autoStart ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void start(false)}>
            <Play className="size-4" aria-hidden /> Run pipeline
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="status" className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/15 p-3 text-sm text-amber-200">
          {error}
        </p>
      ) : null}

      {phase === "capped" ? (
        <p role="status" className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
          Processing continues in the background — your tracking ID works already. Come back to this
          page in a little while: every stage shown here appears as its receipt lands.
        </p>
      ) : null}

      <ol className="mt-4 space-y-3" aria-live="polite">
        {STAGES.map((stage) => (
          <li key={stage.key}>
            <StageCard
              stageKey={stage.key}
              title={stage.title}
              blurb={stage.blurb}
              state={shown[stage.key]}
              trackingId={trackingId}
              districtCode={districtCode}
            />
          </li>
        ))}
      </ol>

      {settled ? (
        <p className="milan-glass mt-4 rounded-xl p-3 text-sm">
          This pipeline has finished. The report is{" "}
          <strong>{latest.status.replaceAll("_", " ").toLowerCase()}</strong>.
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- stage card */

function StageCard({
  stageKey,
  title,
  blurb,
  state,
  trackingId,
  districtCode,
}: {
  stageKey: StageKey;
  title: string;
  blurb: string;
  state: StageState;
  trackingId: string;
  districtCode: string | null;
}) {
  const degraded = state.status === "degraded";
  /* Colour is a second signal only — every card also carries its status icon
     and, when degraded, the words "fallback: rules". */
  const skin = degraded
    ? "border-amber-400/50 bg-amber-500/10 shadow-[0_0_34px_-16px_rgba(251,191,36,0.9)]"
    : state.status === "done"
      ? "border-emerald-400/45 bg-emerald-500/[0.07] shadow-[0_0_34px_-16px_rgba(16,217,160,0.9)]"
      : state.status === "running"
        ? "border-[var(--grad-2)] bg-foreground/5 shadow-[0_0_44px_-18px_rgba(79,140,255,0.95)]"
        : "border-border bg-foreground/[0.03]";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-4 backdrop-blur-md transition-all ${skin}`}
    >
      {/* the running stage gets a live gradient rail down its leading edge */}
      <span
        aria-hidden
        className={`absolute inset-y-0 start-0 w-[3px] ${
          state.status === "waiting" ? "opacity-25" : "opacity-100"
        } bg-gradient-to-b from-[var(--grad-1)] via-[var(--grad-2)] to-[var(--grad-3)]`}
      />
      <div className="flex items-start gap-3">
        <StatusIcon status={state.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold tracking-tight">{title}</h3>
            <span className="rounded-full border border-[var(--grad-1)]/40 bg-foreground/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest milan-gradient-text">
              {stageKey}
            </span>
            {degraded ? (
              <span className="rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                fallback: rules
              </span>
            ) : null}
            {state.meta?.cached ? (
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                cached
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{blurb}</p>

          {state.decision ? <p className="mt-2 text-sm font-semibold text-foreground">{state.decision}</p> : null}
          {state.rationale ? (
            <p className="mt-2 rounded-lg border-s-2 border-[var(--grad-3)] bg-foreground/[0.04] px-3 py-2 text-sm italic text-[#cfe9ff]">&ldquo;{state.rationale}&rdquo;</p>
          ) : null}
          {state.note && !state.decision ? (
            <p className="mt-2 text-sm text-muted-foreground">{state.note}</p>
          ) : null}

          {stageKey === "S4" && state.result ? (
            <div className="mt-3">
              <S4Panel result={state.result} trackingId={trackingId} districtCode={districtCode} />
            </div>
          ) : null}

          {stageKey === "S5" && state.result ? (
            <div className="mt-3">
              <S5Panel result={state.result} />
            </div>
          ) : null}

          {stageKey === "S3" && state.result ? (
            <div className="mt-3">
              <S3Panel result={state.result} />
            </div>
          ) : null}

          {state.meta ? (
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span>provider {state.meta.provider}</span>
              <span>model {state.meta.model ?? "—"}</span>
              <span>
                confidence {state.meta.confidence === null ? "—" : state.meta.confidence.toFixed(2)}
              </span>
              <span>fallback level {state.meta.fallbackLevel}</span>
              <span>{state.meta.latencyMs}ms</span>
            </p>
          ) : stageKey === "S4" && state.status === "done" ? (
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">
              deterministic — no model call, no provider, nothing to fall back to
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: StageStatus }) {
  const base = "mt-0.5 size-5 shrink-0";
  switch (status) {
    case "running":
      return <Loader2 className={`${base} animate-spin text-primary`} aria-label="Running" />;
    case "done":
      return <Check className={`${base} text-emerald-200`} aria-label="Done" />;
    case "degraded":
      return <AlertTriangle className={`${base} text-amber-300`} aria-label="Degraded to the rule fallback" />;
    case "skipped":
      return <MinusCircle className={`${base} text-muted-foreground`} aria-label="Skipped" />;
    default:
      return (
        <span
          className={`${base} rounded-full border-2 border-dashed border-border`}
          aria-label="Waiting"
        />
      );
  }
}

/* ---------------------------------------------------------------- panels */

function S4Panel({
  result,
  trackingId,
  districtCode,
}: {
  result: unknown;
  trackingId: string;
  districtCode: string | null;
}) {
  const score = parseBreakdown(result);
  if (!score) return null;
  return <PriorityBreakdown score={score} trackingId={trackingId} districtCode={districtCode} />;
}

function S5Panel({ result }: { result: unknown }) {
  const data = result as { gated?: boolean; matches?: Match[]; claimWindowEndsAt?: string };
  const matches = data.matches ?? [];
  if (matches.length === 0) return null;

  return (
    <div className="space-y-2">
      {data.gated ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-500/15 p-3 text-sm text-amber-200">
          Severity is at or above 0.70, so nothing has been sent yet. A District Collector confirms
          or overrides this shortlist before any institution is contacted, and every override is
          recorded with a written reason.
        </p>
      ) : null}
      <ol className="space-y-2">
        {matches.map((match) => (
          <li key={match.rank} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                <span className="me-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  #{match.rank}
                </span>
                {match.institution} — {match.department}
                {match.lab ? <span className="text-muted-foreground"> · {match.lab}</span> : null}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                match {match.matchScore.toFixed(3)}
              </p>
            </div>
            <p className="mt-1 text-sm">{match.reason}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {match.reasonTerms.map((term) => (
                <li
                  key={term.label}
                  className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px]"
                >
                  {term.label} {term.contribution.toFixed(3)}
                </li>
              ))}
            </ul>
            {match.reasonFromTemplate ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Written from the template: the model&apos;s sentence was rejected or unavailable.
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function S3Panel({ result }: { result: unknown }) {
  const data = result as {
    comparisons?: Array<{ trackingId: string; similarity: number; band: string; verdict: string }>;
    merged?: { into: string; similarity: number; count: number } | null;
  };
  const comparisons = (data.comparisons ?? []).slice(0, 5);
  if (comparisons.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[24rem] text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pe-3 font-medium">Compared with</th>
            <th scope="col" className="py-1 pe-3 text-right font-medium">Cosine</th>
            <th scope="col" className="py-1 font-medium">Band</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((c) => (
            <tr key={c.trackingId} className="border-t border-border">
              <td className="py-1 pe-3 font-mono">{c.trackingId}</td>
              <td className="py-1 pe-3 text-right tabular-nums">{c.similarity.toFixed(3)}</td>
              <td className="py-1">{c.band.replaceAll("_", " ").toLowerCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* First paint for a challenge whose run is already proved by the receipts:
 * every settled stage renders settled from the very first frame, no spinner. */
function materialise(
  stages: TraceProjection["stages"],
): Record<StageKey, StageState> {
  const out = {} as Record<StageKey, StageState>;
  for (const key of STAGE_ORDER) out[key] = { ...stages[key] };
  return out;
}

/* A run that is about to start shows its receipts only as they land — but a
 * stage that was already settled before this run (say P0 on a replay of a
 * partially-complete challenge) stays settled rather than dimming to please
 * the animation. */
function blankShownFrom(
  stages: TraceProjection["stages"],
): Record<StageKey, StageState> {
  const out = {} as Record<StageKey, StageState>;
  for (const key of STAGE_ORDER) {
    const settled = stages[key].status !== "waiting";
    out[key] = settled ? { ...stages[key] } : { status: "waiting" };
  }
  return out;
}
