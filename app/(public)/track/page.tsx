import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/db";
import { challenges } from "@/lib/db/schema";

export const metadata = { title: "Track a report" };
export const dynamic = "force-dynamic";

/**
 * One input, no login, ever. A citizen with a tracking ID written on a scrap of
 * paper is the whole audience for this page.
 */
async function findAction(formData: FormData) {
  "use server";

  const raw = String(formData.get("trackingId") ?? "")
    .trim()
    .toUpperCase();
  if (!raw) redirect("/track?error=empty");

  const [row] = await db
    .select({ trackingId: challenges.trackingId })
    .from(challenges)
    .where(eq(challenges.trackingId, raw))
    .limit(1);

  if (!row) redirect(`/track?error=notfound&q=${encodeURIComponent(raw)}`);
  redirect(`/c/${row.trackingId}`);
}

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const { error, q } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Track a report</h1>
        <p className="mt-1 text-sm text-muted-foreground" lang="hi">
          अपनी रिपोर्ट देखें
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Enter the tracking ID you were given. No account needed.
        </p>

        <form action={findAction} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="trackingId">Tracking ID</Label>
            <Input
              id="trackingId"
              name="trackingId"
              required
              defaultValue={q ?? ""}
              placeholder="JH-2026-GUM-0042"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="h-12 font-mono text-lg"
              aria-describedby={error ? "track-error" : undefined}
            />
          </div>

          {error ? (
            <p id="track-error" role="alert" className="text-sm font-medium text-destructive">
              {error === "empty"
                ? "Please enter a tracking ID."
                : `We have no report with the ID ${q}. Check the letters and numbers and try again.`}
            </p>
          ) : null}

          <Button type="submit" className="w-full">
            Find my report
          </Button>
        </form>

        <p className="mt-6 text-xs text-muted-foreground">
          A tracking ID looks like <span className="font-mono">JH-2026-GUM-0042</span> — the state,
          the year, your district and the report number.
        </p>
      </main>
    </>
  );
}
