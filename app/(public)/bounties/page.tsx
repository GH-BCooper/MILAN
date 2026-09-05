import Link from "next/link";
import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { STATUS_LABEL } from "@/components/status-badge";
import { execRaw } from "@/lib/db/raw";
import { clockNow } from "@/lib/clock";
import { syncClockOffset } from "@/lib/clock/server";
import type { ChallengeStatus } from "@/lib/db/schema";

export const metadata = { title: "Bounties" };
export const dynamic = "force-dynamic";

/**
 * The bounty board.
 *
 * A challenge arrives here because a clock ran out in public: it was offered,
 * nobody claimed it, the offer was widened, it was opened to everyone, and at
 * twenty-one days it breached. Every row therefore carries the thing a judge
 * will ask for — how long it has been unclaimed, which rung it is on, and the
 * priority score with its breakdown one click away.
 *
 * "Discovery is never luck." This page is what that sentence looks like when
 * the push has already failed.
 */

interface Row extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  status: ChallengeStatus;
  district_code: string | null;
  district_name: string | null;
  domain: string | null;
  hazard: string | null;
  priority_score: string | null;
  escalation_stage: string | null;
  grand_challenge: boolean;
  open_to_all: boolean;
  sla_breached_at: string | null;
  routed_at: string | null;
  days_unclaimed: number | null;
  corroboration_count: number;
  top_terms: Array<{ key: string; weight: number; value: number; contribution: number }> | null;
}

const STAGE_LABEL: Record<string, string> = {
  WIDEN: "Widened to five more institutions",
  OPEN_ALL: "Open to every institution in Jharkhand",
  BREACH: "SLA breached",
  GRAND_CHALLENGE: "Jharkhand Grand Challenge",
};

const STAGE_ORDER = ["WIDEN", "OPEN_ALL", "BREACH", "GRAND_CHALLENGE"];

