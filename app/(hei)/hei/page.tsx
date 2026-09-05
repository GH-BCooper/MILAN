/**
 * /hei — the department dashboard.
 *
 * Four numbers a head of department actually acts on: what is waiting, when the
 * soonest deadline is, what is running, and how much capacity is left. Every one
 * links somewhere you can do something about it.
 */
import Link from "next/link";

import { ClaimCountdown } from "@/components/claim-countdown";
import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { projectsFor, summaryFor } from "@/lib/hei/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "University" };

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function HeiHome() {
  const user = await requireRole("HEI_MEMBER");

  if (!user.orgId) {
    return (
      <RoleShell title="University workspace" subtitle={`Signed in as ${user.fullName}.`}>
        <div className="rounded-lg border border-border p-6">
          <p className="text-sm font-medium">Your account is not attached to an institution.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Milan routes to departments, not to individuals, so nothing can reach you until an
            institution is set on your profile.
          </p>
        </div>
      </RoleShell>
    );
  }

  const [summary, projects] = await Promise.all([summaryFor(user.orgId), projectsFor(user.orgId)]);
  const serverNow = clockNow().toISOString();

  return (
    <RoleShell title={summary.orgName} subtitle={`Signed in as ${user.fullName}.`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/hei/inbox"
          className="rounded-lg border border-border p-4 transition-colors hover:bg-accent"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Waiting on you</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{summary.inboxCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">routed problems in your inbox</p>
        </Link>

        <div className="rounded-lg border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Soonest deadline</p>
          <p className="mt-1 text-2xl font-bold">
            {summary.soonestDeadline ? (
              <ClaimCountdown endsAt={summary.soonestDeadline.toISOString()}
                        serverNow={serverNow} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.soonestDeadline
              ? "then it widens to more institutions"
              : "nothing is on the clock"}
          </p>
        </div>

        <Link
          href="/hei/capability"
          className="rounded-lg border border-border p-4 transition-colors hover:bg-accent"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Capacity open</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{summary.capacityRemaining}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            of {summary.capacityDeclared} declared slots
          </p>
        </Link>

        <div className="rounded-lg border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Active projects</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{summary.activeProjects}</p>
          <p className="mt-1 text-xs text-muted-foreground">claimed and running</p>
        </div>
      </div>

      <section className="mt-8" aria-labelledby="projects-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="projects-heading" className="text-lg font-semibold">
            Your projects
          </h2>
          <Link
            href="/hei/challenge-bank"
            className="text-sm text-primary underline underline-offset-4"
          >
            Browse the challenge bank
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-border p-6">
            <p className="text-sm font-medium">Nothing claimed yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Problems arrive in{" "}
              <Link className="text-primary underline underline-offset-4" href="/hei/inbox">
                your inbox
              </Link>{" "}
              with a reason and a clock. You never have to go looking for them.
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {projects.map((project) => (
              <li key={project.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/hei/projects/${project.id}`}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {project.title}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">
                    {project.trackingId}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{project.challengeTitle}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>{project.status.toLowerCase()}</span>
                  <span>{project.ipTrack === "OPEN" ? "open, CC-BY" : "restricted"}</span>
                  <span>
                    {project.memberCount} member{project.memberCount === 1 ? "" : "s"}
                  </span>
                  <span>{project.districtName ?? "district not given"}</span>
                  {project.lastActivityAt ? (
                    <span>last activity {formatDate(project.lastActivityAt)}</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RoleShell>
  );
}
