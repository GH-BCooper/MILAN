"use client";

/**
 * One item in the human queue.
 *
 * Shows the citizen's own words, the AI's proposal, the confidence that put it
 * here, and accept/override controls. The reason box is mandatory on both
 * paths — the button stays disabled until it is filled — because "every
 * override is logged with a written reason" has to be true of the UI and not
 * only of the database.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DOMAINS, HAZARDS } from "@/lib/ai/schemas";
import { resolveTriageAction } from "./actions";

const MIN_REASON = 12;

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export interface TriageCardProps {
  challengeId: string;
  trackingId: string;
  title: string;
  bodyOriginal: string;
  bodyLang: string;
  bodyEn: string | null;
  status: string;
  where: string;
  stage: string;
  provider: string | null;
  model: string | null;
  fallbackLevel: number;
  confidence: number | null;
  floor: number;
  inputHash: string | null;
  proposal: Record<string, unknown> | null;
}

export function TriageCard(props: TriageCardProps) {
  const [mode, setMode] = useState<"none" | "accept" | "override">("none");
  const [reason, setReason] = useState("");
  const [domain, setDomain] = useState<string>(String(props.proposal?.domain ?? ""));
  const [hazard, setHazard] = useState<string>(String(props.proposal?.hazard ?? ""));
  const [severity, setSeverity] = useState<string>(String(props.proposal?.severity ?? ""));
  const [isGrievance, setIsGrievance] = useState<boolean>(Boolean(props.proposal?.is_grievance));
  const [pending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= MIN_REASON;

  function submit(decision: "ACCEPT" | "OVERRIDE") {
    startTransition(async () => {
      const result = await resolveTriageAction(
        decision === "ACCEPT"
          ? {
              decision,
              challengeId: props.challengeId,
              stage: props.stage,
              inputHash: props.inputHash,
              reason: reason.trim(),
            }
          : {
              decision,
              challengeId: props.challengeId,
              stage: props.stage,
              inputHash: props.inputHash,
              reason: reason.trim(),
              domain: domain || null,
              hazard: hazard || null,
              severity: severity === "" ? null : Number(severity),
              isGrievance,
              isUnsafe: false,
            },
      );
      if (result.ok) {
        toast.success(result.message);
        setMode("none");
        setReason("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-sm font-semibold">{props.trackingId}</p>
        <p className="text-xs text-muted-foreground">
          {props.where} · {props.status.replaceAll("_", " ").toLowerCase()}
        </p>
      </div>
      <h3 className="mt-1 font-medium">{props.title}</h3>

      {/* Invariant 6, applied here too: the citizen's own words at full size,
          beside the working copy, even on an internal screen. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-border p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">As reported</p>
          <p lang={props.bodyLang} className="mt-1 whitespace-pre-wrap text-sm">
            {props.bodyOriginal}
          </p>
        </div>
        <div className="rounded border border-border p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">English working copy</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">
            {props.bodyEn ?? <span className="text-muted-foreground">Not translated yet.</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-900">
          {props.stage} confidence {props.confidence?.toFixed(2) ?? "—"}, below the {props.floor}{" "}
          floor. Nothing has been decided automatically.
        </p>
        <pre className="mt-2 overflow-x-auto text-xs text-amber-950">
          {JSON.stringify(props.proposal, null, 2)}
        </pre>
        <p className="mt-2 font-mono text-[11px] text-amber-900">
          {props.provider} · {props.model ?? "—"} · fallback level {props.fallbackLevel}
        </p>
      </div>

      {mode === "none" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setMode("accept")}>
            Accept the proposal
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("override")}>
            Override it
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 rounded-md border border-border p-3">
          {mode === "override" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`domain-${props.challengeId}`}>Domain</Label>
                <select
                  id={`domain-${props.challengeId}`}
                  className={selectClass}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  <option value="">Leave unchanged</option>
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`hazard-${props.challengeId}`}>NDMA hazard</Label>
                <select
                  id={`hazard-${props.challengeId}`}
                  className={selectClass}
                  value={hazard}
                  onChange={(e) => setHazard(e.target.value)}
                >
                  <option value="">Leave unchanged</option>
                  {HAZARDS.map((h) => (
                    <option key={h} value={h}>
                      {h.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`severity-${props.challengeId}`}>Severity (0–1)</Label>
                <input
                  id={`severity-${props.challengeId}`}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  className={selectClass}
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  0.70 and above sends this to a District Collector before it can route.
                </p>
              </div>
              <div className="flex items-start gap-2 pt-6">
                <input
                  id={`grievance-${props.challengeId}`}
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={isGrievance}
                  onChange={(e) => setIsGrievance(e.target.checked)}
                />
                <Label htmlFor={`grievance-${props.challengeId}`} className="text-sm font-normal">
                  This is a grievance — someone already owes an answer for it
                </Label>
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor={`reason-${props.challengeId}`}>
              Why? (required — this becomes labelled training data)
            </Label>
            <Textarea
              id={`reason-${props.challengeId}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "accept"
                  ? "e.g. The classification is right; the model was unsure because the report mixes two problems."
                  : "e.g. This is drought, not flood — the report is about wells failing after March."
              }
            />
            <p className="text-xs text-muted-foreground">
              {reason.trim().length}/{MIN_REASON} characters minimum.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!reasonOk || pending}
              onClick={() => submit(mode === "accept" ? "ACCEPT" : "OVERRIDE")}
            >
              {pending ? "Saving…" : mode === "accept" ? "Confirm accept" : "Confirm override"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
