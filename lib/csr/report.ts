/**
 * The Companies Act §135 CSR report.
 *
 * One query, used by the screen, the CSV and the PDF, so the three cannot
 * disagree. The important column is `impact_status`, and it has exactly three
 * honest values rather than one flattering one: a citizen confirmed it, a
 * citizen said partly, or somebody claims it and no citizen has said anything.
 *
 * A CSR report that counts unconfirmed claims as impact is the normal thing and
 * it is why nobody believes CSR reports. This one separates them, and the
 * separation is the reason a company can defend the document to its auditor.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { execRaw } from "@/lib/db/raw";

export interface CsrRow extends Record<string, unknown> {
  tracking_id: string;
  challenge: string;
  district: string | null;
  block: string | null;
  ndma_hazard: string | null;
  domain: string | null;
  institution: string | null;
  project: string | null;
  interest_state: string;
  supported_since: string;
  beneficiaries: number | null;
  reporters: number;
  artifacts: number;
  licences: string | null;
  impact_status: "CONFIRMED BY CITIZEN" | "PARTLY CONFIRMED BY CITIZEN" | "CLAIMED, NOT CONFIRMED" | "NO IMPLEMENTATION CLAIMED" | "DISPUTED BY CITIZEN";
  confirmed_on: string | null;
  spend_committed_inr: string | null;
  spend_disbursed_inr: string | null;
}

export interface CsrSummary {
  org: string;
  rows: CsrRow[];
  confirmed: number;
  partial: number;
  unconfirmed: number;
  disputed: number;
  beneficiariesConfirmed: number;
  beneficiariesUnconfirmed: number;
  districts: string[];
}

export async function csrReport(orgId: string, orgName: string): Promise<CsrSummary> {
  const rows = await execRaw<CsrRow>(sql`
    SELECT c.tracking_id,
           c.title AS challenge,
           d.name AS district,
           b.name AS block,
           NULLIF(c.hazard::text, 'NONE') AS ndma_hazard,
           c.domain::text AS domain,
           ho.name AS institution,
           p.title AS project,
           i.state AS interest_state,
           i.created_at::date::text AS supported_since,
           c.people_affected AS beneficiaries,
           c.corroboration_count AS reporters,
           (SELECT count(*)::int FROM artifacts a WHERE a.project_id = p.id) AS artifacts,
           (SELECT string_agg(DISTINCT a.licence::text, ' | ') FROM artifacts a WHERE a.project_id = p.id) AS licences,
           CASE
             WHEN c.impact_confirmed AND c.impact_partial THEN 'PARTLY CONFIRMED BY CITIZEN'
             WHEN c.impact_confirmed THEN 'CONFIRMED BY CITIZEN'
             WHEN c.impact_disputed THEN 'DISPUTED BY CITIZEN'
             WHEN c.status IN ('IMPLEMENTED','INDUSTRY_INTEREST','AGREEMENT_SIGNED','PILOT')
               THEN 'CLAIMED, NOT CONFIRMED'
             ELSE 'NO IMPLEMENTATION CLAIMED'
           END AS impact_status,
           c.citizen_verified_at::date::text AS confirmed_on,
           -- Spend is not modelled in this cut: payment rails are a declared
           -- stub. The columns are here because a §135 annexure needs them and a
           -- blank an auditor can fill is more honest than a number we invented.
           NULL::text AS spend_committed_inr,
           NULL::text AS spend_disbursed_inr
    FROM industry_interests i
    JOIN challenges c ON c.id = i.challenge_id
    LEFT JOIN districts d ON d.code = c.district_code
    LEFT JOIN blocks b ON b.code = c.block_code
    LEFT JOIN projects p ON p.challenge_id = c.id
    LEFT JOIN organization ho ON ho.id = p.org_id
    WHERE i.org_id = ${orgId}
    ORDER BY c.tracking_id
  `);

  const count = (s: string) => rows.filter((r) => r.impact_status === s).length;
  const sumBeneficiaries = (match: (r: CsrRow) => boolean) =>
    rows.filter(match).reduce((n, r) => n + Number(r.beneficiaries ?? 0), 0);

  return {
    org: orgName,
    rows,
    confirmed: count("CONFIRMED BY CITIZEN"),
    partial: count("PARTLY CONFIRMED BY CITIZEN"),
    unconfirmed: count("CLAIMED, NOT CONFIRMED"),
    disputed: count("DISPUTED BY CITIZEN"),
    beneficiariesConfirmed: sumBeneficiaries((r) => r.impact_status.startsWith("CONFIRMED") || r.impact_status.startsWith("PARTLY")),
    beneficiariesUnconfirmed: sumBeneficiaries((r) => r.impact_status === "CLAIMED, NOT CONFIRMED"),
    districts: [...new Set(rows.map((r) => r.district).filter((d): d is string => Boolean(d)))],
  };
}
