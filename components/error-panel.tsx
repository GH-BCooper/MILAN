"use client";

/**
 * The one error surface.
 *
 * Task 3.9 step 3: no stack trace ever reaches a judge's screen. Every route
 * group renders this instead — calm, branded, and specific about whether the
 * request was REFUSED (an authorisation decision working correctly) or FAILED
 * (something broke). Those are different things and telling a District
 * Collector "something went wrong" when the answer is "that district is not
 * yours" is its own kind of bug.
 */
import Link from "next/link";
import { useEffect } from "react";

export function ErrorPanel({
  error,
  reset,
  area,
  home = "/",
  homeLabel = "Back to Milan",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  area: string;
  home?: string;
  homeLabel?: string;
}) {
  useEffect(() => {
    // Logged where an operator can find it; never rendered.
    console.error(`[${area}]`, error);
  }, [area, error]);

  const refused = /scoped to district|not a member|not on this project team|unauthorised|forbidden/i.test(error.message);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-lg border border-border p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {refused ? "Refused" : "Something went wrong"}
        </p>
        <h1 className="mt-2 text-xl font-bold">
          {refused ? "You do not have access to that." : "This page could not be loaded."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {refused
            ? "Milan checks permissions on the server on every request, not only in the navigation. Nothing was changed, and the attempt is in the audit log."
            : "The failure has been logged. Nothing you did caused it, and nothing was written."}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">reference {error.digest}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={home} className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            {homeLabel}
          </Link>
          {!refused ? (
            <button onClick={reset} className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold">
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
