"use client";

import { useActionState } from "react";

import { requestAccessAction, type PublishState } from "@/app/(hei)/hei/projects/[id]/artifact-actions";

export function RequestAccessForm({ artifactId }: { artifactId: string }) {
  const [state, action, pending] = useActionState<PublishState | null, FormData>(requestAccessAction, null);

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="artifactId" value={artifactId} />
      <label className="block text-xs font-medium" htmlFor="purpose">
        What do you want to use it for? Your name, your organisation and this sentence are recorded and
        shown to the project team and to the citizen who reported the problem.
      </label>
      <textarea
        id="purpose"
        name="purpose"
        rows={3}
        required
        minLength={20}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        placeholder="e.g. Evaluating the sensor design for a pilot on three embankments in West Singhbhum under our FY27 CSR programme."
      />
      <button
        disabled={pending}
        className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Sending…" : "Request access"}
      </button>
      {state ? (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
