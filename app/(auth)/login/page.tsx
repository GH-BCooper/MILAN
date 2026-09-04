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
        You do not need an account to report a problem or to track one. Sign in to see your own
        reports, or to work as a university, industry or government user.
      </p>

      <div className="mt-6">
        <LoginForm next={next && next.startsWith("/") ? next : "/me"} />
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