function Filters({
  districts,
  domains,
  hazards,
  current,
}: {
  districts: Array<{ code: string; name: string }>;
  domains: string[];
  hazards: string[];
  current: Record<string, string | undefined>;
}) {
  return (
    <form className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
      <label className="flex flex-col gap-1 text-xs font-medium">
        District
        <select name="district" defaultValue={current.district ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Every district</option>
          {districts.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Domain
        <select name="domain" defaultValue={current.domain ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Every domain</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        NDMA hazard
        <select name="hazard" defaultValue={current.hazard ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Every hazard</option>
          {hazards.map((h) => (
            <option key={h} value={h}>
              {h.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Escalation stage
        <select name="stage" defaultValue={current.stage ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Any stage</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Set
        <select name="set" defaultValue={current.set ?? ""} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Everything unclaimed</option>
          <option value="grand">Jharkhand Grand Challenges</option>
        </select>
      </label>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
        <button type="submit" className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Apply filters
        </button>
        <Link href="/bounties" className="h-11 rounded-md border border-input px-4 text-sm font-semibold leading-[2.75rem]">
          Clear
        </Link>
      </div>
    </form>
  );
}

export default async function BountiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]) || undefined;
  const district = one("district");
  const domain = one("domain");
  const hazard = one("hazard");
  const stage = one("stage");
  const set = one("set");

  await syncClockOffset();
  const now = clockNow();

  const rows = await execRaw<Row>(sql`
    SELECT c.tracking_id, c.title, c.status, c.district_code, d.name AS district_name,
           c.domain::text AS domain, c.hazard::text AS hazard, c.priority_score,
           c.escalation_stage, c.grand_challenge, c.open_to_all,
           c.sla_breached_at::text AS sla_breached_at, c.routed_at::text AS routed_at,
           c.corroboration_count,
           EXTRACT(DAY FROM (clock_now() - COALESCE(c.routed_at, c.created_at)))::int AS days_unclaimed,
           (c.priority_breakdown -> 'terms') AS top_terms
    FROM challenges c
    LEFT JOIN districts d ON d.code = c.district_code
    WHERE (c.status IN ('BOUNTY_LISTED', 'UNCLAIMED_ESCALATED') OR c.open_to_all OR c.grand_challenge)
      AND c.status NOT IN ('CLAIMED','CLOSED','MERGED','WITHDRAWN','REJECTED_UNSAFE','FORWARDED_EXTERNAL')
      ${district ? sql`AND c.district_code = ${district}` : sql``}
      ${domain ? sql`AND c.domain::text = ${domain}` : sql``}
      ${hazard ? sql`AND c.hazard::text = ${hazard}` : sql``}
      ${stage ? sql`AND c.escalation_stage = ${stage}` : sql``}
      ${set === "grand" ? sql`AND c.grand_challenge` : sql``}
    ORDER BY c.priority_score DESC NULLS LAST, c.created_at
    LIMIT 200
  `);

  const facets = await execRaw<{ kind: string; code: string; name: string | null }>(sql`
    SELECT 'district' AS kind, code, name FROM districts
    UNION ALL SELECT 'domain', unnest(enum_range(NULL::domain))::text, NULL
    UNION ALL SELECT 'hazard', unnest(enum_range(NULL::hazard))::text, NULL
    ORDER BY 1, 3 NULLS LAST, 2
  `);

  const districts = facets.filter((f) => f.kind === "district").map((f) => ({ code: f.code, name: f.name ?? f.code }));
  const domains = facets.filter((f) => f.kind === "domain").map((f) => f.code);
  const hazards = facets.filter((f) => f.kind === "hazard").map((f) => f.code);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Bounty board</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Every problem here was pushed to matched departments first. Nobody claimed it, so a clock
          escalated it in public: widened at seven days, opened to everyone at fourteen, and recorded
          as an SLA breach at twenty-one. Nothing on this page arrived by someone forgetting about it.
        </p>

        <Filters districts={districts} domains={domains} hazards={hazards} current={{ district, domain, hazard, stage, set }} />

        <p className="mt-6 text-sm text-muted-foreground">
          <span className="text-2xl font-bold tabular-nums text-foreground">{rows.length}</span> challenge
          {rows.length === 1 ? "" : "s"} open to claim
          {set === "grand" ? " in the Jharkhand Grand Challenges set" : ""}.
        </p>

        {rows.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-muted p-6">
            <p className="text-sm font-semibold">Nothing is unclaimed right now.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              That is the good outcome: every routed challenge was claimed inside its window. A
              challenge appears here only when the SLA ladder escalates one — you can watch that
              happen on the demo console by moving the clock forward.
            </p>
            <Link href="/challenges" className="mt-3 inline-block text-sm text-primary underline underline-offset-4">
              Browse every challenge instead
            </Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {rows.map((r) => {
              const terms = Array.isArray(r.top_terms)
                ? [...r.top_terms].sort((a, b) => b.contribution - a.contribution).slice(0, 3)
                : [];
              return (
                <li key={r.tracking_id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/c/${r.tracking_id}`} className="text-base font-semibold underline-offset-4 hover:underline">
                        {r.title}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.tracking_id} · {r.district_name ?? r.district_code ?? "unlocated"} ·{" "}
                        {(r.domain ?? "unclassified").replace(/_/g, " ").toLowerCase()} ·{" "}
                        {r.hazard && r.hazard !== "NONE" ? `NDMA hazard: ${r.hazard.replace(/_/g, " ").toLowerCase()}` : "no hazard linkage"} ·{" "}
                        {r.corroboration_count} reporter{r.corroboration_count === 1 ? "" : "s"}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-2xl font-bold tabular-nums">{r.priority_score ? Number(r.priority_score).toFixed(3) : "—"}</p>
                      <Link href={`/c/${r.tracking_id}#priority`} className="text-xs text-primary underline underline-offset-4">
                        see the breakdown
                      </Link>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-red-100 px-2 py-1 font-semibold text-red-900">
                      {r.days_unclaimed ?? 0} day{r.days_unclaimed === 1 ? "" : "s"} unclaimed
                    </span>
                    <span className="rounded bg-muted px-2 py-1 font-medium">{STATUS_LABEL[r.status]}</span>
                    {r.escalation_stage ? (
                      <span className="rounded bg-amber-100 px-2 py-1 font-medium text-amber-900">
                        {STAGE_LABEL[r.escalation_stage] ?? r.escalation_stage}
                      </span>
                    ) : null}
                    {r.grand_challenge ? (
                      <span className="rounded bg-indigo-100 px-2 py-1 font-semibold text-indigo-900">
                        Jharkhand Grand Challenge
                      </span>
                    ) : null}
                    {r.sla_breached_at ? (
                      <span className="rounded bg-red-600 px-2 py-1 font-semibold text-white">
                        breached {new Date(r.sla_breached_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString().slice(0, 10)}
                      </span>
                    ) : null}
                  </div>

                  {terms.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Scored mostly on{" "}
                      {terms.map((t, i) => (
                        <span key={t.key}>
                          {i > 0 ? ", " : ""}
                          <span className="font-medium text-foreground">{t.key.replace(/([A-Z])/g, " $1").toLowerCase()}</span> (
                          {t.weight} × {Number(t.value).toFixed(2)} = {Number(t.contribution).toFixed(3)})
                        </span>
                      ))}
                      .
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={`/hei/challenges/${r.tracking_id}/claim`}
                      className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
                    >
                      Claim this challenge
                    </Link>
                    <Link
                      href={`/c/${r.tracking_id}`}
                      className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold"
                    >
                      Read the original report
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-xs text-muted-foreground">
          Page rendered at {now.toISOString().slice(0, 16).replace("T", " ")} UTC, Milan time. Days
          unclaimed are measured against the same clock the SLA reaper uses.
        </p>
      </main>
    </>
  );
}
