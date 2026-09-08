"use client";

import { useState } from "react";
import { Users } from "lucide-react";

import { corroborateAction } from "@/app/(public)/c/[trackingId]/actions";
import { Button } from "@/components/ui/button";

export function CorroborateButton({
  trackingId,
  signedIn,
  isOwnReport = false,
}: {
  trackingId: string;
  signedIn: boolean;
  /** True when the viewer is the account that filed this report. Corroboration
   *  credits a SECOND, independent person reporting the same problem — the
   *  original reporter confirming their own report is the same signal counted
   *  twice, so the control is hidden rather than offered and rejected. */
  isOwnReport?: boolean;
}) {
  const [state, setState] = useState<{ done: boolean; message: string | null }>({
    done: false,
    message: null,
  });
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    const result = await corroborateAction({ trackingId });
    setState(
      result.ok
        ? { done: true, message: `Thank you. ${result.count} people have now reported this.` }
        : { done: false, message: result.error },
    );
    setPending(false);
  }

  if (isOwnReport) {
    return (
      <p className="text-xs text-muted-foreground">
        This is your report. Corroboration is for someone else confirming that it happens to them
        too — it is one of the seven priority terms, so it cannot count your own voice twice.
      </p>
    );
  }

  return (
    <div>
      <Button type="button" onClick={confirm} disabled={pending || state.done} className="w-full">
        <Users aria-hidden className="size-4" />
        {state.done ? "Confirmed" : "This happens to me too"}
      </Button>
      {state.message ? (
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
          {state.message}
        </p>
      ) : null}
      {!signedIn ? (
        <p className="mt-2 text-xs text-muted-foreground">
          You can confirm without an account. A confirmation from a signed-in neighbour counts for
          more, because we can tell it is a different person.
        </p>
      ) : null}
    </div>
  );
}
