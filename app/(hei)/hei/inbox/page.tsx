/**
 * /hei/inbox — the routed inbox.
 *
 * "Discovery is never luck." A professor does not browse for problems; problems
 * arrive here with a rank, a written reason, the full priority breakdown and a
 * clock. Sorted by deadline rather than by score, because the item most at risk
 * of expiring is the one that needs a decision, not the most interesting one.
 */
import Link from "next/link";

import { ClaimCountdown } from "@/components/claim-countdown";
import { PriorityBreakdown } from "@/components/priority-breakdown";
import { parseBreakdown } from "@/packages/scoring";
import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { inboxFor, summaryFor } from "@/lib/hei/queries";
import type { ChallengeStatus } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function HeiInbox() {
  const user = await requireRole("HEI_MEMBER");
  if (!user.orgId) {
    return (
      <RoleShell title="Inbox">
        <p className="rounded-lg border border-border p-4 text-sm">
          Your account is not attached to an institution yet, so nothing can be routed to you.
        </p>
      </RoleShell>
    );
  }

  const [items, summary] = await Promise.all([inboxFor(user.orgId), summaryFor(user.orgId)]);
  // Milan time, handed to the countdown so it moves with the demo clock.
  const serverNow = clockNow().toISOString();

  return (
    <RoleShell
      title="Inbox"
      subtitle={`${summary.orgName}. ${items.length} problem${items.length === 1 ? "" : "s"} routed to your departments, soonest deadline first.`}
    >
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium">Nothing waiting on you.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Milan pushes problems to matched departments; it does not ask you to go looking. When
            something matches your declared work you will get an email with a direct link. In the
            meantime,{" "}
            <Link className="text-primary underline underline-offset-4" href="/hei/challenge-bank">
              the challenge bank
            </Link>{" "}
            is open to anyone.
          </p>
        </div>
      ) : (
        <ol className="space-y-6">
          {items.map((item) => {
            const breakdown = parseBreakdown(item.priorityBreakdown);
            return (
              <li key={item.routeId} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{item.trackingId}</p>
                    <h2 className="mt-0.5 text-lg font-semibold">
                      {item.framedStatement ? item.title : item.title}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={item.status as ChallengeStatus} />
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                        rank {item.rank} of 3
                      </span>
                      {item.domain ? (
                        <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                          {item.domain.replaceAll("_", " ")}
                        </span>
                      ) : null}
                      {item.hazard && item.hazard !== "NONE" ? (
                        <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          {item.hazard.replaceAll("_", " ")}
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {item.districtName ?? "District not given"} · {item.corroborationCount} report
                        {item.corroborationCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Claim window closes in
                    </p>
                    {item.claimWindowEndsAt ? (
                      <ClaimCountdown
                        endsAt={item.claimWindowEndsAt.toISOString()}
                        serverNow={serverNow}
                        className="text-lg"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">no deadline set</span>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Then it widens to more institutions.
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Why you
                  </p>
                  <p className="mt-1 text-sm">{item.reasonText ?? "No reason recorded."}</p>
                  {item.department ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Matched to {item.department}
                      {item.labName ? ` · ${item.labName}` : ""}
                      {item.matchScore !== null ? ` · match ${item.matchScore.toFixed(3)}` : ""}
                    </p>
                  ) : null}

                  {/* Invariant 6 holds here too: a professor deciding whether to
                      take this on reads the citizen's own words, not only ours. */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded border border-border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        As it was reported
                      </p>
                      <p lang={item.bodyLang} className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm">
                        {item.bodyOriginal}
                      </p>
                    </div>
                    <div className="rounded border border-border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {item.framedStatement ? "The research problem" : "English working copy"}
                      </p>
                      <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm">
                        {item.framedStatement ?? item.bodyEn ?? "Not translated yet."}
                      </p>
                    </div>
                  </div>

                  {breakdown ? (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Priority {breakdown.total.toFixed(1)} of 100 — see every term
                      </summary>
                      <div className="mt-2">
                        <PriorityBreakdown
                          score={breakdown}
                          trackingId={item.trackingId}
                          districtCode={null}
                          compact
                        />
                      </div>
                    </details>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/hei/challenges/${item.trackingId}/claim`}
                      className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                    >
                      Claim this
                    </Link>
                    <Link
                      href={`/c/${item.trackingId}`}
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
                    >
                      See the public page
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </RoleShell>
  );
}
