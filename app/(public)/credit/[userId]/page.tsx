import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { execRaw } from "@/lib/db/raw";

export const dynamic = "force-dynamic";
export const metadata = { title: "Credit record" };

/**
 * A person's public credit record.
 *
 * Public, and permanent. A student can put this URL on a CV; a citizen can point
 * at it and say "that was me". It is the answer to loophole row 5 — a university
 * cannot quietly drop the citizen from the acknowledgements, because the
 * acknowledgement is not in the paper, it is here, and here is append-only.
 *
 * Only what the person themselves declared is shown: a name and a role. No
 * email, no phone, no district-level identification of a private individual.
 */
interface Row extends Record<string, unknown> {
  relation: string;
  declared_role: string | null;
  tracking_id: string;
  title: string;
  status: string;
  created_at: string;
  org_name: string | null;
}

export default async function CreditRecordPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const who = await execRaw<{ full_name: string; role: string; org_name: string | null }>(sql`
    SELECT p.full_name, p.role::text AS role, o.name AS org_name
    FROM user_profiles p
    LEFT JOIN organization o ON o.id = p.org_id
    WHERE p.user_id = ${userId}
    LIMIT 1
  `);
  if (who.length === 0) notFound();
  const person = who[0];

  const edges = await execRaw<Row>(sql`
    SELECT e.relation, e.declared_role, c.tracking_id, c.title, c.status::text AS status,
           e.created_at::text AS created_at, o.name AS org_name
    FROM credit_edges e
    JOIN challenges c ON c.id = e.challenge_id
    LEFT JOIN organization o ON o.id = e.org_id
    WHERE e.to_user_id = ${userId}
    ORDER BY e.created_at DESC
  `);

  const byRelation = new Map<string, Row[]>();
  for (const e of edges) {
    if (!byRelation.has(e.relation)) byRelation.set(e.relation, []);
    byRelation.get(e.relation)!.push(e);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Public credit record
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{person.full_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {person.org_name ? `${person.org_name} · ` : ""}
          {edges.length} recorded contribution{edges.length === 1 ? "" : "s"}. Every one is also a row
          in the append-only ledger, so nothing on this page can be removed — including by us.
        </p>

        {edges.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
            No credit recorded yet. An edge is written the moment a report is accepted, a challenge is
            claimed, or a project is joined.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {[...byRelation.entries()].map(([relation, items]) => (
              <section key={relation}>
                <h2 className="text-lg font-semibold">
                  {relation.replace(/_/g, " ").toLowerCase()}{" "}
                  <span className="text-sm font-normal text-muted-foreground">· {items.length}</span>
                </h2>
                <ul className="mt-2 space-y-2">
                  {items.map((e) => (
                    <li key={`${e.tracking_id}-${e.created_at}`} className="rounded-lg border border-border p-3">
                      <Link href={`/c/${e.tracking_id}`} className="font-medium underline-offset-4 hover:underline">
                        {e.title}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.tracking_id}
                        {e.declared_role ? ` · ${e.declared_role}` : ""}
                        {e.org_name ? ` · ${e.org_name}` : ""} · recorded {e.created_at.slice(0, 10)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
