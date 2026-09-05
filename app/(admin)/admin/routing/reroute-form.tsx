"use client";

/**
 * The routing override control.
 *
 * The reason box is mandatory and the button stays disabled without it. Milan's
 * claim is that every human override is logged with a written reason and
 * becomes labelled training data; that has to be true of the interface, not
 * only of the table it writes to.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rerouteAction } from "./actions";

const MIN_REASON = 15;

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function RerouteForm({
  challengeId,
  trackingId,
  capabilities,
}: {
  challengeId: string;
  trackingId: string;
  capabilities: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [capabilityId, setCapabilityId] = useState(capabilities[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [pending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= MIN_REASON;

  function submit() {
    startTransition(async () => {
      const result = await rerouteAction({
        challengeId,
        capabilityId,
        reason: reason.trim(),
        replaceExisting,
      });
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
        setReason("");
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Re-route {trackingId}
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border p-3">
      <div className="space-y-1">
        <Label htmlFor={`org-${challengeId}`}>Send it to</Label>
        <select
          id={`org-${challengeId}`}
          className={selectClass}
          value={capabilityId}
          onChange={(e) => setCapabilityId(e.target.value)}
        >
          {capabilities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-2">
        <input
          id={`replace-${challengeId}`}
          type="checkbox"
          className="mt-1 size-5"
          checked={replaceExisting}
          onChange={(e) => setReplaceExisting(e.target.checked)}
        />
        <Label htmlFor={`replace-${challengeId}`} className="text-sm font-normal leading-snug">
          Expire the automatic shortlist
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Leave it unticked to add this institution alongside the existing three.
          </span>
        </Label>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`reason-${challengeId}`}>
          Why? (required — this becomes labelled training data)
        </Label>
        <Textarea
          id={`reason-${challengeId}`}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. The match scored on the word 'water' but this is a structural failure — it belongs with a geotechnical lab."
        />
        <p className="text-xs text-muted-foreground">
          {reason.trim().length}/{MIN_REASON} characters minimum.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!reasonOk || pending || !capabilityId} onClick={submit}>
          {pending ? "Re-routing…" : "Confirm re-route"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
