"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

export function PasswordForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const form = new FormData(e.currentTarget);
    const currentPassword = String(form.get("current") ?? "");
    const newPassword = String(form.get("next") ?? "");
    if (newPassword.length < 8) {
      setMsg({ ok: false, text: "The new password must be at least 8 characters." });
      setPending(false);
      return;
    }
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setMsg({ ok: false, text: error.message ?? "That did not work — check your current password." });
      return;
    }
    setMsg({ ok: true, text: "Password changed. Other sessions were signed out." });
    e.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {msg ? (
        <Alert variant={msg.ok ? "default" : "destructive"} role="alert">
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" required className="h-11" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="next">New password</Label>
        <Input id="next" name="next" type="password" autoComplete="new-password" required className="h-11" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
