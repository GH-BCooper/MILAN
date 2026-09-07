/**
 * /admin/stats — headline counts only (item 9a).
 *
 * Numbers, not names: how many reports, how many accounts by role, and how many
 * accounts sit against each university and each firm. Nothing here identifies a
 * citizen; the point is volume, not surveillance.
 */
import { asc, count, eq, sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { challenges, organisationsMeta, organization, userProfiles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stats" };

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="milan-glass rounded-xl p-5">
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function AdminStatsPage() {
  await requireRole("ADMIN");

  const [totalChallenges, challengesByStatus, byRole, orgCounts] = await Promise.all([
    db.select({ n: count() }).from(challenges),
    db
      .select({ status: challenges.status, n: count() })
      .from(challenges)
      .groupBy(challenges.status),
    db
      .select({ role: userProfiles.role, n: count() })
      .from(userProfiles)
      .groupBy(userProfiles.role),
    db
      .select({
        name: organization.name,
        orgType: organisationsMeta.orgType,
        members: sql<number>`count(${userProfiles.userId})`.mapWith(Number),
      })
      .from(organization)
      .leftJoin(organisationsMeta, eq(organisationsMeta.orgId, organization.id))
      .leftJoin(userProfiles, eq(userProfiles.orgId, organization.id))
      .groupBy(organization.id, organization.name, organisationsMeta.orgType)
      .orderBy(asc(organization.name)),
  ]);

  const roleN = (r: string) => byRole.find((x) => x.role === r)?.n ?? 0;
  const unis = orgCounts.filter((o) => o.orgType === "HEI");
  const firms = orgCounts.filter((o) => o.orgType === "INDUSTRY");

  return (
    <RoleShell title="Platform statistics" subtitle="Counts only. No citizen is identified here.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Reports submitted" value={totalChallenges[0]?.n ?? 0} />
        <Stat label="Citizen accounts" value={roleN("CITIZEN")} />
        <Stat label="University accounts" value={roleN("HEI_MEMBER")} />
        <Stat label="Industry accounts" value={roleN("INDUSTRY")} />
        <Stat label="Government accounts" value={roleN("GOVERNMENT")} />
        <Stat label="Admin accounts" value={roleN("ADMIN")} />
        <Stat label="Registered universities" value={unis.length} />
        <Stat label="Registered firms" value={firms.length} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Reports by status</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {challengesByStatus
          .slice()
          .sort((a, b) => b.n - a.n)
          .map((s) => (
            <div key={s.status} className="milan-glass flex items-center justify-between rounded-lg px-4 py-3 text-sm">
              <span>{s.status.replaceAll("_", " ")}</span>
              <span className="font-semibold tabular-nums">{s.n}</span>
            </div>
          ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Accounts per university</h2>
      <ul className="mt-3 divide-y divide-border milan-glass rounded-xl">
        {unis.map((o) => (
          <li key={o.name} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{o.name}</span>
            <span className="font-semibold tabular-nums">{o.members}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-semibold">Accounts per firm</h2>
      <ul className="mt-3 divide-y divide-border milan-glass rounded-xl">
        {firms.map((o) => (
          <li key={o.name} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{o.name}</span>
            <span className="font-semibold tabular-nums">{o.members}</span>
          </li>
        ))}
      </ul>
    </RoleShell>
  );
}
