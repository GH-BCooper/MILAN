"use client";

/** One pending HEI/Industry registration. Mirrors the mandatory-reason pattern
 *  in app/(admin)/admin/triage/triage-card.tsx: the button stays disabled
 *  until a reason is typed. */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideVerificationAction } from "./actions";
import type { PendingVerification } from "./queue";

const MIN_REASON = 8;

const PROOF_LABELS: Record<string, string> = {
  INSTITUTIONAL_ID: "Institutional ID card",
  APPOINTMENT_LETTER: "Appointment or offer letter",
  DEPARTMENT_AUTH_LETTER: "Department authorisation letter",
  INSTITUTIONAL_EMAIL: "Institutional email domain match",
  GST_CIN: "GST or CIN registration certificate",
  CSR1_REGISTRATION: "CSR-1 registration",
  COMPANY_AUTH_LETTER: "Company authorisation letter",
  COMPANY_EMAIL: "Company email domain match",
};

export function VerificationCard({ item }: { item: PendingVerification }) {
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= MIN_REASON;
  const meta = item.proofMeta ?? {};

  function submit(decision: "APPROVE" | "REJECT") {
    startTransition(async () => {
      const result = await decideVerificationAction({ userId: item.userId, decision, reason: reason.trim() });
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <article className="milan-glass rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{item.fullName}</p>
        <p className="text-xs text-muted-foreground">{item.role === "HEI_MEMBER" ? "University" : "Industry"}</p>
      </div>
      <p className="text-sm text-muted-foreground">{item.orgName ?? "No organisation on file"}</p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Claims to be</dt>
          <dd>{String(meta.designation ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Proof type</dt>
          <dd>{item.proofType ? (PROOF_LABELS[item.proofType] ?? item.proofType) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">ID / GSTIN / CIN</dt>
          <dd>{String(meta.idNumber ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Institutional/company email</dt>
          <dd>{String(meta.orgEmail ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Phone</dt>
          <dd>{item.phone ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Organisation website</dt>
          <dd>{item.orgWebsite ?? "—"}</dd>
        </div>
      </dl>

      <div className="mt-3">
        {item.proofDocumentKey ? (
          <a
            className="text-sm font-medium text-primary underline underline-offset-4"
            href={`/api/admin/verification-document?userId=${item.userId}`}
            target="_blank"
            rel="noreferrer"
          >
            Open the submitted document ↗
          </a>
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            No document could be retrieved — object storage may be unreachable. See invariant 8.
          </p>
        )}
      </div>

      {mode === "none" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setMode("approve")}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1">
            <Label htmlFor={`reason-${item.userId}`}>Why? (required)</Label>
            <Textarea
              id={`reason-${item.userId}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "approve"
                  ? "e.g. The ID card matches the institution and the designation is plausible."
                  : "e.g. The document does not match the claimed institution."
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
              onClick={() => submit(mode === "approve" ? "APPROVE" : "REJECT")}
            >
              {pending ? "Saving…" : mode === "approve" ? "Confirm approve" : "Confirm reject"}
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
