import Link from "next/link";
import { sql } from "drizzle-orm";

import { ConfirmationGap, ImpactCounter } from "@/components/impact-counter";
import { MilanMap } from "@/components/milan-map";
import { RoleShell } from "@/components/role-shell";
import { STATUS_LABEL } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { syncClockOffset } from "@/lib/clock/server";
import { execRaw } from "@/lib/db/raw";
import type { ChallengeStatus } from "@/lib/db/schema";
import { impactCounts } from "@/lib/impact/counter";

export const dynamic = "force-dynamic";
export const metadata = { title: "District dashboard" };

/**
 * The District Collector's dashboard.
 *
 * Scoped to the signed-in officer's district, and the scope is a WHERE clause on
 * every query on this page rather than a filter in the navigation — see
 * `requireRole` and the error boundary beside this file. A Gumla officer cannot
 * see Dhanbad here even by editing a URL, because there is no URL to edit.
 *
 * Everything on it is ordered by what a Collector actually needs at 9am: what
 * has breached and by how long, what is waiting for their signature, and how
 * much of the claimed impact has actually been confirmed by a citizen.
 */

interface Row extends Record<string, unknown> {
  bucket: string;
  k: string | null;
  label: string | null;
  n: number;
  extra: string | null;
}

interface BreachRow extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  status: ChallengeStatus;
  days_overdue: number;
  kind: string;
  due_at: string;
}

interface MapRow extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  lat: string | null;
  lng: string | null;
  priority_score: string | null;
}

interface HeiRow extends Record<string, unknown> {
  org_id: string;
  name: string;
  offered: number;
  claimed: number;
  delivered: number;
  breached: number;
}

/** Priority as colour, on a single hue ramp. The list beside it carries the numbers. */
function priorityColour(score: number | null): string {
  if (score === null) return "#94a3b8";
  if (score >= 0.75) return "#7f1d1d";
  if (score >= 0.6) return "#b91c1c";
  if (score >= 0.45) return "#ea580c";
  if (score >= 0.3) return "#ca8a04";
  return "#0369a1";
}

