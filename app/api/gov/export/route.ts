/**
 * The district disaster management plan export.
 *
 * One click, one CSV, scoped server-side to the officer's own district — the
 * `district` query parameter is checked against the session, not trusted. The
 * columns are chosen so the file can be pasted into a DDMP annexure as it
 * stands: hazard linkage, priority with its terms, who it went to, and the
 * confirmed/unconfirmed split spelled out in words rather than implied.
 */
import { sql } from "drizzle-orm";

import { requireDistrict, requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { syncClockOffset } from "@/lib/clock/server";
import { execRaw } from "@/lib/db/raw";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL", "ADMIN");
  const asked = new URL(request.url).searchParams.get("district") ?? user.districtCode;
  if (!asked) return new Response("No district on this account.", { status: 400 });
  await requireDistrict(asked);
  await syncClockOffset();

  const rows = await execRaw<Record<string, unknown>>(sql`
    SELECT c.tracking_id, c.title, c.status::text AS status,
           c.district_code, c.block_code,
           c.domain::text AS domain, c.hazard::text AS ndma_hazard, c.hazard_strength,
           c.severity, c.priority_score, c.scoring_version,
           c.people_affected, c.corroboration_count, c.recurrence,
           c.official_endorsed, c.capital_works, c.solvability,
           c.created_at::text AS reported_at,
           c.routed_at::text AS routed_at,
           c.sla_breached_at::text AS sla_breached_at,
           c.escalation_stage,
           CASE
             WHEN c.impact_confirmed AND c.impact_partial THEN 'PARTLY CONFIRMED BY CITIZEN'
             WHEN c.impact_confirmed THEN 'CONFIRMED BY CITIZEN'
             WHEN c.impact_disputed THEN 'DISPUTED BY CITIZEN'
             WHEN c.status IN ('IMPLEMENTED','INDUSTRY_INTEREST','AGREEMENT_SIGNED','PILOT')
               THEN 'CLAIMED, NOT CONFIRMED'
             ELSE 'NO IMPLEMENTATION CLAIMED'
           END AS impact_status,
           (SELECT string_agg(o.name, ' | ' ORDER BY r.rank)
              FROM routes r JOIN organization o ON o.id = r.org_id
             WHERE r.challenge_id = c.id) AS routed_to
    FROM challenges c
    WHERE c.district_code = ${asked}
    ORDER BY c.priority_score DESC NULLS LAST, c.tracking_id
  `);

  const headers =
    rows.length > 0
      ? Object.keys(rows[0])
      : ["tracking_id", "title", "status", "district_code", "domain", "ndma_hazard", "priority_score", "impact_status"];

  const body = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
  ].join("\n");

  const stamp = clockNow().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="milan-ddmp-${asked}-${stamp}.csv"`,
    },
  });
}
