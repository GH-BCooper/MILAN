"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  lookupAccountAction,
  requestResetCodeAction,
  resetPasswordAction,
  verifyResetCodeAction,
  type LookupResult,
  type ResetPasswordState,
} from "./actions";

type OtpKind = "email" | "phone";
type Step = "email" | "code" | "password" | "done";

interface ChannelState {
  sent: boolean;
  demoCode: string | null;
  code: string;
  error: string | null;
  pending: boolean;
}

const EMPTY_CHANNEL: ChannelState = { sent: false, demoCode: null, code: "", error: null, pending: false };

/** One OTP channel (email or phone) inside the reset wizard. Mirrors
 *  app/(auth)/verify-account/otp-form.tsx's box, but driven by explicit
 *  parent state instead of useActionState + a session, since the citizen here
 *  is signed out. Verifying *either* channel is enough to unlock step 3. */
function ResetChannelBox({
  kind,
  label,
  destination,
  state,
  onSend,
  onCodeChange,
  onVerify,
}: {
  kind: OtpKind;
  label: string;
  destination: string;
  state: ChannelState;
  onSend: () => void;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <button
          type="button"
          onClick={onSend}
          disabled={state.pending}
          className="text-xs font-medium text-primary underline underline-offset-4 disabled:opacity-50"
        >
          {state.pending && !state.sent ? "Sending…" : state.sent ? "Resend code" : "Send code"}
        </button>
      </div>

      {/* Only ever claim a code went out once a send actually completed — a
       *  citizen who never pressed "send" and just guesses will otherwise see
       *  "code sent" and assume the check-against value exists when it never
       *  did (the root cause of "verification doesn't work at all"). */}
      {state.sent ? (
        <p className="text-xs text-muted-foreground">Code sent to {destination}.</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Press &ldquo;Send code&rdquo; to get a code at {destination}.
        </p>
      )}

      {state.demoCode ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/12 p-2 font-mono text-sm text-amber-800 dark:text-amber-200">
          Demo mode — no real {kind === "email" ? "mail" : "SMS"} gateway is configured. Your code is{" "}
          <strong>{state.demoCode}</strong>.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[8rem] space-y-1">
          <Label htmlFor={`${kind}-reset-code`}>6-digit code</Label>
          <Input
            id={`${kind}-reset-code`}
            name={`${kind}-code`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            className="h-11"
            disabled={!state.sent}
            value={state.code}
            onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        <Button type="button" onClick={onVerify} disabled={!state.sent || state.pending || state.code.length !== 6}>
          {state.pending && state.sent ? "Checking…" : "Verify"}
        </Button>
      </div>

      {state.error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupPending, startLookup] = useTransition();

  const [emailChannel, setEmailChannel] = useState<ChannelState>(EMPTY_CHANNEL);
  const [phoneChannel, setPhoneChannel] = useState<ChannelState>(EMPTY_CHANNEL);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const [pwState, pwAction, pwPending] = useActionState<ResetPasswordState, FormData>(resetPasswordAction, {});

  useEffect(() => {
    if (pwState.ok) setStep("done");
  }, [pwState.ok]);

  function channelSetter(kind: OtpKind) {
    return kind === "email" ? setEmailChannel : setPhoneChannel;
  }

  function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupError(null);
    startLookup(async () => {
      const result = await lookupAccountAction(email);
      if (!result.ok) {
        setLookupError(result.error ?? "Please check your email address.");
        return;
      }
      setLookup(result);
      setStep("code");
    });
  }

  function sendCode(kind: OtpKind) {
    const setChannel = channelSetter(kind);
    setChannel((s) => ({ ...s, pending: true, error: null }));
    startLookup(async () => {
      const result = await requestResetCodeAction(kind, email);
      setChannel((s) => ({ ...s, pending: false, sent: true, demoCode: result.demoCode }));
    });
  }

  function verifyCode(kind: OtpKind) {
    const setChannel = channelSetter(kind);
    const current = kind === "email" ? emailChannel : phoneChannel;
    setChannel((s) => ({ ...s, pending: true, error: null }));
    startLookup(async () => {
      const result = await verifyResetCodeAction(kind, email, current.code);
      if (!result.ok) {
        setChannel((s) => ({ ...s, pending: false, error: "error" in result ? result.error : "That code did not match, or it has expired." }));
        return;
      }
      setResetToken(result.token);
      setStep("password");
    });
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>Your password has been reset. You can now sign in with it.</AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (step === "password") {
    return (
      <form
        action={(formData) => {
          formData.set("token", resetToken ?? "");
          pwAction(formData);
        }}
        className="space-y-4"
        noValidate
      >
        <p className="text-sm text-muted-foreground">Choose a new password for {email}.</p>

        {pwState.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{pwState.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="h-11" />
        </div>

        <Button type="submit" className="w-full" disabled={pwPending}>
          {pwPending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    );
  }

  if (step === "code" && lookup) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Verify either your email or your phone to continue — you only need one.
        </p>

        {!lookup.emailAvailable && !lookup.phoneAvailable ? (
          <Alert>
            <AlertDescription>
              If an account exists for {email}, a code has been made available below. If nothing arrives, check
              that this is the email you registered with.
            </AlertDescription>
          </Alert>
        ) : null}

        <ResetChannelBox
          kind="email"
          label="Email"
          destination={email}
          state={emailChannel}
          onSend={() => sendCode("email")}
          onCodeChange={(value) => setEmailChannel((s) => ({ ...s, code: value }))}
          onVerify={() => verifyCode("email")}
        />
        <ResetChannelBox
          kind="phone"
          label="Phone"
          destination={lookup.maskedPhone ?? "(no verified phone on file)"}
          state={phoneChannel}
          onSend={() => sendCode("phone")}
          onCodeChange={(value) => setPhoneChannel((s) => ({ ...s, code: value }))}
          onVerify={() => verifyCode("phone")}
        />

        <button
          type="button"
          onClick={() => {
            setStep("email");
            setLookup(null);
            setEmailChannel(EMPTY_CHANNEL);
            setPhoneChannel(EMPTY_CHANNEL);
          }}
          className="text-xs font-medium text-muted-foreground underline underline-offset-4"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submitEmail} className="space-y-4" noValidate>
      <p className="text-sm text-muted-foreground">
        Enter the email on your account. We&apos;ll send a code to your verified email and/or phone before you can
        set a new password.
      </p>

      {lookupError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{lookupError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={lookupPending}>
        {lookupPending ? "Checking…" : "Send reset code"}
      </Button>
    </form>
  );
}
