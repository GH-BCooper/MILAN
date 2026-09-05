"use client";

import { useActionState } from "react";

import { respondToInterest, type InterestState } from "@/app/(industry)/industry/challenges/[trackingId]/actions";

export function RespondForm({ interestId }: { interestId: string }) {
  const [state, action, pending] = useActionState<InterestState | null, FormData>(respondToInterest, null);

  return (
    <form action={action} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="interestId" value={interestId} />
      <label className="block text-xs font-medium" htmlFor="note">
        A note back (optional)
      </label>
      <textarea id="note" name="note" rows={3} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <button
          name="decision"
          value="ACCEPT"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Accept — add them to the credit chain as funder
        </button>
        <button
          name="decision"
          value="DECLINE"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {state ? (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
