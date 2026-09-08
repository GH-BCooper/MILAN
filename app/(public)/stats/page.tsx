import Link from "next/link";
import { sql } from "drizzle-orm";

import { DistrictHeatMap, type DistrictHeatWeight } from "@/components/district-heat";
import { STATUS_LABEL } from "@/components/status-badge";
import { ConfirmationGap, ImpactCounter } from "@/components/impact-counter";
import { execRaw } from "@/lib/db/raw";
import { impactCounts } from "@/lib/impact/counter";
import type { ChallengeStatus } from "@/lib/db/schema";

export const metadata = { title: "Public statistics" };
export const dynamic = "force-dynamic";

/** drizzle's `execute` generic requires an index signature on the row type. */
interface CountRow extends Record<string, unknown> {
  bucket: string;
  key: string | null;
  label: string | null;
  n: number;
}

interface MedianRow extends Record<string, unknown> {
  median: number | null;
}

interface HeatRow extends Record<string, unknown> {
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  n: number;
  avg_severity: number | null;
}

/* The same aggregation /gov/sla runs, minus the government scope. Public:
   org names and counts only, no users, no emails. */
interface LeaderboardRow extends Record<string, unknown> {
  name: string;
  offered: number;
  claimed: number;
  delivered: number;
  released_undelivered: number;
  median_claim_hours: number | null;
}

/**
 * Task 4.7 funnel bands: the 28-state machine compressed into monotonic
 * "has reached at least" thresholds. Counted from each report's CURRENT
 * state — the honest read at this data volume; the caption says where a
 * forwarded or withdrawn report stops. A new enum member breaks this
 * Record at build time, so the funnel can never silently swallow a status.
 */
const STAGE_RANK: Record<ChallengeStatus, number> = {
  SUBMITTED: 0,
  NEEDS_MORE_INFO: 0,
  REJECTED_UNSAFE: 0,
  FORWARDED_EXTERNAL: 0,
  WITHDRAWN: 0,
  TRIAGED: 1,
  CLASSIFIED: 1,
  CLUSTERED: 1,
  PRIORITISED: 1,
  VERIFIED: 2,
  ROUTED: 3,
  UNCLAIMED_ESCALATED: 3,
  BOUNTY_LISTED: 3,
  CLAIMED: 4,
  PROPOSAL_APPROVED: 4,
  IN_RESEARCH: 4,
  AT_RISK: 4,
  AGREEMENT_SIGNED: 4,
  PILOT: 4,
  SOLUTION_PUBLISHED: 5,
  INDUSTRY_INTEREST: 5,
  FORKED: 5,
  DISPUTED: 5,
  IMPLEMENTED: 6,
  CITIZEN_VERIFIED: 7,
  CLOSED: 7,
  MERGED: 0,
  PARKED: 0,
};

const FUNNEL_STEPS: ReadonlyArray<{ label: string; atLeast: number }> = [
  { label: "Submitted", atLeast: 0 },
  { label: "Verified", atLeast: 2 },
  { label: "Routed", atLeast: 3 },
  { label: "Claimed", atLeast: 4 },
  { label: "Solution published", atLeast: 5 },
  { label: "Implemented", atLeast: 6 },
  { label: "Confirmed by the citizen", atLeast: 7 },
];

