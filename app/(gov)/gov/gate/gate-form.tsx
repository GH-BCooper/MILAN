"use client";

import { useActionState } from "react";

import { decideGate, type GateResult } from "./actions";

/**
 * Confirm, override, reject. The reason box is always visible rather than
 * revealed by choosing "override": an officer should be able to write down why
 * they agreed as easily as why they did not.
 */
export function GateForm({ trackingId, severity }: { trackingId: string; severity: number | null }) {
  const [state, action, pending] = useActionState<GateResult | null, FormData>(decideGate, null);

  return (
    <form action={action} className="mt-4 space-y-3 border-t border-border pt-4">
      <input type="hidden" name="trackingId" value={trackingId} />

      <label className="block text-xs font-medium" htmlFor={`reason-${trackingId}`}>
        Reason — required for an override or a rejection, and it becomes labelled training data
      </label>
      <textarea
        id={`reason-${trackingId}`}
        name="reason"
        rows={2}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        placeholder="e.g. The embankment is on the irrigation department's 2025 repair list; severity is right but this is capital works, not research."
      />

      <label className="block text-xs font-medium" htmlFor={`sev-${trackingId}`}>
        Corrected severity (override only) — the model proposed {severity === null ? "no value" : severity.toFixed(2)}
      </label>
      <input
        id={`sev-${trackingId}`}
        name="severity"
        type="number"
        step="0.01"
        min="0"
        max="1"
        defaultValue={severity ?? undefined}
        className="h-11 w-32 rounded-md border border-input bg-background px-3 text-sm"
      />

      <div className="flex flex-wrap gap-2">
        <button
          name="decision"
          value="CONFIRM"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Confirm and release to the institutions
        </button>
        <button
          name="decision"
          value="OVERRIDE"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50"
        >
          Override the score
        </button>
        <button
          name="decision"
          value="REJECT"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
        >
          Not a research challenge — park it
        </button>
      </div>

      {state ? (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
      {pending ? <p className="text-sm text-muted-foreground">Working…</p> : null}
    </form>
  );
}
