import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { challenges, creditEdges } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "My reports" };

export default async function MePage() {
  const user = await requireUser("/me");

  const [reports, credits] = await Promise.all([
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
  ]);

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

      <section aria-labelledby="credit-heading" className="mt-10">
        <h2 id="credit-heading" className="text-lg font-semibold">
          Your permanent credit record
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We do not stop people from sharing work. We make it impossible to erase who did it. Every
          row here is backed by an append-only ledger entry.
        </p>

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
    </RoleShell>
  );
}
