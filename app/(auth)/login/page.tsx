import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  // In Next 15 searchParams is a Promise and must be awaited.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        An account is required to report a problem, browse a challenge&apos;s full detail, or work as
        a university, industry or government user. Signing in takes you straight to your own page.
      </p>

      <div className="mt-6">
        <LoginForm next={next && next.startsWith("/") ? next : "/post-login"} />
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
