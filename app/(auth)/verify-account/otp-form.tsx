"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resendOtpAction, verifyEmailCodeAction, verifyPhoneCodeAction, type VerifyState } from "./actions";

/** One OTP box — email or phone. Shows the code on screen when the channel is
 *  a declared stub (mock SMS always is this cut; email is too when no
 *  RESEND_API_KEY/MAILPIT_URL is configured) rather than pretending a real
 *  message went out. See lib/auth/otp.ts. */
export function OtpBox({
  kind,
  label,
  destination,
  verified,
}: {
  kind: "email" | "phone";
  label: string;
  destination: string;
  verified: boolean;
}) {
  const action = kind === "email" ? verifyEmailCodeAction : verifyPhoneCodeAction;
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(action, {});
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [resending, startResend] = useTransition();

  function resend() {
    startResend(async () => {
      const result = await resendOtpAction(kind);
      setDemoCode(result.demoCode);
    });
  }

  if (verified || (state as { ok?: boolean }).ok) {
    return (
      <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 p-4">
        <p className="text-sm font-medium text-emerald-200">{label} verified — {destination}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="text-xs font-medium text-primary underline underline-offset-4 disabled:opacity-50"
        >
          {resending ? "Sending…" : "Send / resend code"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Code sent to {destination}.</p>

      {demoCode ? (
        <p className="rounded-md bg-amber-500/15 p-2 font-mono text-sm text-amber-200">
          Demo mode — no real {kind === "email" ? "mail" : "SMS"} gateway is configured. Your code is{" "}
          <strong>{demoCode}</strong>.
        </p>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[8rem] space-y-1">
          <Label htmlFor={`${kind}-code`}>6-digit code</Label>
          <Input id={`${kind}-code`} name="code" inputMode="numeric" maxLength={6} className="h-11" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Verify"}
        </Button>
      </form>

      {"ok" in state && !state.ok ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
