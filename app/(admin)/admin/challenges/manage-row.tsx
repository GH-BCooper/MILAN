"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { nativeSelectClassName } from "@/components/select-with-other";
import { adminTransitionAction } from "./actions";

export function ManageRow({
  challengeId,
  trackingId,
  title,
  status,
  district,
  legalTargets,
}: {
  challengeId: string;
  trackingId: string;
  title: string;
  status: string;
  district: string | null;
  legalTargets: string[];
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(legalTargets[0] ?? "");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await adminTransitionAction({ challengeId, to, reason });
      if (res.ok) {
        setMsg({ ok: true, text: res.message });
        setReason("");
        setOpen(false);
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={`/c/${trackingId}`} className="font-mono text-sm font-semibold text-primary underline underline-offset-4">
          {trackingId}
        </Link>
        <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
          {status.replaceAll("_", " ")}
        </span>
        {district ? <span className="text-xs text-muted-foreground">{district}</span> : null}
        {legalTargets.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ms-auto rounded-md border border-border px-3 py-1 text-xs font-medium"
          >
            {open ? "Cancel" : "Change state"}
          </button>
        ) : (
          <span className="ms-auto text-xs text-muted-foreground">terminal — no moves</span>
        )}
      </div>
      <p className="mt-1 text-sm text-foreground">{title}</p>

      {msg ? (
        <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
          {msg.text}
        </p>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border p-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Move to
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`mt-1 block ${nativeSelectClassName}`}
            >
              {legalTargets.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Reason (recorded in the ledger and the audit log)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              minLength={15}
              className="mt-1 block w-full rounded-md border border-input bg-background p-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={pending || reason.trim().length < 15}
            onClick={submit}
            className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Apply with reason"}
          </button>
        </div>
      ) : null}
    </li>
  );
}
