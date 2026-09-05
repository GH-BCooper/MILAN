"use client";

/**
 * Phase 1 left this as a known issue: `requireDistrict` correctly refuses a
 * cross-district request but there was no boundary to present the refusal, so a
 * DC of Gumla opening a Dhanbad page got a 500. A stack trace must never reach a
 * judge's screen (Task 3.9 step 3), and "refused" is a different thing from
 * "broken" — this says which.
 */
import Link from "next/link";
import { useEffect } from "react";

export default function GovError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[gov]", error);
  }, [error]);

  const forbidden = /scoped to district|not a member/i.test(error.message);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-lg border border-border p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {forbidden ? "Refused" : "Something went wrong"}
        </p>
        <h1 className="mt-2 text-xl font-bold">
          {forbidden ? "This district is not yours to act on." : "This page could not be loaded."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {forbidden
            ? "Government accounts in Milan are scoped to one district, and the scope is checked on the server " +
              "on every request — not only in the navigation. Nothing was changed and the attempt is in the audit log."
            : "The failure has been logged. Nothing you did caused it and nothing was written."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/gov" className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Back to your district
          </Link>
          {!forbidden ? (
            <button onClick={reset} className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold">
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
