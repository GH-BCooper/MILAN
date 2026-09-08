import Link from "next/link";
import { and, desc, eq, lt } from "drizzle-orm";
import { SeverityChip } from "@/components/severity-chip";
import { ROUTING } from "@/lib/ai/routing";
import { db } from "@/lib/db";
import { challenges, districts } from "@/lib/db/schema";

export const metadata = { title: "Flagged reports" };
export const dynamic = "force-dynamic";

/**
 * Reports whose S4 priority score fell below the routing bar
 * (`ROUTING.minPriorityToRoute`) never reach S5 — nobody's shortlist is spent
 * on a shortlist for a report that would not have cleared it. They are parked
 * instead of silently dropped (CLAUDE.md invariant 1: no non-terminal state is
 * left without an SLA row, and PARKED itself carries an automatic annual
 * re-review), and this page is the "why", visible to citizens, universities
 * and industry alike with no login required — the same audience the public
 * /challenges board already serves.
 */
export default async function FlaggedReportsPage() {
  const rows = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      priorityScore: challenges.priorityScore,
      scoringVersion: challenges.scoringVersion,
      districtName: districts.name,
      updatedAt: challenges.updatedAt,
    })
    .from(challenges)
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .where(
      and(
        eq(challenges.status, "PARKED"),
        lt(challenges.priorityScore, String(ROUTING.minPriorityToRoute)),
      ),
    )
    .orderBy(desc(challenges.updatedAt))
    .limit(500);

  return (
    <>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Flagged reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A report only routes to a university team once its priority score clears{" "}
          <strong>{ROUTING.minPriorityToRoute} of 100</strong>. Below that bar, it is
          flagged and parked here instead — never silently dropped. Click through to any
          report to see its full seven-term breakdown and exactly why it did not clear the
          bar.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Parked reports are re-reviewed automatically once a year, and sooner if new
          corroborations or facts raise the score — nothing here is a final rejection.
        </p>

        {rows.length === 0 ? (
          <div className="milan-glass mt-6 rounded-xl p-5 text-sm">
            <p className="font-semibold">Nothing is flagged right now.</p>
            <p className="mt-1 text-muted-foreground">
              Every report currently in the system has either cleared the {ROUTING.minPriorityToRoute}-point
              bar or is still being processed.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-border milan-glass rounded-xl">
            {rows.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/c/${r.trackingId}`}
                    className="font-mono text-sm font-semibold text-primary underline underline-offset-4"
                  >
                    {r.trackingId}
                  </Link>
                  <SeverityChip
                    score={r.priorityScore === null ? null : Number(r.priorityScore)}
                  />
                  <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                    Flagged — below {ROUTING.minPriorityToRoute}
                  </span>
                </div>
                <p className="mt-1 text-base font-medium text-foreground">{r.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.districtName ?? "District not given"} · scoring v{r.scoringVersion ?? "—"} ·{" "}
                  <Link href={`/c/${r.trackingId}#pipeline`} className="text-primary underline underline-offset-4">
                    see the full breakdown
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