export default async function StatsPage() {
  /**
   * One round trip for every count on the page.
   *
   * These are raw queries, and Milan holds a single pooled connection per
   * instance — concurrent raw queries deadlock it (see lib/db/raw.ts). Rather
   * than serialise six round trips, this is one statement whose rows carry a
   * `bucket` discriminator.
   */
  const rows = await execRaw<CountRow>(sql`
    SELECT 'total' AS bucket, NULL::text AS key, NULL::text AS label, count(*)::int AS n
      FROM challenges
    UNION ALL
    -- Invariant 7 has ONE definition, in lib/impact/counter.ts, and this page
    -- reads it rather than restating it. What was here before was a status
    -- filter, which quietly dropped a challenge the moment it was CLOSED — a
    -- confirmed outcome that stopped being counted the day it was finished.
    SELECT 'impact', NULL, NULL, 0
    UNION ALL
    SELECT 'district', c.district_code, d.name, count(*)::int
      FROM challenges c LEFT JOIN districts d ON d.code = c.district_code
      GROUP BY c.district_code, d.name
    UNION ALL
    SELECT 'domain', coalesce(domain::text, 'UNCLASSIFIED'), NULL, count(*)::int
      FROM challenges GROUP BY 1, 2, 3
    UNION ALL
    SELECT 'status', status::text, NULL, count(*)::int
      FROM challenges GROUP BY 1, 2, 3
  `);

  // Null until Phase 2 routes anything. We show the gap rather than a zero,
  // which would read as "instant".
  const medianRows = await execRaw<MedianRow>(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (r.created_at - c.created_at)) / 3600
    ) AS median
    FROM routes r JOIN challenges c ON c.id = r.challenge_id
  `);

  /* District heat for the map: count + mean severity per district. Averages
     live on the severity column's 0-1 scale and are lifted onto the 0-100
     band scale here, exactly what SeverityChip bands elsewhere. Districts
     without coordinates (none in the seed) are simply absent from the
     canvas — the table below still carries their counts. */
  const heatRows = await execRaw<HeatRow>(sql`
    SELECT c.district_code AS code,
           d.name,
           d.lat::float AS lat,
           d.lng::float AS lng,
           count(*)::int AS n,
           avg(c.severity)::float * 100 AS avg_severity
    FROM challenges c
    JOIN districts d ON d.code = c.district_code
    WHERE d.lat IS NOT NULL AND d.lng IS NOT NULL
    GROUP BY c.district_code, d.name, d.lat, d.lng
  `);

  const leaderboardRows = await execRaw<LeaderboardRow>(sql`
    SELECT o.name,
           count(*)::int AS offered,
           count(*) FILTER (WHERE r.state = 'CLAIMED')::int AS claimed,
           count(*) FILTER (WHERE c.status IN ('SOLUTION_PUBLISHED','IMPLEMENTED','CITIZEN_VERIFIED','CLOSED'))::int AS delivered,
           count(*) FILTER (WHERE r.state = 'RELEASED')::int AS released_undelivered,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (p.claimed_at - r.created_at)) / 3600
           )::int AS median_claim_hours
    FROM routes r
    JOIN organization o ON o.id = r.org_id
    JOIN challenges c ON c.id = r.challenge_id
    LEFT JOIN projects p ON p.challenge_id = c.id AND p.org_id = o.id
    GROUP BY o.name
    ORDER BY offered DESC, o.name
  `);

  const pick = (bucket: string) =>
    rows
      .filter((r) => r.bucket === bucket)
      .map((r) => ({ key: r.key ?? "UNKNOWN", label: r.label, n: Number(r.n) }))
      .sort((a, b) => b.n - a.n);

  const totalN = Number(rows.find((r) => r.bucket === "total")?.n ?? 0);
  const impact = await impactCounts();
  const impactN = impact.confirmed;
  const medianHours = medianRows[0]?.median ?? null;

  return (
    <>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Public statistics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything on this page is computed live from the database. Nothing here is a target or a
          projection.
        </p>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="milan-glass rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Problems reported</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{totalN.toLocaleString("en-IN")}</p>
          </div>

          <div className="rounded-lg border-2 border-emerald-400/40 bg-emerald-500/15 p-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Confirmed impact</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
              {impactN.toLocaleString("en-IN")}
            </p>
            <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">
              Impact counts only citizen-confirmed outcomes.
              {impact.partial > 0 ? ` ${impact.partial} more were confirmed as partly fixed and are counted separately.` : ""}
            </p>
          </div>

          <div className="milan-glass rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Median time to route</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">
              {medianHours === null ? "—" : `${Number(medianHours).toFixed(0)}h`}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {medianHours === null
                ? "No challenge has been routed yet. Routing arrives in Phase 2."
                : "From submission to the first institution being notified."}
            </p>
          </div>
        </section>

        <p className="mt-4 milan-glass rounded-xl bg-muted p-4 text-sm">
          <strong className="font-semibold">Why the impact number is small.</strong> A problem counts
          as impact only when the people who reported it confirm it was actually fixed. Publishing a
          solution does not count. Funding it does not count. An implementer saying they did it does
          not count. Anything unconfirmed is shown in grey everywhere on this platform, including in
          reports we export to companies.
        </p>

        {/* The confirmation gap. Task 3.6 step 4: do not hide it. */}
        <section className="mt-6">
          <ConfirmationGap counts={impact} href="/stats" />
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Claimed against confirmed</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            The same three numbers the District Collector sees, and the same three numbers a company
            gets in its CSR export. There is one definition of confirmed impact in this codebase and
            every surface reads it.
          </p>
          <ImpactCounter counts={impact} />
        </section>

        {/* Task 4.7: the district heatmap returns (JDIP Part 3.2 analytics
            wireframe), severity-weighted, click-through to a filtered
            /challenges board. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Where the reports are</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            One circle per district: colour is the average severity of its reports, size is how many
            there are. Click a district for its board, severity-first.
          </p>
          {heatRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              No reports with district coordinates yet.
            </p>
          ) : (
            <DistrictHeatMap weights={heatRows.map<DistrictHeatWeight>((r) => ({
              code: r.code,
              name: r.name,
              lat: Number(r.lat),
              lng: Number(r.lng),
              count: Number(r.n),
              avgSeverity: r.avg_severity === null ? null : Number(r.avg_severity),
            }))} />
          )}
        </section>

        {/* Pipeline funnel: same card style as StatTable, bars instead of
            numbers-first columns. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">The pipeline funnel</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Each bar counts every report whose current state has reached at least that stage. A
            report that left the board — merged, forwarded, withdrawn — stops where it stopped; the
            ledger keeps its full path.
          </p>
          <div className="space-y-2">
            {(() => {
              const statusRows = rows.filter((r) => r.bucket === "status");
              const counts = FUNNEL_STEPS.map((step) => ({
                ...step,
                n: statusRows.reduce(
                  (sum, r) => sum + (STAGE_RANK[(r.key ?? "SUBMITTED") as ChallengeStatus] >= step.atLeast ? Number(r.n) : 0),
                  0,
                ),
              }));
              const base = counts[0]?.n ?? 0;
              return counts.map((step) => {
                const pct = base > 0 ? (step.n / base) * 100 : 0;
                return (
                  <div key={step.label} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 text-muted-foreground">{step.label}</span>
                    <div className="h-2 flex-1 rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.max(pct, step.n > 0 ? 1 : 0)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                      {step.n.toLocaleString("en-IN")} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </section>

        {/* Public leaderboard: the /gov/sla aggregation without the scope. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Institutional leaderboard</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            The same per-institution numbers the SLA board shows inside government, published for
            everyone. An institution with a zero stays on the table — we show it rather than hide
            it, because a zero next to a deadline is itself an account.
          </p>
          {leaderboardRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              No institution has been routed a challenge yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Institution</th>
                    <th className="py-2 pr-3 text-right">Offered</th>
                    <th className="py-2 pr-3 text-right">Claimed</th>
                    <th className="py-2 pr-3 text-right">Delivered</th>
                    <th className="py-2 pr-3 text-right">Released undelivered</th>
                    <th className="py-2 text-right">Median hours to claim</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardRows.map((r) => (
                    <tr key={r.name} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">{r.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(r.offered)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(r.claimed)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(r.delivered)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(r.released_undelivered)}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {r.median_claim_hours === null ? "—" : Number(r.median_claim_hours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <StatTable
          heading="By district"
          rows={pick("district").map((r) => ({
            key: r.key,
            label: r.label ?? (r.key === "UNKNOWN" ? "District not given" : r.key),
            n: r.n,
          }))}
          total={totalN}
          hrefFor={(key) => (key === "UNKNOWN" ? null : `/challenges?district=${encodeURIComponent(key)}`)}
        />

        <StatTable
          heading="By domain"
          rows={pick("domain").map((r) => ({
            key: r.key,
            label:
              r.key === "UNCLASSIFIED"
                ? "Not yet classified (the AI pipeline arrives in Phase 2)"
                : r.key.replaceAll("_", " "),
            n: r.n,
          }))}
          total={totalN}
          hrefFor={(key) => (key === "UNCLASSIFIED" ? null : `/challenges?domain=${key}`)}
        />

        <StatTable
          heading="By status"
          rows={pick("status").map((r) => ({
            key: r.key,
            label: STATUS_LABEL[r.key as ChallengeStatus] ?? r.key,
            n: r.n,
          }))}
          total={totalN}
          hrefFor={(key) => `/challenges?status=${key}`}
        />
      </main>
    </>
  );
}

/** A table, not a chart. At this row count a chart would be decoration, and a
 *  number a judge can read off the screen is worth more than a shape. */
function StatTable({
  heading,
  rows,
  total,
  hrefFor,
}: {
  heading: string;
  rows: { key: string; label: string; n: number }[];
  total: number;
  hrefFor: (key: string) => string | null;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-md border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 text-start font-medium text-muted-foreground">
                {heading.replace("By ", "").replace(/^./, (c) => c.toUpperCase())}
              </th>
              <th scope="col" className="py-2 text-end font-medium text-muted-foreground">
                Reports
              </th>
              <th scope="col" className="w-1/3 py-2 ps-4 text-start font-medium text-muted-foreground">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = hrefFor(r.key);
              const pct = total > 0 ? (r.n / total) * 100 : 0;
              return (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="py-2">
                    {href ? (
                      <Link className="text-primary underline underline-offset-4" href={href}>
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                  </td>
                  <td className="py-2 text-end tabular-nums">{r.n}</td>
                  <td className="py-2 ps-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted" aria-hidden>
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                      <span className="w-12 text-end text-xs tabular-nums text-muted-foreground">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
