"use client";

/**
 * The live pipeline trace.
 *
 * Six stage cards. Each ticks over as its SSE event arrives, and each carries a
 * footer with provider, model, confidence, fallback level and latency — the
 * receipt for what actually ran. A degraded stage renders amber and reads
 * "fallback: rules", never red and never as an error: being visibly honest
 * about degradation is stronger than pretending it never happens.
 *
 * S4's card expands into the full priority breakdown. S5's lists the three
 * matched institutions with their written reasons.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, MinusCircle, Play, RotateCcw } from "lucide-react";

import { PriorityBreakdown, parseBreakdown } from "@/components/priority-breakdown";
import { Button } from "@/components/ui/button";

type StageKey = "P0" | "S1" | "S2" | "S3" | "S4" | "S5";
type StageStatus = "waiting" | "running" | "done" | "degraded" | "skipped";

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
  at?: string;
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

export function PipelineTrace({
  trackingId,
  districtCode,
  autoStart = false,
  replay = false,
  heading = "What Milan did with your report",
}: {
  trackingId: string;
  districtCode: string | null;
  autoStart?: boolean;
  replay?: boolean;
  heading?: string;
}) {
  const [stages, setStages] = useState<Record<StageKey, StageState>>(() => blank());
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<{ status: string; totalMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useCallback(() => {
    sourceRef.current?.close();
    setStages(blank());
    setFinished(null);
    setError(null);
    setRunning(true);

    const url = `/api/pipeline/stream?trackingId=${encodeURIComponent(trackingId)}${replay ? "&replay=1" : ""}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (message) => {
      let event: unknown;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (typeof event !== "object" || event === null) return;
      const e = event as Record<string, unknown>;

      if (e.type === "stage") {
        const key = e.stage as StageKey;
        setStages((prev) => ({
          ...prev,
          [key]: {
            status: e.status as StageStatus,
            result: e.result,
            rationale: (e.rationale as string | null) ?? null,
            decision: (e.decision as string | null) ?? null,
            note: (e.note as string | null) ?? null,
            meta: (e.meta as StageMeta | null) ?? null,
            at: e.at as string,
          },
        }));
      } else if (e.type === "done") {
        setFinished({ status: String(e.status), totalMs: Number(e.totalMs) });
        setRunning(false);
        source.close();
      } else if (e.type === "error") {
        setError(String(e.message));
        setRunning(false);
        source.close();
      }
    };

    // EventSource retries on its own by default, which would silently re-run the
    // pipeline. We close instead and let the person press the button again.
    source.onerror = () => {
      source.close();
      setRunning(false);
      setError((prev) => prev ?? "The connection dropped. Nothing was lost — press replay to continue.");
    };
  }, [trackingId, replay]);

  useEffect(() => {
    if (autoStart) start();
    return () => sourceRef.current?.close();
  }, [autoStart, start]);

  return (
    <section aria-labelledby="trace-heading" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="trace-heading" className="text-lg font-semibold">
            {heading}
          </h2>
          <p className="text-sm text-muted-foreground">
            Every step below is a real run, recorded with the model that answered and how long it
            took.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={start} disabled={running}>
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> Running
            </>
          ) : finished || error ? (
            <>
              <RotateCcw className="size-4" aria-hidden /> Replay pipeline
            </>
          ) : (
            <>
              <Play className="size-4" aria-hidden /> Run pipeline
            </>
          )}
        </Button>
      </div>

      {error ? (
        <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      <ol className="mt-4 space-y-3" aria-live="polite">
        {STAGES.map((stage) => {
          const state = stages[stage.key];
          return (
            <li key={stage.key}>
              <StageCard
                stageKey={stage.key}
                title={stage.title}
                blurb={stage.blurb}
                state={state}
                trackingId={trackingId}
                districtCode={districtCode}
              />
            </li>
          );
        })}
      </ol>

      {finished ? (
        <p className="mt-4 rounded-md border border-border bg-muted p-3 text-sm">
          Finished in <strong className="tabular-nums">{(finished.totalMs / 1000).toFixed(1)}s</strong>.
          The report is now <strong>{finished.status.replaceAll("_", " ").toLowerCase()}</strong>.
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
  const border = degraded
    ? "border-amber-300 bg-amber-50/40"
    : state.status === "done"
      ? "border-emerald-300"
      : "border-border";

  return (
    <div className={`rounded-lg border p-4 ${border}`}>
      <div className="flex items-start gap-3">
        <StatusIcon status={state.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{title}</h3>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {stageKey}
            </span>
            {degraded ? (
              <span className="rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
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

          {state.decision ? <p className="mt-2 text-sm font-medium">{state.decision}</p> : null}
          {state.rationale ? (
            <p className="mt-1 text-sm italic text-muted-foreground">&ldquo;{state.rationale}&rdquo;</p>
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
      return <Check className={`${base} text-emerald-700`} aria-label="Done" />;
    case "degraded":
      return <AlertTriangle className={`${base} text-amber-600`} aria-label="Degraded to the rule fallback" />;
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
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
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

function blank(): Record<StageKey, StageState> {
  return {
    P0: { status: "waiting" },
    S1: { status: "waiting" },
    S2: { status: "waiting" },
    S3: { status: "waiting" },
    S4: { status: "waiting" },
    S5: { status: "waiting" },
  };
}
