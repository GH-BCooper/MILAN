import Link from "next/link";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { syncClockOffset } from "@/lib/clock/server";
import { execRaw } from "@/lib/db/raw";
import { GateForm } from "./gate-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Human gate" };

/**
 * The human gate.
 *
 * CLAUDE.md invariant 5: severity ≥ 0.7 routes here and waits for a human. This
 * page is the whole of "the AI never takes a consequential action alone" made
 * visible: the proposal, the reasoning it was allowed to write, the priority
 * breakdown with the arithmetic showing, the shortlist it would notify — and
 * three buttons, none of which the machine may press.
 *
 * Nothing has been sent when this page renders. `routes.notified_at` is null on
 * every row below, and it stays null until an officer confirms.
 */

interface GateRow extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  body_original: string;
  body_lang: string;
  body_en: string | null;
  framed_statement: string | null;
  district_code: string | null;
  district_name: string | null;
  block_code: string | null;
  domain: string | null;
  hazard: string | null;
  severity: string | null;
  priority_score: string | null;
  priority_breakdown: { terms?: Array<{ key: string; weight: number; value: number; contribution: number }>; total?: number; version?: string } | null;
  people_affected: number | null;
  corroboration_count: number;
  waiting_days: number;
  shortlist: Array<{ rank: number; org: string; reason: string; score: string | null; notified: string | null }> | null;
}

export default async function GatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");
  await syncClockOffset();
  const params = await searchParams;
  const focus = (Array.isArray(params.c) ? params.c[0] : params.c) || undefined;
  const district = user.districtCode;

  if (!district) {
    return (
      <RoleShell title="Human gate" subtitle="This account is not scoped to a district.">
        <p className="rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          The gate is district-scoped. An officer with no district would be an officer accountable for
          nowhere, so there is nothing to show.
        </p>
      </RoleShell>
    );
  }

  const rows = await execRaw<GateRow>(sql`
    SELECT c.tracking_id, c.title, c.body_original, c.body_lang, c.body_en, c.framed_statement,
           c.district_code, d.name AS district_name, c.block_code,
           c.domain::text AS domain, c.hazard::text AS hazard,
           c.severity::text AS severity, c.priority_score::text AS priority_score,
           c.priority_breakdown, c.people_affected, c.corroboration_count,
           EXTRACT(DAY FROM (clock_now() - c.updated_at))::int AS waiting_days,
           (SELECT json_agg(json_build_object(
                     'rank', r.rank, 'org', o.name, 'reason', r.reason_text,
                     'score', r.match_score::text, 'notified', r.notified_at::text)
                   ORDER BY r.rank)
              FROM routes r JOIN organization o ON o.id = r.org_id
             WHERE r.challenge_id = c.id AND r.state = 'OFFERED') AS shortlist
    FROM challenges c
    LEFT JOIN districts d ON d.code = c.district_code
    WHERE c.district_code = ${district}
      AND c.status = 'PRIORITISED'
      AND c.severity >= 0.70
      ${focus ? sql`AND c.tracking_id = ${focus}` : sql``}
    ORDER BY c.severity DESC NULLS LAST, c.created_at
  `);

  return (
    <RoleShell
      title="Human gate"
      subtitle={`${rows.length} high-severity challenge${rows.length === 1 ? "" : "s"} in ${district} waiting for a decision. Nothing below has been sent to any institution.`}
    >
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Why you are seeing these and not a machine&rsquo;s decision.</p>
        <p className="mt-1">
          Milan routes a challenge automatically below severity 0.70. At or above it, the shortlist is
          written but every notification is held with <code className="rounded bg-amber-100 px-1">notified_at = null</code> until
          a district officer confirms. Your override is recorded with your reason and becomes labelled
          training data — the system learns from you rather than from itself.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          Nothing is waiting for you. Every high-severity challenge in {district} has been through the
          gate. New ones appear here within seconds of being scored, and you are emailed and
          re-notified after three days if one is still sitting here.
        </p>
      ) : (
        <ul className="mt-6 space-y-6">
          {rows.map((r) => {
            const terms = r.priority_breakdown?.terms ?? [];
            const top = [...terms].sort((a, b) => b.contribution - a.contribution);
            return (
              <li key={r.tracking_id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/c/${r.tracking_id}`} className="text-base font-semibold underline-offset-4 hover:underline">
                      {r.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.tracking_id} · {r.district_name ?? r.district_code} · {r.block_code ?? "block unknown"} ·{" "}
                      waiting {r.waiting_days} day{r.waiting_days === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Severity</p>
                    <p className="text-2xl font-bold tabular-nums text-amber-700">
                      {r.severity ? Number(r.severity).toFixed(2) : "—"}
                    </p>
                  </div>
                </div>

                {/* Invariant 6. Same size, same weight, side by side, no toggle. */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      The citizen&rsquo;s own words ({r.body_lang})
                    </p>
                    <p className="mt-1 text-sm">{r.body_original}</p>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">English working copy</p>
                    <p className="mt-1 text-sm">
                      {r.body_en ?? <span className="text-muted-foreground">Not translated yet. The original above is what counts.</span>}
                    </p>
                  </div>
                </div>

                {r.framed_statement ? (
                  <p className="mt-3 rounded-md bg-muted p-3 text-sm">
                    <span className="font-semibold">Research framing the citizen approved: </span>
                    {r.framed_statement}
                  </p>
                ) : null}

                {/* The priority breakdown, with the arithmetic showing. Invariant 10. */}
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Priority {r.priority_score ? Number(r.priority_score).toFixed(3) : "—"}
                    {r.priority_breakdown?.version ? ` · weights ${r.priority_breakdown.version}` : ""}
                  </p>
                  <table className="mt-1 w-full text-xs">
                    <tbody>
                      {top.map((t) => (
                        <tr key={t.key} className="border-b border-border/50">
                          <td className="py-1 pr-2">{t.key.replace(/([A-Z])/g, " $1").toLowerCase()}</td>
                          <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                            {t.weight} × {Number(t.value).toFixed(3)}
                          </td>
                          <td className="py-1 text-right font-semibold tabular-nums">{Number(t.contribution).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link href={`/c/${r.tracking_id}#priority`} className="mt-1 inline-block text-xs text-primary underline underline-offset-4">
                    open the full public breakdown
                  </Link>
                </div>

                {/* The shortlist that will be notified — and has not been. */}
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Would be offered to
                  </p>
                  {r.shortlist && r.shortlist.length > 0 ? (
                    <ol className="mt-1 space-y-1 text-sm">
                      {r.shortlist.map((s) => (
                        <li key={s.rank} className="rounded-md border border-border p-2">
                          <span className="font-semibold">
                            {s.rank}. {s.org}
                          </span>
                          <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                            match {s.score ? Number(s.score).toFixed(3) : "—"}
                          </span>
                          <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${s.notified ? "bg-emerald-100 text-emerald-900" : "bg-neutral-100 text-neutral-600"}`}>
                            {s.notified ? "notified" : "not notified — held at this gate"}
                          </span>
                          <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">
                      No shortlist has been computed yet. Confirming will route it as soon as one is.
                    </p>
                  )}
                </div>

                <GateForm trackingId={r.tracking_id} severity={r.severity === null ? null : Number(r.severity)} />
              </li>
            );
          })}
        </ul>
      )}
    </RoleShell>
  );
}
