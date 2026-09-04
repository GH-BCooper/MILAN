"use client";

import { useState } from "react";
import { Users } from "lucide-react";

import { corroborateAction } from "@/app/(public)/c/[trackingId]/actions";
import { Button } from "@/components/ui/button";

export function CorroborateButton({
  trackingId,
  signedIn,
}: {
  trackingId: string;
  signedIn: boolean;
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
