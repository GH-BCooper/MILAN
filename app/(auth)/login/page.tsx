import Link from "next/link";

import { DEFAULT_DEMO_PASSWORD, DEMO_ACCOUNTS } from "@/lib/demo/accounts";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  // In Next 15 searchParams is a Promise and must be awaited.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const demoEnabled = process.env.DEMO_MODE === "true";
  const demo = demoEnabled
    ? {
        password: process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD,
        accounts: DEMO_ACCOUNTS.map(({ roleLabel, email, description }) => ({ roleLabel, email, description })),
      }
    : undefined;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        An account is required to report a problem, browse a challenge&apos;s full detail, or work as
        a university, industry or government user. Signing in takes you straight to your own page.
      </p>

      <div className="mt-6">
        <LoginForm next={next && next.startsWith("/") ? next : "/post-login"} demo={demo} />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        No account?{" "}
        <Link className="font-medium text-primary underline underline-offset-4" href="/register">
          Register
        </Link>
      </p>
    </div>
  );
}
