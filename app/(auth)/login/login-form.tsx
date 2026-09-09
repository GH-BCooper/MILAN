"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

export interface DemoCredential {
  roleLabel: string;
  email: string;
  description: string;
}

export function LoginForm({
  next,
  demo,
}: {
  next: string;
  demo?: { password: string; accounts: readonly DemoCredential[] };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    if (error) {
      setError(error.message ?? "Those details did not match an account.");
      setPending(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {demo ? (
        <section className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-4" aria-labelledby="demo-accounts-heading">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="demo-accounts-heading" className="text-sm font-semibold">
                Demo accounts
              </h2>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 aria-hidden /> Fully verified
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose a role to fill the form. Email and phone are verified; university and industry affiliation is approved.
            </p>
            <p className="text-xs">
              Shared password: <code className="rounded bg-background px-1.5 py-0.5 font-mono font-semibold">{demo.password}</code>
            </p>
          </div>

          <div className="grid gap-2">
            {demo.accounts.map((account) => {
              const selected = email === account.email;
              return (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(demo.password);
                    setError(null);
                  }}
                  aria-pressed={selected}
                  className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{account.roleLabel}</span>
                    <span className="text-xs font-medium text-primary">{selected ? "Selected" : "Use account"}</span>
                  </span>
                  <span className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">{account.email}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{account.description}</span>
                </button>
              );
            })}
          </div>
        </section>
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
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline underline-offset-4"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