export default async function GovHome() {
  // Middleware already redirected a signed-out visitor. This is the check that
  // counts: a server action can be called without ever passing through it.
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");
  await syncClockOffset();
  const district = user.districtCode;

  if (!district) {
    return (
      <RoleShell title="District dashboard" subtitle={`Signed in as ${user.fullName}.`}>
        <div className="rounded-lg border border-dashed border-border bg-muted p-6">
          <p className="text-sm font-semibold">This account is not scoped to a district.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Every government surface in Milan is district-scoped, so there is nothing to show until an
            administrator sets one on this profile. That is deliberate: an unscoped officer would be an
            officer accountable for nowhere.
          </p>
        </div>
      </RoleShell>
    );
  }

  const [counts, impact] = await Promise.all([
    execRaw<Row>(sql`
      SELECT 'status' AS bucket, status::text AS k, NULL::text AS label, count(*)::int AS n, NULL::text AS extra
        FROM challenges WHERE district_code = ${district} GROUP BY status
      UNION ALL
      SELECT 'gate', NULL, NULL, count(*)::int, NULL
        FROM challenges
        WHERE district_code = ${district} AND status = 'PRIORITISED' AND severity >= 0.70
      UNION ALL
      SELECT 'total', NULL, NULL, count(*)::int, NULL FROM challenges WHERE district_code = ${district}
      UNION ALL
      SELECT 'breached', NULL, NULL, count(*)::int, NULL
        FROM challenges WHERE district_code = ${district} AND sla_breached_at IS NOT NULL
      UNION ALL
      SELECT 'deadlines', NULL, NULL, count(*)::int, NULL
        FROM sla_deadlines d JOIN challenges c ON c.id = d.challenge_id
        WHERE c.district_code = ${district} AND d.fired_at IS NULL AND d.cancelled_at IS NULL
    `),
    impactCounts(district),
  ]);

  const byBucket = (b: string) => counts.filter((r) => r.bucket === b);
  const scalar = (b: string) => Number(byBucket(b)[0]?.n ?? 0);

  const breaches = await execRaw<BreachRow>(sql`
    SELECT c.tracking_id, c.title, c.status,
           EXTRACT(DAY FROM (clock_now() - d.due_at))::int AS days_overdue,
           d.kind::text AS kind, d.due_at::text AS due_at
    FROM sla_deadlines d
    JOIN challenges c ON c.id = d.challenge_id
    WHERE c.district_code = ${district}
      AND d.cancelled_at IS NULL
      AND d.due_at <= clock_now()
      AND (d.fired_at IS NOT NULL OR d.fired_at IS NULL)
      AND c.sla_breached_at IS NOT NULL
    ORDER BY days_overdue DESC
    LIMIT 25
  `);

  const points = await execRaw<MapRow>(sql`
    SELECT tracking_id, title, lat::text AS lat, lng::text AS lng, priority_score::text AS priority_score
    FROM challenges
    WHERE district_code = ${district} AND lat IS NOT NULL AND lng IS NOT NULL
    ORDER BY priority_score DESC NULLS LAST
    LIMIT 300
  `);

  const heis = await execRaw<HeiRow>(sql`
    SELECT o.id AS org_id, o.name,
           count(*) FILTER (WHERE r.id IS NOT NULL)::int AS offered,
           count(*) FILTER (WHERE r.state = 'CLAIMED')::int AS claimed,
           count(*) FILTER (WHERE c.status IN ('SOLUTION_PUBLISHED','IMPLEMENTED','CITIZEN_VERIFIED','CLOSED'))::int AS delivered,
           count(*) FILTER (WHERE c.sla_breached_at IS NOT NULL)::int AS breached
    FROM routes r
    JOIN organization o ON o.id = r.org_id
    JOIN challenges c ON c.id = r.challenge_id
    WHERE c.district_code = ${district}
    GROUP BY o.id, o.name
    ORDER BY offered DESC, o.name
    LIMIT 20
  `);

  const gateCount = scalar("gate");

  return (
    <RoleShell
      title={`District dashboard — ${district}`}
      subtitle={`Signed in as ${user.fullName}. Every query on this page is scoped to ${district} on the server, not in the navigation.`}
    >
      <div className="space-y-8">
        {/* The two things a Collector opens this page for. */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Link href="/gov/gate" className="rounded-lg border border-amber-300 bg-amber-50 p-4 transition hover:border-amber-500">
            <p className="text-3xl font-bold tabular-nums text-amber-900">{gateCount}</p>
            <p className="mt-1 text-sm font-semibold text-amber-900">Waiting for your decision</p>
            <p className="mt-1 text-xs text-amber-800">
              Severity at or above 0.70. Nothing has been sent to any institution and nothing will be
              until you confirm it. Open the human gate →
            </p>
          </Link>

          <Link href="/gov/sla" className="rounded-lg border border-red-300 bg-red-50 p-4 transition hover:border-red-500">
            <p className="text-3xl font-bold tabular-nums text-red-900">{scalar("breached")}</p>
            <p className="mt-1 text-sm font-semibold text-red-900">SLA breaches</p>
            <p className="mt-1 text-xs text-red-800">
              Challenges nobody claimed inside twenty-one days. Full history and per-institution
              performance →
            </p>
          </Link>

          <div className="rounded-lg border border-border p-4">
            <p className="text-3xl font-bold tabular-nums">{scalar("total")}</p>
            <p className="mt-1 text-sm font-semibold">Reports from this district</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {scalar("deadlines")} open SLA deadlines. Every non-terminal challenge has at least one,
              which is how nothing here can die quietly.
            </p>
          </div>
        </section>

        {/* Invariant 7, in the place an official would otherwise round it up. */}
        <section>
          <h2 className="text-lg font-semibold">Impact in {district}</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            The counter moves when the person who reported the problem says it is fixed. Not when a
            solution is published, not when it is funded, and not when an implementer says so.
          </p>
          <ImpactCounter counts={impact} scopeLabel={district} />
          <div className="mt-3">
            <ConfirmationGap counts={impact} />
          </div>
        </section>

        {/* Breaches, most overdue first, as the task list they are. */}
        <section>
          <h2 className="text-lg font-semibold">Breaches, most overdue first</h2>
          {breaches.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              No SLA breaches in {district}. Every routed challenge was claimed inside its window.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Days overdue</th>
                    <th className="py-2 pr-3">Challenge</th>
                    <th className="py-2 pr-3">State</th>
                    <th className="py-2">Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((b) => (
                    <tr key={`${b.tracking_id}-${b.kind}`} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-lg font-bold tabular-nums text-red-700">{b.days_overdue}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/c/${b.tracking_id}`} className="font-medium underline-offset-4 hover:underline">
                          {b.title}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{b.tracking_id}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{STATUS_LABEL[b.status]}</td>
                      <td className="py-2 text-xs text-muted-foreground">{b.kind.replace(/_/g, " ").toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Counts by status, every one clickable through to the list. */}
        <section>
          <h2 className="text-lg font-semibold">Where everything is</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byBucket("status")
              .sort((a, b) => b.n - a.n)
              .map((r) => (
                <li key={r.k}>
                  <Link
                    href={`/challenges?district=${district}&status=${r.k}`}
                    className="flex items-baseline justify-between rounded-md border border-border px-3 py-2 text-sm transition hover:border-primary"
                  >
                    <span>{STATUS_LABEL[r.k as ChallengeStatus] ?? r.k}</span>
                    <span className="text-lg font-bold tabular-nums">{r.n}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>

        {/* The map. Colour is priority; the list above carries the numbers. */}
        <section>
          <h2 className="text-lg font-semibold">The district, coloured by priority</h2>
          <p className="mb-2 mt-1 text-xs text-muted-foreground">
            Darker is higher priority. Every marker links to the challenge, and every score on that
            page opens its own breakdown.
          </p>
          <div className="h-[24rem] overflow-hidden rounded-lg border border-border">
            <MilanMap
              ariaLabel={`Challenges in district ${district}, coloured by priority`}
              markers={points.map((p) => ({
                id: p.tracking_id,
                lat: Number(p.lat),
                lng: Number(p.lng),
                label: `${p.title} — ${p.priority_score ? Number(p.priority_score).toFixed(3) : "unscored"}`,
                href: `/c/${p.tracking_id}`,
                colour: priorityColour(p.priority_score === null ? null : Number(p.priority_score)),
              }))}
            />
          </div>
        </section>

        {/* Institutional SLA visibility: who is actually delivering. */}
        <section>
          <h2 className="text-lg font-semibold">Institutional performance in {district}</h2>
          <p className="mb-2 mt-1 text-xs text-muted-foreground">
            Offered, claimed, delivered and breached, per institution. This is the number a
            Vice-Chancellor will want to argue with, which is exactly why it is on the Collector&rsquo;s page.
          </p>
          {heis.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              Nothing has been routed to an institution from this district yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Institution</th>
                    <th className="py-2 pr-3 text-right">Offered</th>
                    <th className="py-2 pr-3 text-right">Claimed</th>
                    <th className="py-2 pr-3 text-right">Delivered</th>
                    <th className="py-2 text-right">Breached</th>
                  </tr>
                </thead>
                <tbody>
                  {heis.map((h) => (
                    <tr key={h.org_id} className="border-b border-border/60">
                      <td className="py-2 pr-3">{h.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.offered}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.claimed}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.delivered}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-red-700">{h.breached}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex flex-wrap gap-2">
          <Link href={`/api/gov/export?district=${district}`} className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Export CSV for the district disaster management plan
          </Link>
          <Link href="/gov/verification" className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold">
            Field verification tasks
          </Link>
          <Link href="/gov/emergency" className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold">
            Emergency filter
          </Link>
        </section>
      </div>
    </RoleShell>
  );
}
