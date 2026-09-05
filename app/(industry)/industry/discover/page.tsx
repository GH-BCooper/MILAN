import Link from "next/link";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { UnconfirmedTag } from "@/components/impact-counter";
import { STATUS_LABEL } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { execRaw } from "@/lib/db/raw";
import { domainEnum, hazardEnum, type ChallengeStatus } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discover" };

/**
 * What a firm can see.
 *
 * Only public metadata for a restricted artifact: title, the problem it answers
 * and the abstract. That is not a courtesy, it is the rule from Task 3.5 — a
 * restricted licence restricts the file, never the knowledge that the work
 * exists — and this page is where it would be tempting to break it.
 *
 * Nothing here is sorted by "impact" in a way that lets an unconfirmed claim
 * look like a delivered one. Unconfirmed rows carry the grey tag.
 */
interface Row extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  status: ChallengeStatus;
  district_name: string | null;
  domain: string | null;
  hazard: string | null;
  solvability: string | null;
  priority_score: string | null;
  impact_confirmed: boolean;
  impact_partial: boolean;
  org_name: string | null;
  artifact_count: number;
  restricted_count: number;
  abstract: string | null;
}

export default async function IndustryDiscover({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("INDUSTRY", "ADMIN");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]) || undefined;
  const district = one("district");
  const domain = one("domain");
  const hazard = one("hazard");
  const solvability = one("solvability");

  const rows = await execRaw<Row>(sql`
    SELECT c.tracking_id, c.title, c.status, d.name AS district_name,
           c.domain::text AS domain, c.hazard::text AS hazard, c.solvability,
           c.priority_score::text AS priority_score,
           c.impact_confirmed, c.impact_partial,
           o.name AS org_name,
           (SELECT count(*)::int FROM artifacts a WHERE a.project_id = p.id) AS artifact_count,
           (SELECT count(*)::int FROM artifacts a WHERE a.project_id = p.id AND a.licence = 'RESTRICTED') AS restricted_count,
           (SELECT a.abstract FROM artifacts a WHERE a.project_id = p.id ORDER BY a.published_at DESC LIMIT 1) AS abstract
    FROM challenges c
    LEFT JOIN districts d ON d.code = c.district_code
    LEFT JOIN projects p ON p.challenge_id = c.id
    LEFT JOIN organization o ON o.id = p.org_id
    WHERE c.status IN ('SOLUTION_PUBLISHED','INDUSTRY_INTEREST','AGREEMENT_SIGNED','PILOT','IMPLEMENTED','CITIZEN_VERIFIED','CLOSED','IN_RESEARCH','BOUNTY_LISTED','UNCLAIMED_ESCALATED','ROUTED')
      ${district ? sql`AND c.district_code = ${district}` : sql``}
      ${domain ? sql`AND c.domain::text = ${domain}` : sql``}
      ${hazard ? sql`AND c.hazard::text = ${hazard}` : sql``}
      ${solvability ? sql`AND c.solvability = ${solvability}` : sql``}
    ORDER BY c.priority_score DESC NULLS LAST
    LIMIT 100
  `);

  const districts = await execRaw<{ code: string; name: string }>(sql`SELECT code, name FROM districts ORDER BY name`);

  return (
    <RoleShell
      title="Discover"
      subtitle={`Signed in as ${user.fullName}. ${rows.length} challenge${rows.length === 1 ? "" : "s"} and published solutions, filterable by domain, solvability, district and NDMA hazard.`}
    >
      <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs font-medium">
          District
          <select name="district" defaultValue={district ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Every district</option>
            {districts.map((d) => (
              <option key={d.code} value={d.code}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Domain
          <select name="domain" defaultValue={domain ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Every domain</option>
            {domainEnum.enumValues.map((d) => (
              <option key={d} value={d}>{d.replace(/_/g, " ").toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          NDMA hazard
          <select name="hazard" defaultValue={hazard ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Every hazard</option>
            {hazardEnum.enumValues.map((h) => (
              <option key={h} value={h}>{h.replace(/_/g, " ").toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Solvability / TRL
          <select name="solvability" defaultValue={solvability ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Any</option>
            <option value="RESEARCH">Research question</option>
            <option value="ENGINEERING">Engineering build</option>
            <option value="CAPITAL_WORKS">Capital works</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Filter</button>
          <Link href="/industry/discover" className="h-11 rounded-md border border-input px-4 text-sm font-semibold leading-[2.75rem]">
            Clear
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          Nothing matches that filter yet. Try clearing it — the platform is small and honest about it
          rather than padded with examples.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li key={r.tracking_id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/industry/challenges/${r.tracking_id}`} className="text-base font-semibold underline-offset-4 hover:underline">
                    {r.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.tracking_id} · {r.district_name ?? "unlocated"} ·{" "}
                    {(r.domain ?? "unclassified").replace(/_/g, " ").toLowerCase()}
                    {r.hazard && r.hazard !== "NONE" ? ` · ${r.hazard.replace(/_/g, " ").toLowerCase()}` : ""}
                    {r.org_name ? ` · ${r.org_name}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold tabular-nums">{r.priority_score ? Number(r.priority_score).toFixed(3) : "—"}</p>
                  <span className="text-xs text-muted-foreground">{STATUS_LABEL[r.status]}</span>
                </div>
              </div>

              {r.abstract ? <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{r.abstract}</p> : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {r.artifact_count > 0 ? (
                  <span className="rounded bg-muted px-2 py-1">
                    {r.artifact_count} artifact{r.artifact_count === 1 ? "" : "s"}
                    {r.restricted_count > 0 ? ` · ${r.restricted_count} restricted (metadata only until the lead grants you access)` : ""}
                  </span>
                ) : null}
                {["IMPLEMENTED", "INDUSTRY_INTEREST", "AGREEMENT_SIGNED", "PILOT"].includes(r.status) && !r.impact_confirmed ? (
                  <UnconfirmedTag />
                ) : null}
                {r.impact_confirmed ? (
                  <span className={`rounded px-2 py-1 font-medium ${r.impact_partial ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                    {r.impact_partial ? "citizen says partly fixed" : "confirmed fixed by the citizen"}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 rounded-lg border border-border bg-muted p-4 text-sm">
        <span className="font-semibold">A legal entity is needed to receive money, not to participate.</span>{" "}
        An individual can claim a challenge here as an independent innovator, with personal credit only.
        Their employer is never named on the credit chain unless they ask for it to be.
      </p>
    </RoleShell>
  );
}
