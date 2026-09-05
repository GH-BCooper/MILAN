"use client";

import { useActionState } from "react";

import { expressInterest, type InterestState } from "./actions";

export function InterestForm({ trackingId }: { trackingId: string }) {
  const [state, action, pending] = useActionState<InterestState | null, FormData>(expressInterest, null);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="trackingId" value={trackingId} />
      <label className="block text-xs font-medium" htmlFor="message">
        What would you like to do with this? The project team and the institution both see this message.
      </label>
      <textarea
        id="message"
        name="message"
        rows={4}
        required
        minLength={20}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        placeholder="e.g. We would fund a three-site pilot in FY27 under our CSR programme and cover the sensor hardware and one year of maintenance."
      />
      <button
        disabled={pending}
        className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Sending…" : "Express interest"}
      </button>
      {state ? (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
