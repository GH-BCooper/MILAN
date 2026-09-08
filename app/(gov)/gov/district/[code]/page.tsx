import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { challenges, districts, slaDeadlines } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "District" };

/**
 * A district, from the government's side of the wall.
 *
 * The reference card names what the district IS (division, population,
 * internet reach, tribal share, need index); the three boards
 * name what it owes right now: the SLA clocks ticking, the severity gate
 * queue, and the delivered work awaiting a citizen's confirmation. Every
 * number links through to the filtered public list so nothing on this page
 * is a dead end.
 */
export default async function DistrictPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const upper = code.toUpperCase();

  const user = await requireUser();
  const scoped = user.role === "ADMIN" || user.districtCode === upper;

  // A refusal is a server-side decision, so it is rendered server-side: thrown
  // through the router's error channel it surfaced as a stuck "Loading…" shell
  // (G-01). A calm panel with no data leak is the whole page here.
  if (!scoped) {
    return (
      <RoleShell title="District" subtitle={upper}>
        <div className="milan-glass rounded-xl p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Refused
          </p>
          <h1 className="mt-2 text-xl font-bold">That district is not yours.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is scoped to district {upper}. You are signed in for{" "}
            {user.districtCode ?? "no district"}, so there is nothing to show here. Nothing was
            changed.
          </p>
          <Link
            href="/gov"
            className="mt-4 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Back to your district
          </Link>
        </div>
      </RoleShell>
    );
  }

  const [district] = await db.select().from(districts).where(eq(districts.code, upper)).limit(1);
  if (!district) notFound();

  const [statusRows, openDeadlines, gateQueue, verificationQueue] = await Promise.all([
    db
      .select({ status: challenges.status, n: sql<number>`count(*)::int` })
      .from(challenges)
      .where(eq(challenges.districtCode, upper))
      .groupBy(challenges.status)
      .orderBy(desc(sql`count(*)`)),

    db
      .select({
        id: slaDeadlines.id,
        kind: slaDeadlines.kind,
        dueAt: slaDeadlines.dueAt,
        trackingId: challenges.trackingId,
        title: challenges.title,
        status: challenges.status,
      })
      .from(slaDeadlines)
      .innerJoin(challenges, eq(challenges.id, slaDeadlines.challengeId))
      .where(
        and(
          eq(challenges.districtCode, upper),
          isNull(slaDeadlines.firedAt),
          isNull(slaDeadlines.cancelledAt),
        ),
      )
      .orderBy(asc(slaDeadlines.dueAt))
      .limit(8),

    db
      .select({
        trackingId: challenges.trackingId,
        title: challenges.title,
        severity: challenges.severity,
        status: challenges.status,
      })
      .from(challenges)
      .where(and(eq(challenges.districtCode, upper), eq(challenges.status, "PRIORITISED")))
      .orderBy(desc(challenges.severity))
      .limit(6),

    db
      .select({
        trackingId: challenges.trackingId,
        title: challenges.title,
        updatedAt: challenges.updatedAt,
      })
      .from(challenges)
      .where(and(eq(challenges.districtCode, upper), eq(challenges.status, "IMPLEMENTED")))
      .orderBy(asc(challenges.updatedAt))
      .limit(6),
  ]);

  const totalChallenges = statusRows.reduce((sum, r) => sum + r.n, 0);

  return (
    <RoleShell title={district.name} subtitle={`${district.division ?? "Division not recorded"} · ${district.code}`}>
      {/* ------------------------------------------------ the reference card */}
      <section aria-labelledby="ref-heading" className="milan-glass rounded-xl p-5">
        <h2 id="ref-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The district in numbers
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Population</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {district.population === null ? "not recorded" : district.population.toLocaleString("en-IN")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Internet reach</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {district.internetPenetration === null
                ? "not recorded"
                : `${(Number(district.internetPenetration) * 100).toFixed(0)}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Scheduled Tribe share</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {district.tribalPopulationPct === null
                ? "not recorded"
                : `${Number(district.tribalPopulationPct).toFixed(1)}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tracking prefix</dt>
            <dd className="mt-1 font-mono text-lg font-semibold">JH-…-{district.code}-…</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Block need index{" "}
          {district.vulnerabilityIndex === null ? "not recorded" : Number(district.vulnerabilityIndex).toFixed(2)}{" "}
          (0–1, from the reference dataset) — the equity term in the priority score: an identical problem
          here {district.vulnerabilityIndex !== null && Number(district.vulnerabilityIndex) >= 0.6 ? "outranks" : "is scored against"} one in a better-served district.
        </p>
        <p className="mt-4 text-sm">
          <Link className="text-primary underline underline-offset-4" href={`/challenges?district=${district.code}`}>
            All {totalChallenges} challenge{totalChallenges === 1 ? "" : "s"} in this district
          </Link>
          {" · "}
          <Link
            className="text-primary underline underline-offset-4"
            href={`/challenges?district=${district.code}&band=intake`}
          >
            those still in intake
          </Link>
        </p>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ---------------------------------------------------- the SLA board */}
        <section aria-labelledby="sla-heading" className="milan-glass rounded-xl p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="sla-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Open SLA clocks
            </h2>
            <Link href="/gov/sla" className="text-xs text-primary underline underline-offset-4">
              the full board
            </Link>
          </div>
          {openDeadlines.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No open clock in this district. Nothing here arrives by someone forgetting about it —
              a clock opens the moment a challenge moves.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {openDeadlines.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <div className="min-w-0">
                    <Link
                      href={`/c/${d.trackingId}`}
                      className="font-mono text-xs text-primary underline underline-offset-4"
                    >
                      {d.trackingId}
                    </Link>{" "}
                    <span className="text-muted-foreground">{d.kind.replaceAll("_", " ").toLowerCase()}</span>
                  </div>
                  <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={d.dueAt.toISOString()}>
                    due{" "}
                    {d.dueAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* ---------------------------------------------------- the gate queue */}
          <section aria-labelledby="gate-heading" className="milan-glass rounded-xl p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="gate-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Waiting at your gate
              </h2>
              <Link href="/gov/gate" className="text-xs text-primary underline underline-offset-4">
                the gate queue
              </Link>
            </div>
            {gateQueue.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing waiting. When a report in this district scores at or above the severity gate,
                it appears here before anything is routed.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {gateQueue.map((g) => (
                  <li key={g.trackingId} className="border-b border-border pb-2 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/c/${g.trackingId}`}
                        className="font-mono text-xs text-primary underline underline-offset-4"
                      >
                        {g.trackingId}
                      </Link>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        severity {g.severity === null ? "?" : Number(g.severity).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-muted-foreground">{g.title}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------------------- the verification queue */}
          <section aria-labelledby="verify-heading" className="milan-glass rounded-xl p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="verify-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Delivered, awaiting the citizen&rsquo;s word
              </h2>
              <Link href="/gov/verification" className="text-xs text-primary underline underline-offset-4">
                verification
              </Link>
            </div>
            {verificationQueue.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing waiting on confirmation. Only the citizen&rsquo;s word counts as impact, and
                this list is where that word is chased.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {verificationQueue.map((v) => (
                  <li key={v.trackingId} className="border-b border-border pb-2 last:border-0">
                    <Link
                      href={`/c/${v.trackingId}`}
                      className="font-mono text-xs text-primary underline underline-offset-4"
                    >
                      {v.trackingId}
                    </Link>
                    <p className="mt-0.5 truncate text-muted-foreground">{v.title}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* -------------------------------------------------- the status ladder */}
      <section aria-labelledby="status-heading" className="milan-glass mt-6 rounded-xl p-5">
        <h2 id="status-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Every challenge here, by where it stands
        </h2>
        {statusRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No report has come in from this district yet. The first one will appear here and on the
            public board the moment it is filed.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {statusRows.map((s) => (
              <li key={s.status} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                <StatusBadge status={s.status} />
                <span className="tabular-nums text-muted-foreground">×{s.n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RoleShell>
  );
}
