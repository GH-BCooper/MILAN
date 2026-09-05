import Link from "next/link";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { syncClockOffset } from "@/lib/clock/server";
import { execRaw } from "@/lib/db/raw";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Field verification" };

/**
 * Field verification tasks, grouped by block.
 *
 * A block officer's day is geographic, so the list is too. Endorsing sets
 * `official_endorsed`, which is a 0.06 term in the priority score — the page
 * shows the score before and after rather than leaving the officer to wonder
 * whether their signature did anything.
 */
interface Row extends Record<string, unknown> {
  tracking_id: string;
  title: string;
  block_code: string | null;
  block_name: string | null;
  status: string;
  priority_score: string | null;
  official_endorsed: boolean;
  corroboration_count: number;
  age_days: number;
}

export default async function VerificationPage() {
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");
  await syncClockOffset();
  const district = user.districtCode;

  if (!district) {
    return (
      <RoleShell title="Field verification" subtitle="This account is not scoped to a district.">
        <p className="rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          Verification tasks are block-scoped inside a district, so there is nothing to list.
        </p>
      </RoleShell>
    );
  }

  const rows = await execRaw<Row>(sql`
    SELECT c.tracking_id, c.title, c.block_code, b.name AS block_name, c.status::text AS status,
           c.priority_score::text AS priority_score, c.official_endorsed, c.corroboration_count,
           EXTRACT(DAY FROM (clock_now() - c.created_at))::int AS age_days
    FROM challenges c
    LEFT JOIN blocks b ON b.code = c.block_code
    WHERE c.district_code = ${district}
      AND c.status NOT IN ('CLOSED','MERGED','WITHDRAWN','REJECTED_UNSAFE','FORWARDED_EXTERNAL')
    ORDER BY c.official_endorsed, b.name NULLS LAST, c.priority_score DESC NULLS LAST
  `);

  const blocks = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.block_name ?? r.block_code ?? "Block not recorded";
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(r);
  }

  const pending = rows.filter((r) => !r.official_endorsed).length;

  return (
    <RoleShell
      title="Field verification"
      subtitle={`${pending} report${pending === 1 ? "" : "s"} in ${district} not yet verified on the ground, grouped by block.`}
    >
      <div className="rounded-lg border border-border bg-muted p-4 text-sm">
        <p className="font-semibold">What an endorsement is worth, exactly.</p>
        <p className="mt-1 text-muted-foreground">
          Official endorsement is a 0.06 term in the priority score — enough to move a report up a
          queue, not enough to own one. A citizen&rsquo;s report is never blocked on an officer visiting.
          The number and its arithmetic are public on every challenge page, endorsed or not.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          Nothing open in {district} needs a field visit.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {[...blocks.entries()].map(([block, items]) => (
            <section key={block}>
              <h2 className="text-lg font-semibold">
                {block}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · {items.filter((i) => !i.official_endorsed).length} awaiting a visit
                </span>
              </h2>
              <ul className="mt-2 space-y-3">
                {items.map((r) => (
                  <li key={r.tracking_id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/c/${r.tracking_id}`} className="font-semibold underline-offset-4 hover:underline">
                          {r.title}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.tracking_id} · {r.corroboration_count} reporter{r.corroboration_count === 1 ? "" : "s"} ·{" "}
                          {r.age_days} day{r.age_days === 1 ? "" : "s"} old
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold tabular-nums">
                          {r.priority_score ? Number(r.priority_score).toFixed(3) : "—"}
                        </p>
                        {r.official_endorsed ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                            verified in the field
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {r.official_endorsed ? (
                      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                        Already endorsed. The endorsement, the officer&rsquo;s name and their note are in the
                        public ledger and cannot be edited or removed.
                      </p>
                    ) : (
                      <VerifyForm trackingId={r.tracking_id} score={r.priority_score === null ? null : Number(r.priority_score)} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </RoleShell>
  );
}
