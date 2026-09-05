import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireUser } from "@/lib/auth/guards";
import { execRaw } from "@/lib/db/raw";
import { RespondForm } from "./respond-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expression of interest" };

/**
 * The EOI thread.
 *
 * Deliberately small. Negotiation threads, e-signature and payment rails are
 * declared stubs — what is real is the record that a firm asked, that a named
 * person on the team answered, and that an accepted offer wrote a permanent
 * FUNDER edge onto the public credit chain. The MoU below is generated from a
 * template and hashed into the ledger; nobody signs anything in this cut and the
 * page says so.
 */
interface Row extends Record<string, unknown> {
  id: string;
  state: string;
  message: string | null;
  created_at: string;
  org_name: string;
  requester: string | null;
  tracking_id: string;
  challenge_title: string;
  project_id: string | null;
  project_lead: string | null;
  hei_name: string | null;
}

export default async function InterestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const rows = await execRaw<Row>(sql`
    SELECT i.id, i.state, i.message, i.created_at::text AS created_at,
           o.name AS org_name, up.full_name AS requester,
           c.tracking_id, c.title AS challenge_title,
           p.id AS project_id, lead.full_name AS project_lead, ho.name AS hei_name
    FROM industry_interests i
    JOIN organization o ON o.id = i.org_id
    JOIN challenges c ON c.id = i.challenge_id
    LEFT JOIN user_profiles up ON up.user_id = i.user_id
    LEFT JOIN projects p ON p.challenge_id = c.id
    LEFT JOIN organization ho ON ho.id = p.org_id
    LEFT JOIN user_profiles lead ON lead.user_id = p.lead_user_id
    WHERE i.id = ${id}
    LIMIT 1
  `);
  if (rows.length === 0) notFound();
  const i = rows[0];

  const canRespond = user.role === "HEI_MEMBER" || user.role === "ADMIN" || user.role === "INDEPENDENT_INNOVATOR";

  return (
    <RoleShell
      title={`Expression of interest — ${i.org_name}`}
      subtitle={`On ${i.tracking_id}: ${i.challenge_title}. Currently ${i.state.toLowerCase()}.`}
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {i.requester ?? i.org_name} wrote, {i.created_at.slice(0, 10)}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{i.message}</p>
        </section>

        <section className="rounded-lg border border-border bg-muted p-4 text-sm">
          <p className="font-semibold">What accepting does, and what it does not.</p>
          <p className="mt-1 text-muted-foreground">
            Accepting writes a <span className="font-medium text-foreground">FUNDER</span> edge onto the
            public credit chain and moves the challenge to INDUSTRY_INTEREST. It does not sign anything
            and it does not move any money.
          </p>
          <p className="mt-2 text-muted-foreground">
            <span className="font-medium text-foreground">Declared stubs:</span> e-signature, payment
            rails and MoU negotiation threads are not built in this cut. What Milan does instead is
            generate the MoU document from a template and hash it into the ledger, so that the version
            both parties discussed cannot later be disputed.
          </p>
          <Link
            href={`/api/industry/mou?interest=${i.id}`}
            className="mt-3 inline-flex h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-semibold"
          >
            Generate the MoU document (PDF, hashed into the ledger)
          </Link>
        </section>

        {i.project_id ? (
          <p className="text-sm text-muted-foreground">
            The project is led by {i.project_lead ?? "the department"} at {i.hei_name ?? "the institution"}.{" "}
            <Link href={`/c/${i.tracking_id}`} className="text-primary underline underline-offset-4">
              See the public challenge page
            </Link>
            .
          </p>
        ) : null}

        {canRespond && i.state === "EXPRESSED" ? <RespondForm interestId={i.id} /> : null}
        {i.state !== "EXPRESSED" ? (
          <p className="rounded-lg border border-border p-4 text-sm">
            This expression of interest was <span className="font-semibold">{i.state.toLowerCase()}</span>.
          </p>
        ) : null}
      </div>
    </RoleShell>
  );
}
