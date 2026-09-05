"use client";

import { useActionState } from "react";

import { setEmergency } from "./actions";

export function EmergencyForm({ on, hazard, hazards }: { on: boolean; hazard: string | null; hazards: string[] }) {
  const [state, action, pending] = useActionState<{ message: string } | null, FormData>(setEmergency, null);

  return (
    <form action={action} className="mt-4 space-y-3">
      <label className="block text-xs font-medium" htmlFor="hazard">
        Hazard to pin the filter to
      </label>
      <select
        id="hazard"
        name="hazard"
        defaultValue={hazard ?? "FLOOD"}
        className="h-11 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
      >
        {hazards
          .filter((h) => h !== "NONE")
          .map((h) => (
            <option key={h} value={h}>
              {h.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
      </select>

      <div className="flex flex-wrap gap-2">
        <button
          name="on"
          value="on"
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {on ? "Re-pin the filter" : "Turn the emergency filter on"}
        </button>
        <button
          name="on"
          value="off"
          disabled={pending || !on}
          className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50"
        >
          Turn it off
        </button>
      </div>

      {state ? (
        <p className="text-sm text-emerald-700" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
