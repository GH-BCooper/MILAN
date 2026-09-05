/**
 * /hei/projects/[id] — the project workspace.
 *
 * Milestones, the credit chain, and an activity feed built from `audit_log` and
 * `ledger_entries` rather than from a separate table nobody maintains. The feed
 * and `last_activity_at` therefore cannot disagree, which matters because Phase
 * 3's inactivity ladder reads that column and escalates on it.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, or } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import {
  auditLog,
  challenges,
  creditEdges,
  districts,
  ledgerEntries,
  milestones,
  projectMembers,
  projects,
  userProfiles,
} from "@/lib/db/schema";
import type { ChallengeStatus } from "@/lib/db/schema";
import { Milestones } from "./milestones";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project" };

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("HEI_MEMBER");
  if (!user.orgId) notFound();

  const [row] = await db
    .select({
      project: projects,
      trackingId: challenges.trackingId,
      challengeId: challenges.id,
      challengeTitle: challenges.title,
      challengeStatus: challenges.status,
      bodyOriginal: challenges.bodyOriginal,
      bodyLang: challenges.bodyLang,
      framedStatement: challenges.framedStatement,
      successCriteria: challenges.successCriteria,
      districtName: districts.name,
    })
    .from(projects)
    .innerJoin(challenges, eq(challenges.id, projects.challengeId))
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .where(and(eq(projects.id, id), eq(projects.orgId, user.orgId)))
    .limit(1);

  if (!row) notFound();

  const [stones, members, credits, activity, ledger] = await Promise.all([
    db.select().from(milestones).where(eq(milestones.projectId, id)).orderBy(asc(milestones.dueAt)),
    db
      .select({
        declaredRole: projectMembers.declaredRole,
        addedAt: projectMembers.addedAt,
        fullName: userProfiles.fullName,
      })
      .from(projectMembers)
      .leftJoin(userProfiles, eq(userProfiles.userId, projectMembers.userId))
      .where(eq(projectMembers.projectId, id))
      .orderBy(asc(projectMembers.addedAt)),
    db
      .select()
      .from(creditEdges)
      .where(eq(creditEdges.challengeId, row.challengeId))
      .orderBy(asc(creditEdges.createdAt)),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetType, "project"), eq(auditLog.targetId, id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
    db
      .select({ kind: ledgerEntries.kind, createdAt: ledgerEntries.createdAt, payload: ledgerEntries.payload })
      .from(ledgerEntries)
      .where(or(eq(ledgerEntries.projectId, id), eq(ledgerEntries.challengeId, row.challengeId)))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(30),
  ]);

  const p = row.project;
  const silentDays = p.lastActivityAt
    ? Math.floor((clockNow().getTime() - p.lastActivityAt.getTime()) / 86_400_000)
    : null;

  return (
    <RoleShell
      title={p.title}
      subtitle={`${row.trackingId} · ${row.districtName ?? "district not given"} · ${p.ipTrack === "OPEN" ? "open, CC-BY" : "restricted, access logged"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={row.challengeStatus as ChallengeStatus} />
        <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
          {p.status.toLowerCase()}
        </span>
        {p.claimedAt ? (
          <span className="text-xs text-muted-foreground">claimed {formatDateTime(p.claimedAt)}</span>
        ) : null}
        <Link
          href={`/c/${row.trackingId}`}
          className="ms-auto text-sm text-primary underline underline-offset-4"
        >
          The public page
        </Link>
      </div>

      {silentDays !== null && silentDays >= 20 ? (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          No recorded activity for {silentDays} days. At 30 this project is flagged at risk, and at
          45 the challenge is offered to another team. Adding or completing a milestone resets it.
        </p>
      ) : null}

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">The problem</h2>
        <p className="mt-2 text-base">{row.framedStatement ?? row.challengeTitle}</p>
        {row.successCriteria ? (
          <p className="mt-3 text-sm">
            <span className="font-medium">Done when: </span>
            <span className="text-muted-foreground">{row.successCriteria}</span>
          </p>
        ) : null}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            The words the person actually used
          </summary>
          <p lang={row.bodyLang} className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
            {row.bodyOriginal}
          </p>
        </details>
      </section>

      <div className="mt-8">
        <Milestones
          projectId={id}
          rows={stones.map((s) => ({
            id: s.id,
            title: s.title,
            dueAt: s.dueAt?.toISOString() ?? null,
            completedAt: s.completedAt?.toISOString() ?? null,
            notes: s.notes,
          }))}
        />
      </div>

      <section className="mt-8" aria-labelledby="team-heading">
        <h2 id="team-heading" className="text-lg font-semibold">
          The credit chain
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanent and append-only. Nobody on this list can be removed from it, including the
          person who reported the problem.
        </p>
        <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
          {credits.map((edge) => (
            <li key={edge.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                {edge.relation.replaceAll("_", " ")}
              </span>
              <span className="text-sm">{edge.declaredRole ?? "Anonymous"}</span>
              <span className="ms-auto text-xs text-muted-foreground">
                {formatDateTime(edge.createdAt)}
              </span>
            </li>
          ))}
        </ol>
        {members.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {members.length} of them have a Milan account and can edit this project today.
          </p>
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-lg font-semibold">
          Activity
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Built from the audit log and the ledger, so it cannot disagree with the clock that
          escalates a silent project.
        </p>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {[
            ...activity.map((a) => ({
              at: a.createdAt,
              label: a.action.replaceAll("_", " ").toLowerCase(),
              detail: a.reason ?? JSON.stringify(a.meta ?? {}).slice(0, 140),
              source: "audit",
            })),
            ...ledger.map((l) => ({
              at: l.createdAt,
              label: `ledger · ${l.kind.replaceAll("_", " ").toLowerCase()}`,
              detail: JSON.stringify(l.payload ?? {}).slice(0, 140),
              source: "ledger",
            })),
          ]
            .sort((a, b) => b.at.getTime() - a.at.getTime())
            .slice(0, 25)
            .map((entry, i) => (
              <li key={`${entry.source}-${i}`} className="p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</span>
                </div>
                <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                  {entry.detail}
                </p>
              </li>
            ))}
        </ul>
      </section>
    </RoleShell>
  );
}
