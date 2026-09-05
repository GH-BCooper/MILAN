import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { challenges, corroborations, creditEdges } from "@/lib/db/schema";
import { citationString, type CitationInput } from "@/lib/credit/citation";
import { CitationBlock } from "@/components/citation-block";
import { bibtex } from "@/lib/credit/citation";

export const dynamic = "force-dynamic";
export const metadata = { title: "My reports" };

export default async function MePage() {
  const user = await requireUser("/me");

  const host = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const [reports, credits, corroborated] = await Promise.all([
    db
      .select({
        id: challenges.id,
        trackingId: challenges.trackingId,
        title: challenges.title,
        status: challenges.status,
        createdAt: challenges.createdAt,
        districtCode: challenges.districtCode,
      })
      .from(challenges)
      .where(eq(challenges.reporterId, user.id))
      .orderBy(desc(challenges.createdAt)),
    db
      .select({
        relation: creditEdges.relation,
        challengeId: creditEdges.challengeId,
        trackingId: challenges.trackingId,
        title: challenges.title,
        createdAt: creditEdges.createdAt,
      })
      .from(creditEdges)
      .innerJoin(challenges, eq(challenges.id, creditEdges.challengeId))
      .where(eq(creditEdges.toUserId, user.id))
      .orderBy(desc(creditEdges.createdAt)),
    // Reports somebody else filed that this person confirmed independently.
    // Duplicates are signal: a corroboration is a contribution, not noise.
    db
      .select({
        trackingId: challenges.trackingId,
        title: challenges.title,
        status: challenges.status,
        at: corroborations.createdAt,
      })
      .from(corroborations)
      .innerJoin(challenges, eq(challenges.id, corroborations.challengeId))
      .where(eq(corroborations.userId, user.id))
      .orderBy(desc(corroborations.createdAt)),
  ]);

  const first = reports[0];
  const firstCitation: CitationInput = {
    trackingId: first?.trackingId ?? "",
    originatorName: user.fullName,
    teamName: null,
    title: first?.title ?? "",
    place: null,
    year: (first?.createdAt ?? new Date(0)).getUTCFullYear(),
    host,
  };

  return (
    <RoleShell title="My reports" subtitle={`Signed in as ${user.fullName}.`}>
      <section aria-labelledby="reports-heading">
        <h2 id="reports-heading" className="text-lg font-semibold">
          Problems you reported
        </h2>

        {reports.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            You have not reported anything yet.{" "}
            <Link className="font-medium text-primary underline underline-offset-4" href="/submit">
              Report a problem
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <Link
                  href={`/c/${r.trackingId}`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {r.trackingId}
                </Link>
                <StatusBadge status={r.status} />
                <span className="w-full text-sm text-muted-foreground sm:w-auto">{r.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="corroborated-heading" className="mt-10">
        <h2 id="corroborated-heading" className="text-lg font-semibold">
          Problems you confirmed for someone else
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Duplicates are signal, not noise. Reporting the same problem someone else already reported
          makes their report stronger, and you are credited for it.
        </p>
        {corroborated.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            You have not corroborated anyone else&rsquo;s report yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {corroborated.map((c) => (
              <li key={c.trackingId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <Link href={`/c/${c.trackingId}`} className="font-medium text-primary underline underline-offset-4">
                  {c.trackingId}
                </Link>
                <StatusBadge status={c.status} />
                <span className="w-full text-sm text-muted-foreground sm:w-auto">{c.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="credit-heading" className="mt-10">
        <h2 id="credit-heading" className="text-lg font-semibold">
          Your permanent credit record
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We do not stop people from sharing work. We make it impossible to erase who did it. Every
          row here is backed by an append-only ledger entry, and your record is public at{" "}
          <Link href={`/credit/${user.id}`} className="text-primary underline underline-offset-4">
            /credit/{user.id.slice(0, 8)}…
          </Link>
          .
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/api/me/export"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Download as PDF
          </a>
          <Link
            href={`/credit/${user.id}`}
            className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold"
          >
            Open the public version
          </Link>
        </div>

        {credits.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No credit recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {credits.map((c) => (
              <li key={`${c.challengeId}-${c.relation}`} className="flex flex-wrap items-center gap-x-3 p-4">
                <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                  {c.relation}
                </span>
                <Link
                  href={`/c/${c.trackingId}`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {c.trackingId}
                </Link>
                <span className="w-full text-sm text-muted-foreground sm:w-auto">{c.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reports.length > 0 ? (
        <section aria-labelledby="cite-heading" className="mt-10">
          <h2 id="cite-heading" className="text-lg font-semibold">
            How to cite your report
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            You are in the author position, before the institution. If a paper comes out of your
            report, this is the line that has to be in it.
          </p>
          <CitationBlock
            citation={citationString(firstCitation)}
            bibtex={bibtex(firstCitation)}
          />
        </section>
      ) : null}
    </RoleShell>
  );
}
