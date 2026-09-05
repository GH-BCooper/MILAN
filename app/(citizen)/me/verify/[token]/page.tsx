import Link from "next/link";
import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { execRaw } from "@/lib/db/raw";
import { readVerifyToken } from "@/lib/verify/token";
import { ConfirmForm } from "./confirm-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Is it fixed?" };

/**
 * The confirmation page.
 *
 * No login. It shows the problem in the citizen's OWN language first, beside the
 * English working copy at the same size and weight (invariant 6) — this is the
 * page where that matters most, because the person answering may read only one
 * of the two and the question is meaningless if they cannot read it.
 */
interface Row extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  body_original: string;
  body_lang: string;
  body_en: string | null;
  status: string;
  impact_confirmed: boolean;
  impact_partial: boolean;
  impact_disputed: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  artifact_title: string | null;
}

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = readVerifyToken(decodeURIComponent(token));

  if ("error" in read) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
          <h1 className="text-xl font-bold">This link did not work</h1>
          <p className="mt-2 text-sm text-muted-foreground">{read.error}</p>
          <p className="mt-4 text-sm">
            <Link href="/track" className="text-primary underline underline-offset-4">
              Look your report up by its tracking number instead
            </Link>
          </p>
        </main>
      </>
    );
  }

  const rows = await execRaw<Row>(sql`
    SELECT c.tracking_id, c.title, c.body_original, c.body_lang, c.body_en, c.status::text AS status,
           c.impact_confirmed, c.impact_partial, c.impact_disputed,
           o.name AS claimed_by, p.claimed_at::text AS claimed_at,
           (SELECT a.title FROM artifacts a WHERE a.project_id = p.id ORDER BY a.published_at DESC LIMIT 1) AS artifact_title
    FROM challenges c
    LEFT JOIN projects p ON p.challenge_id = c.id
    LEFT JOIN organization o ON o.id = p.org_id
    WHERE c.id = ${read.challengeId}
    LIMIT 1
  `);

  if (rows.length === 0) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
          <h1 className="text-xl font-bold">That report could not be found.</h1>
        </main>
      </>
    );
  }
  const c = rows[0];
  const alreadyAnswered = c.impact_confirmed || c.impact_disputed;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
        <p className="font-mono text-xs font-semibold text-muted-foreground">{c.tracking_id}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Has this actually been fixed?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Somebody says they have solved the problem you reported. Nobody at Milan or in government can
          answer this question. Only you can.
        </p>

        {/* Invariant 6. The citizen's own words, first, at full size. */}
        <section className="mt-6 space-y-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What you told us ({c.body_lang})
            </p>
            <p className="mt-2 text-base">{c.body_original}</p>
          </div>
          {c.body_en && c.body_lang !== "en" ? (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                English working copy
              </p>
              <p className="mt-2 text-base">{c.body_en}</p>
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-lg border border-border bg-muted p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What is being claimed, and by whom
          </p>
          <p className="mt-2 text-sm">
            {c.claimed_by
              ? `${c.claimed_by} took this on${c.claimed_at ? ` on ${c.claimed_at.slice(0, 10)}` : ""} and says the work is done.`
              : "An implementation has been claimed on this report."}
          </p>
          {c.artifact_title ? <p className="mt-1 text-sm text-muted-foreground">They published: “{c.artifact_title}”.</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Until you answer, this is shown everywhere as <span className="font-medium">claimed, not confirmed</span> —
            including in the corporate CSR reports that cite it.
          </p>
        </section>

        <div className="mt-6">
          {alreadyAnswered ? (
            <div className="rounded-lg border border-border p-5">
              <p className="text-base font-semibold">You have already answered this.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {c.impact_disputed
                  ? "You told us nothing had changed. That is on the record and the claim is marked disputed."
                  : c.impact_partial
                    ? "You told us it was partly fixed. That is counted separately from a full fix."
                    : "You confirmed it was fixed. Your report is counted as a confirmed outcome."}
              </p>
              <Link href={`/c/${c.tracking_id}`} className="mt-3 inline-block text-sm text-primary underline underline-offset-4">
                See your report
              </Link>
            </div>
          ) : (
            <ConfirmForm token={decodeURIComponent(token)} />
          )}
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          This link is signed and works without a password so you do not have to remember one. It is
          valid for ninety days and it can only answer this one question about this one report.
        </p>
      </main>
    </>
  );
}
