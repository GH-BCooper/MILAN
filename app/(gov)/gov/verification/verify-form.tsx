"use client";

import { useActionState } from "react";

import { endorseChallenge, type VerifyResult } from "./actions";

export function VerifyForm({ trackingId, score }: { trackingId: string; score: number | null }) {
  const [state, action, pending] = useActionState<VerifyResult | null, FormData>(endorseChallenge, null);

  return (
    <form action={action} className="mt-3 space-y-2 border-t border-border pt-3">
      <input type="hidden" name="trackingId" value={trackingId} />

      <label className="block text-xs font-medium" htmlFor={`note-${trackingId}`}>
        What you saw on the ground — required, and it goes into the public ledger under your name
      </label>
      <textarea
        id={`note-${trackingId}`}
        name="note"
        rows={2}
        required
        minLength={10}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        placeholder="e.g. Visited 12 Aug. The fissure runs about 40 m along the eastern embankment and has widened since the July photos."
      />

      <label className="block text-xs font-medium" htmlFor={`photo-${trackingId}`}>
        Photo reference (optional) — a storage key or a file note
      </label>
      <input
        id={`photo-${trackingId}`}
        name="photoKey"
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
        placeholder="optional"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Mark verified in the field
        </button>
        <span className="text-xs text-muted-foreground">
          Priority now {score === null ? "unscored" : score.toFixed(3)} → expected{" "}
          {score === null ? "unscored" : (score + 0.06).toFixed(3)} once endorsed
        </span>
      </div>

      {state ? (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
