/**
 * /hei/challenge-bank — real final-year projects.
 *
 * This is the adoption argument, so the copy is the feature. 200,000 Indian
 * students invent a fake final-year project every year because there is no
 * supply of real ones. This is the supply, and every row on it is a real
 * problem a real person in Jharkhand reported with their name on it.
 *
 * Deliberately open to any signed-in HEI member rather than gated behind a
 * routing offer: a department that was not in the top three can still ask.
 */
import Link from "next/link";

import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { challengeBank } from "@/lib/hei/queries";
import type { ChallengeStatus } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Challenge bank" };

export default async function ChallengeBank({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; hazard?: string }>;
}) {
  await requireRole("HEI_MEMBER");
  const filters = await searchParams;

  const all = await challengeBank();
  const items = all.filter(
    (i) =>
      (!filters.domain || i.domain === filters.domain) &&
      (!filters.hazard || i.hazard === filters.hazard),
  );

  const domains = [...new Set(all.map((i) => i.domain).filter(Boolean))].sort() as string[];
  const hazards = [...new Set(all.map((i) => i.hazard).filter((h) => h && h !== "NONE"))].sort() as string[];

  return (
    <RoleShell
      title="Real final-year projects"
      subtitle={`${items.length} unclaimed problem${items.length === 1 ? "" : "s"}, scored and ready for a team.`}
    >
      <div className="rounded-lg border border-border bg-accent p-4">
        <p className="text-sm font-medium text-accent-foreground">
          Every one of these was reported by somebody who lives with it.
        </p>
        <p className="mt-1 text-sm text-accent-foreground">
          Around 200,000 engineering students in India invent a final-year project every year,
          because nobody hands them a real one. These are real. They have a location, a named
          reporter, a hazard linkage and a priority score you can check the arithmetic of — and
          when a team finishes, the person who reported it is the one who confirms whether it
          actually worked. That is a project a student can defend in a viva and put on a CV.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <FilterChip label="Everything" href="/hei/challenge-bank" active={!filters.domain && !filters.hazard} />
        {domains.map((d) => (
          <FilterChip
            key={d}
            label={d.replaceAll("_", " ").toLowerCase()}
            href={`/hei/challenge-bank?domain=${encodeURIComponent(d)}`}
            active={filters.domain === d}
          />
        ))}
        {hazards.map((h) => (
          <FilterChip
            key={h}
            label={h.replaceAll("_", " ").toLowerCase()}
            href={`/hei/challenge-bank?hazard=${encodeURIComponent(h)}`}
            active={filters.hazard === h}
          />
        ))}
      </div>

      {items.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing unclaimed matches that filter right now.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <li key={item.trackingId} className="flex flex-col rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{item.trackingId}</span>
                {item.priorityScore !== null ? (
                  <span className="text-sm font-semibold tabular-nums">
                    priority {item.priorityScore.toFixed(1)}
                  </span>
                ) : null}
              </div>

              <h2 className="mt-1 font-medium">{item.title}</h2>

              {item.framedStatement ? (
                <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">
                  {item.framedStatement}
                </p>
              ) : null}

              {item.successCriteria ? (
                <p className="mt-2 text-sm">
                  <span className="font-medium">Done when: </span>
                  <span className="text-muted-foreground">{item.successCriteria}</span>
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={item.status as ChallengeStatus} />
                {item.domain ? (
                  <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs">
                    {item.domain.replaceAll("_", " ").toLowerCase()}
                  </span>
                ) : null}
                {item.hazard && item.hazard !== "NONE" ? (
                  <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                    {item.hazard.replaceAll("_", " ").toLowerCase()}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {item.districtName ?? "district not given"} · {item.corroborationCount} report
                  {item.corroborationCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 pt-1">
                <Link
                  href={`/c/${item.trackingId}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium"
                >
                  Read the full report
                </Link>
                {item.offeredElsewhere ? (
                  <Link
                    href={`/hei/challenges/${item.trackingId}/claim`}
                    className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                  >
                    Claim it
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center text-xs text-muted-foreground">
                    Not currently offered — it will widen on its SLA ladder
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </RoleShell>
  );
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-medium ${
        active ? "border-primary bg-accent text-accent-foreground" : "border-border"
      }`}
    >
      {label}
    </Link>
  );
}
