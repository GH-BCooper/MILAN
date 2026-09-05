import Link from "next/link";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { STATUS_LABEL } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { syncClockOffset } from "@/lib/clock/server";
import { execRaw } from "@/lib/db/raw";
import type { ChallengeStatus } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "SLA board" };

/**
 * The full breach history, and per-institution performance.
 *
 * The point of this page is not to shame anyone. It is that "every state has an
 * SLA with an automatic escalation" is a claim, and a claim needs a page where
 * it can be checked — including the rows where Milan's own escalation is what
 * failed to produce a claim.
 */
interface FiredRow extends Record<string, unknown> {
  kind: string;
  tracking_id: string;
  title: string;
  status: ChallengeStatus;
  due_at: string;
  fired_at: string | null;
  days_late: number | null;
}

interface OpenRow extends Record<string, unknown> {
  kind: string;
  n: number;
  next_due: string | null;
  overdue: number;
}

interface InstRow extends Record<string, unknown> {
  name: string;
  offered: number;
  claimed: number;
  delivered: number;
  released_undelivered: number;
  median_claim_hours: number | null;
}

export default async function SlaPage() {
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");
  await syncClockOffset();
  const district = user.districtCode;
  const scope = district ? sql`AND c.district_code = ${district}` : sql``;

  const [fired, open, institutions] = await Promise.all([
    execRaw<FiredRow>(sql`
      SELECT d.kind::text AS kind, c.tracking_id, c.title, c.status,
             d.due_at::text AS due_at, d.fired_at::text AS fired_at,
             EXTRACT(DAY FROM (d.fired_at - d.due_at))::int AS days_late
      FROM sla_deadlines d
      JOIN challenges c ON c.id = d.challenge_id
      WHERE d.fired_at IS NOT NULL ${scope}
      ORDER BY d.fired_at DESC
      LIMIT 60
    `),
    execRaw<OpenRow>(sql`
      SELECT d.kind::text AS kind, count(*)::int AS n,
             min(d.due_at)::text AS next_due,
             count(*) FILTER (WHERE d.due_at <= clock_now())::int AS overdue
      FROM sla_deadlines d
      JOIN challenges c ON c.id = d.challenge_id
      WHERE d.fired_at IS NULL AND d.cancelled_at IS NULL ${scope}
      GROUP BY d.kind
      ORDER BY overdue DESC, n DESC
    `),
    execRaw<InstRow>(sql`
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
      WHERE TRUE ${scope}
      GROUP BY o.name
      ORDER BY offered DESC, o.name
    `),
  ]);

  return (
    <RoleShell
      title="SLA board"
      subtitle={district ? `Every deadline that has fired in ${district}, and every one still running.` : "Every deadline that has fired, statewide."}
    >
      <div className="space-y-8">
        <section>
          <h2 className="text-lg font-semibold">Clocks currently running</h2>
          <p className="mb-2 mt-1 text-xs text-muted-foreground">
            Every non-terminal challenge has at least one open row here. That is enforced by a CI
            query, not by convention — if this table were ever empty while challenges were open, the
            build would fail.
          </p>
          {open.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              No open deadlines in scope.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Deadline</th>
                    <th className="py-2 pr-3 text-right">Open</th>
                    <th className="py-2 pr-3 text-right">Already overdue</th>
                    <th className="py-2">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((o) => (
                    <tr key={o.kind} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{o.kind.replace(/_/g, " ").toLowerCase()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{o.n}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${o.overdue > 0 ? "font-semibold text-red-700" : ""}`}>{o.overdue}</td>
                      <td className="py-2 text-xs text-muted-foreground">{o.next_due?.slice(0, 16) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold">Breach history</h2>
          {fired.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              Nothing has fired yet in scope. On the demo console you can move the clock forward and
              watch this fill.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Fired</th>
                    <th className="py-2 pr-3">Rung</th>
                    <th className="py-2 pr-3">Challenge</th>
                    <th className="py-2 pr-3">State now</th>
                    <th className="py-2 text-right">Days late</th>
                  </tr>
                </thead>
                <tbody>
                  {fired.map((f, i) => (
                    <tr key={`${f.tracking_id}-${f.kind}-${i}`} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{f.fired_at?.slice(0, 16) ?? "—"}</td>
                      <td className="py-2 pr-3 font-medium">{f.kind.replace(/_/g, " ").toLowerCase()}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/c/${f.tracking_id}`} className="underline-offset-4 hover:underline">
                          {f.title}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{f.tracking_id}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{STATUS_LABEL[f.status] ?? f.status}</td>
                      <td className="py-2 text-right tabular-nums">{f.days_late ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold">Per-institution performance</h2>
          <p className="mb-2 mt-1 text-xs text-muted-foreground">
            &ldquo;Released undelivered&rdquo; means a team claimed a challenge and filed no proposal in
            twenty-one days, so the claim was released automatically. Their work up to that point is
            preserved and still credited.
          </p>
          {institutions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              Nothing has been offered to an institution in scope.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
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
                  {institutions.map((h) => (
                    <tr key={h.name} className="border-b border-border/60">
                      <td className="py-2 pr-3">{h.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.offered}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.claimed}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.delivered}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{h.released_undelivered}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{h.median_claim_hours ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
