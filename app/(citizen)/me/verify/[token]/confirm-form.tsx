"use client";

import { useActionState } from "react";

import { confirmImpact, type ConfirmState } from "./actions";

/**
 * Three buttons and a box.
 *
 * This is read on a cheap Android phone in daylight by someone who may not read
 * English. The buttons are large, the words are plain, and the consequence of
 * each answer is written beside it — nobody should have to guess what "partly"
 * will do to a number they cannot see.
 */
export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ConfirmState | null, FormData>(confirmImpact, null);

  if (state?.ok) {
    return (
      <div
        role="status"
        className={`rounded-lg border p-5 ${state.answer === "NO" ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}
      >
        <p className="text-lg font-bold">Recorded.</p>
        <p className="mt-2 text-sm">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="block text-sm font-medium" htmlFor="note">
          Anything you want to add (optional)
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          className="mt-1 w-full rounded-md border border-input bg-background p-3 text-base"
          placeholder="e.g. The sensor was installed but the alert siren has not been connected."
        />
      </div>

      <div className="space-y-3">
        <button
          name="answer"
          value="YES"
          disabled={pending}
          className="flex w-full flex-col items-start rounded-lg bg-emerald-700 px-5 py-4 text-left text-white disabled:opacity-50"
        >
          <span className="text-lg font-bold">Yes, it&rsquo;s fixed</span>
          <span className="mt-1 text-sm text-emerald-50">
            This is the only thing that counts as an outcome anywhere in Milan.
          </span>
        </button>

        <button
          name="answer"
          value="PARTLY"
          disabled={pending}
          className="flex w-full flex-col items-start rounded-lg border-2 border-amber-500 bg-amber-50 px-5 py-4 text-left disabled:opacity-50"
        >
          <span className="text-lg font-bold text-amber-900">Partly</span>
          <span className="mt-1 text-sm text-amber-900">
            Counted on its own, separately. It will never be shown as a full fix.
          </span>
        </button>

        <button
          name="answer"
          value="NO"
          disabled={pending}
          className="flex w-full flex-col items-start rounded-lg border-2 border-red-400 bg-white px-5 py-4 text-left disabled:opacity-50"
        >
          <span className="text-lg font-bold text-red-800">No, nothing changed</span>
          <span className="mt-1 text-sm text-red-800">
            The claim is marked disputed, the District Collector is told, and nothing is counted.
          </span>
        </button>
      </div>

      {pending ? <p className="text-sm text-muted-foreground">Recording your answer…</p> : null}
      {state && !state.ok ? (
        <p className="text-sm text-red-700" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
