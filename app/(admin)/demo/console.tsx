"use client";

/**
 * The judge console.
 *
 * Designed for a laptop mirrored to a projector: large targets, high contrast,
 * one column of controls and one column of consequences. Every button reports
 * what it did, and the ladder log is the point of the whole page — a judge
 * should watch the escalation happen, not be told it happened.
 */
import { useActionState } from "react";

import { advanceAndReap, reapNow, resetClockAction, resetDemoState, runScenario, type DemoResult } from "./actions";

function Log({ result }: { result: DemoResult | null }) {
  if (!result) return null;
  return (
    <div
      role="status"
      className={`mt-3 rounded-lg border p-4 ${result.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
    >
      <p className="text-sm font-bold">
        {result.title}
        {result.ms !== undefined ? <span className="ms-2 font-mono text-xs font-normal">{result.ms} ms</span> : null}
      </p>
      <p className="mt-1 text-sm">{result.message}</p>

      {result.fired && result.fired.length > 0 ? (
        <ol className="mt-3 space-y-1">
          {result.fired.map((f) => (
            <li key={f.deadlineId} className="rounded border border-black/10 bg-white/70 px-3 py-2 text-xs">
              <span className="font-mono font-bold">{f.kind}</span>{" "}
              <span className="font-semibold">{f.trackingId}</span>{" "}
              <span className="text-muted-foreground">
                {f.fromStatus} → {f.toStatus}
              </span>
              <span className="block text-muted-foreground">{f.summary}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {result.fired && result.fired.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No deadline was due. Nothing fired, and nothing pretended to.
        </p>
      ) : null}
    </div>
  );
}

export function ClockPanel() {
  const [state, action, pending] = useActionState<DemoResult | null, FormData>(advanceAndReap, null);
  const [reset, resetAction, resetting] = useActionState<DemoResult | null, FormData>(async () => resetClockAction(), null);
  const [reap, reapAction, reaping] = useActionState<DemoResult | null, FormData>(async () => reapNow(), null);

  return (
    <section className="rounded-lg border-2 border-border p-5">
      <h2 className="text-xl font-bold">Clock fast-forward</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each button moves the demo clock and runs the SLA reaper immediately, then lists every ladder
        action that fired. This is the counterfactual: a challenge nobody claimed does not sit there,
        it escalates in public.
      </p>

      <form action={action} className="mt-4 flex flex-wrap gap-2">
        {[7, 14, 21, 45].map((d) => (
          <button
            key={d}
            name="days"
            value={d}
            disabled={pending}
            className="h-14 min-w-[6rem] rounded-lg bg-primary px-6 text-lg font-bold text-primary-foreground disabled:opacity-50"
          >
            +{d} days
          </button>
        ))}
      </form>

      <div className="mt-2 flex flex-wrap gap-2">
        <form action={reapAction}>
          <button disabled={reaping} className="h-11 rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50">
            Run the reaper without moving the clock
          </button>
        </form>
        <form action={resetAction}>
          <button disabled={resetting} className="h-11 rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50">
            Reset the clock to real time
          </button>
        </form>
      </div>

      {pending || reaping || resetting ? <p className="mt-3 text-sm text-muted-foreground">Working…</p> : null}
      <Log result={state} />
      <Log result={reap} />
      <Log result={reset} />
    </section>
  );
}

export function ScenarioPanel() {
  const [state, action, pending] = useActionState<DemoResult | null, FormData>(runScenario, null);

  const BEATS: Array<[string, string, string]> = [
    ["pipeline", "Run the pipeline", "P0 to S5 on the hero challenge. Every stage writes an ai_runs receipt."],
    ["gate", "DC confirms the gate", "Releases the held shortlist and notifies the three institutions."],
    ["claim", "HOD claims it", "Forms the team, credits the citizen as Domain Informant, decrements capacity."],
    ["publish", "Publish the artifact", "CC-BY, hashed into the ledger, prior art from that second."],
    ["implement", "Mark implemented", "A claim, not an outcome. Sends the citizen an SMS."],
    ["confirm", "Citizen confirms", "The only thing in Milan that moves the impact counter."],
  ];

  return (
    <section className="rounded-lg border-2 border-border p-5">
      <h2 className="text-xl font-bold">Scenario shortcuts</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One click each, idempotent, in script order. Pressing one twice tells you it is already done
        rather than doing it twice.
      </p>
      <form action={action} className="mt-4 grid gap-2 sm:grid-cols-2">
        {BEATS.map(([beat, label, blurb]) => (
          <button
            key={beat}
            name="beat"
            value={beat}
            disabled={pending}
            className="flex flex-col items-start rounded-lg border border-input p-4 text-left transition hover:border-primary disabled:opacity-50"
          >
            <span className="text-base font-bold">{label}</span>
            <span className="mt-1 text-xs text-muted-foreground">{blurb}</span>
          </button>
        ))}
      </form>
      {pending ? <p className="mt-3 text-sm text-muted-foreground">Working…</p> : null}
      <Log result={state} />
    </section>
  );
}

export function ResetPanel() {
  const [state, action, pending] = useActionState<DemoResult | null, FormData>(async () => resetDemoState(), null);

  return (
    <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
      <h2 className="text-xl font-bold text-amber-900">Reset the demo state</h2>
      <p className="mt-1 text-sm text-amber-900">
        Puts the clock back to zero, clears every escalation flag and re-opens an SLA deadline on every
        non-terminal challenge. The ledger is deliberately untouched: it is append-only, and a reset
        that erased it would be exactly the thing we say cannot happen.
      </p>
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm("Reset the demo state? The clock, escalation flags and SLA deadlines are restored. The ledger is not touched.")) {
            e.preventDefault();
          }
        }}
        className="mt-4"
      >
        <button
          disabled={pending}
          className="h-12 rounded-lg bg-amber-600 px-6 text-base font-bold text-white disabled:opacity-50"
        >
          {pending ? "Resetting…" : "Reset"}
        </button>
      </form>
      <Log result={state} />
    </section>
  );
}
