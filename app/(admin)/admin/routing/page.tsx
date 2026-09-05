/**
 * /admin/routing — what the match score decided, and the override.
 *
 * Two things on one page: the current shortlist for every routed challenge, so
 * a bad match is visible rather than buried, and the control to fix it. Every
 * override demands a written reason and lands in `training_corrections`
 * alongside the classification corrections.
 */
import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { ClaimCountdown } from "@/components/claim-countdown";
import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import {
  capabilities,
  challenges,
  districts,
  organisationsMeta,
  organization,
  routes,
  trainingCorrections,
} from "@/lib/db/schema";
import { MATCH_WEIGHTS } from "@/lib/ai/routing";
import type { ChallengeStatus } from "@/lib/db/schema";
import { RerouteForm } from "./reroute-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Routing" };

export default async function AdminRouting() {
  const user = await requireRole("ADMIN");

  const serverNow = clockNow().toISOString();

  const offers = await db
    .select({
      routeId: routes.id,
      challengeId: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      status: challenges.status,
      severity: challenges.severity,
      priorityScore: challenges.priorityScore,
      districtName: districts.name,
      rank: routes.rank,
      matchScore: routes.matchScore,
      reasonText: routes.reasonText,
      reasonTerms: routes.reasonTerms,
      state: routes.state,
      notifiedAt: routes.notifiedAt,
      claimWindowEndsAt: routes.claimWindowEndsAt,
      orgName: organization.name,
      department: capabilities.department,
    })
    .from(routes)
    .innerJoin(challenges, eq(challenges.id, routes.challengeId))
    .innerJoin(organization, eq(organization.id, routes.orgId))
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .leftJoin(capabilities, eq(capabilities.id, routes.capabilityId))
    .where(inArray(routes.state, ["OFFERED", "CLAIMED"]))
    .orderBy(desc(challenges.priorityScore), routes.rank);

  const allCapabilities = await db
    .select({
      id: capabilities.id,
      department: capabilities.department,
      labName: capabilities.labName,
      declaredCapacity: capabilities.declaredCapacity,
      orgName: organization.name,
    })
    .from(capabilities)
    .innerJoin(organization, eq(organization.id, capabilities.orgId))
    .leftJoin(organisationsMeta, eq(organisationsMeta.orgId, capabilities.orgId))
    .where(and(eq(capabilities.active, true), eq(organisationsMeta.orgType, "HEI")))
    .orderBy(organization.name, capabilities.department);

  const overrides = await db
    .select({
      id: trainingCorrections.id,
      reason: trainingCorrections.reason,
      corrected: trainingCorrections.corrected,
      createdAt: trainingCorrections.createdAt,
      trackingId: challenges.trackingId,
    })
    .from(trainingCorrections)
    .leftJoin(challenges, eq(challenges.id, trainingCorrections.challengeId))
    .where(eq(trainingCorrections.stage, "S5_ROUTING"))
    .orderBy(desc(trainingCorrections.createdAt))
    .limit(10);

  // Group by challenge so a shortlist reads as a shortlist, not as three rows.
  const byChallenge = new Map<string, typeof offers>();
  for (const offer of offers) {
    const list = byChallenge.get(offer.challengeId) ?? [];
    list.push(offer);
    byChallenge.set(offer.challengeId, list);
  }

  const capabilityOptions = allCapabilities.map((c) => ({
    id: c.id,
    label: `${c.orgName} — ${c.department}${c.labName ? ` · ${c.labName}` : ""} (${c.declaredCapacity} slots)`,
  }));

  const [counts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(routes)
    .where(eq(routes.state, "OFFERED"));

  return (
    <RoleShell
      title="Routing"
      subtitle={`Signed in as ${user.fullName}. ${counts?.n ?? 0} open offer${(counts?.n ?? 0) === 1 ? "" : "s"} across ${byChallenge.size} challenge${byChallenge.size === 1 ? "" : "s"}.`}
    >
      <p className="rounded-lg border border-border bg-muted p-4 text-sm">
        Matches are scored on five signals — semantic fit {Math.round(MATCH_WEIGHTS.semantic * 100)}%,
        tag overlap {Math.round(MATCH_WEIGHTS.tagOverlap * 100)}%, distance{" "}
        {Math.round(MATCH_WEIGHTS.distance * 100)}%, declared capacity{" "}
        {Math.round(MATCH_WEIGHTS.capacity * 100)}%, track record{" "}
        {Math.round(MATCH_WEIGHTS.trackRecord * 100)}% — and the model only writes the sentence
        around the top three terms. When the score gets it wrong, override it here. Every override
        needs a written reason, and it becomes labelled data the same way a triage correction does.
      </p>

      {byChallenge.size === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing is currently routed. Run the pipeline over a challenge and its shortlist appears
          here.
        </p>
      ) : (
        <ol className="mt-6 space-y-4">
          {[...byChallenge.values()].map((group) => {
            const head = group[0];
            const gated = group.every((g) => g.notifiedAt === null && g.state === "OFFERED");
            return (
              <li key={head.challengeId} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link
                      href={`/c/${head.trackingId}`}
                      className="font-mono text-xs text-primary underline underline-offset-4"
                    >
                      {head.trackingId}
                    </Link>
                    <h2 className="mt-0.5 font-medium">{head.title}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={head.status as ChallengeStatus} />
                    {head.priorityScore !== null ? (
                      <span className="text-sm font-semibold tabular-nums">
                        priority {Number(head.priorityScore).toFixed(1)}
                      </span>
                    ) : null}
                    {head.claimWindowEndsAt ? (
                      <ClaimCountdown endsAt={head.claimWindowEndsAt.toISOString()}
                        serverNow={serverNow} className="text-sm" />
                    ) : null}
                  </div>
                </div>

                {gated ? (
                  <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    Held at the human gate — severity {head.severity ? Number(head.severity).toFixed(2) : "—"}.
                    Nothing has been notified. A District Collector releases it at /gov/gate.
                  </p>
                ) : null}

                <ol className="mt-3 space-y-2">
                  {group.map((offer) => (
                    <li key={offer.routeId} className="rounded border border-border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">
                          <span className="me-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            #{offer.rank}
                          </span>
                          {offer.orgName}
                          {offer.department ? (
                            <span className="text-muted-foreground"> — {offer.department}</span>
                          ) : null}
                        </p>
                        <span className="font-mono text-xs text-muted-foreground">
                          {offer.state.toLowerCase()} ·{" "}
                          {offer.matchScore === null
                            ? "manual"
                            : `match ${Number(offer.matchScore).toFixed(3)}`}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{offer.reasonText}</p>
                    </li>
                  ))}
                </ol>

                <div className="mt-3">
                  <RerouteForm
                    challengeId={head.challengeId}
                    trackingId={head.trackingId}
                    capabilities={capabilityOptions}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {overrides.length > 0 ? (
        <section className="mt-10" aria-labelledby="overrides-heading">
          <h2
            id="overrides-heading"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Recent routing overrides
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {overrides.map((o) => (
              <li key={o.id} className="p-3">
                <p className="font-mono text-xs text-muted-foreground">{o.trackingId}</p>
                <p className="mt-0.5 text-sm">{o.reason}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(o.corrected)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </RoleShell>
  );
}
