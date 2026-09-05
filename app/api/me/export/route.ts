/**
 * The citizen's credit record as a PDF.
 *
 * A person who reported a problem that became a funded research project should
 * be able to hold a piece of paper that says so, with the tracking IDs, the
 * citations and the URLs anybody can check. That is the whole document.
 */
import { sql } from "drizzle-orm";

import { requireUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { citationString, type CitationInput } from "@/lib/credit/citation";
import { execRaw } from "@/lib/db/raw";
import { renderPdf, type PdfLine } from "@/lib/pdf/simple";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  status: string;
  relation: string;
  declared_role: string | null;
  created_at: string;
  reporter_name: string | null;
  place: string | null;
  team: string | null;
}

export async function GET() {
  const user = await requireUser();
  const host = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const rows = await execRaw<Row>(sql`
    SELECT c.tracking_id, c.title, c.status::text AS status,
           e.relation, e.declared_role, e.created_at::text AS created_at,
           c.reporter_name,
           COALESCE(b.name, d.name) AS place,
           (SELECT o.name FROM credit_edges e2
              JOIN organization o ON o.id = e2.org_id
             WHERE e2.challenge_id = c.id AND e2.relation IN ('TEAM_MEMBER','MENTOR')
             ORDER BY e2.created_at LIMIT 1) AS team
    FROM credit_edges e
    JOIN challenges c ON c.id = e.challenge_id
    LEFT JOIN blocks b ON b.code = c.block_code
    LEFT JOIN districts d ON d.code = c.district_code
    WHERE e.to_user_id = ${user.id}
    ORDER BY e.created_at DESC
  `);

  const at = clockNow();
  const lines: PdfLine[] = [
    { text: "Milan - permanent credit record", size: 18, bold: true },
    { text: "Government of Jharkhand - disaster risk reduction", size: 10, spaceBefore: 4 },
    { text: user.fullName, size: 14, bold: true, spaceBefore: 14 },
    { text: `Public record: ${host}/credit/${user.id}`, size: 9 },
    { text: `Generated ${at.toISOString().slice(0, 19).replace("T", " ")} UTC`, size: 9 },
    {
      text:
        "Every entry below is also a row in Milan's append-only ledger, which the database physically " +
        `refuses to update or delete. Anyone can verify the chain at ${host}/ledger.`,
      size: 9,
      spaceBefore: 10,
    },
    { text: `${rows.length} recorded contribution${rows.length === 1 ? "" : "s"}`, size: 12, bold: true, spaceBefore: 16 },
  ];

  if (rows.length === 0) {
    lines.push({
      text: "No credit has been recorded yet. An edge is written the moment a report is accepted.",
      size: 10,
      spaceBefore: 8,
    });
  }

  for (const r of rows) {
    const citation: CitationInput = {
      trackingId: r.tracking_id,
      originatorName: r.reporter_name,
      teamName: r.team,
      title: r.title,
      place: r.place,
      year: new Date(r.created_at.replace(" ", "T").replace(/\+00$/, "Z")).getUTCFullYear(),
      host,
    };
    lines.push({ text: `${r.relation.replace(/_/g, " ")} - ${r.tracking_id}`, size: 11, bold: true, spaceBefore: 12 });
    lines.push({ text: r.title, size: 10 });
    lines.push({ text: `Status: ${r.status.replace(/_/g, " ").toLowerCase()} - recorded ${r.created_at.slice(0, 10)}`, size: 9 });
    if (r.declared_role) lines.push({ text: `Declared role: ${r.declared_role}`, size: 9 });
    lines.push({ text: `Cite as: ${citationString(citation)}`, size: 9, spaceBefore: 4 });
  }

  const pdf = renderPdf(lines, "credit record");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="milan-credit-record-${at.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
