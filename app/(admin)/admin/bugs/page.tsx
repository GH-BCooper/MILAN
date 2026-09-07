/**
 * /admin/bugs — platform defects filed from the public "Report a bug" link.
 *
 * Deliberately separate from /admin/triage: triage is the AI's low-confidence
 * queue for citizen challenges, this is a plain punch list of software bugs.
 * Nothing here touches the routing pipeline or the ledger.
 */
import { desc, eq } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { bugReports, user as userTable } from "@/lib/db/schema";
import { publicUrlFor } from "@/lib/media/storage";
import { BugStatusButton } from "./bug-status-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bug reports" };

const TYPE_LABEL: Record<string, string> = {
  UI_VISUAL: "Visual / layout",
  CRASH_ERROR: "Crash or error",
  INCORRECT_DATA: "Incorrect data",
  PERFORMANCE: "Slow / performance",
  OTHER: "Other",
};

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function AdminBugsPage() {
  const user = await requireRole("ADMIN");

  const rows = await db
    .select({
      id: bugReports.id,
      type: bugReports.type,
      issue: bugReports.issue,
      photoKey: bugReports.photoKey,
      pageUrl: bugReports.pageUrl,
      status: bugReports.status,
      createdAt: bugReports.createdAt,
      reporterName: userTable.name,
      reporterEmail: userTable.email,
    })
    .from(bugReports)
    .leftJoin(userTable, eq(userTable.id, bugReports.reporterId))
    .orderBy(desc(bugReports.createdAt))
    .limit(200);

  const openCount = rows.filter((r) => r.status === "OPEN").length;

  return (
    <RoleShell
      title="Bug reports"
      subtitle={`Signed in as ${user.fullName}. ${openCount} open of ${rows.length} filed.`}
    >
      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium">No bug reports yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Anyone can file one from the &quot;Report a bug&quot; link in the header.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="milan-glass rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                    {TYPE_LABEL[r.type] ?? r.type}
                  </span>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{r.issue}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatTime(r.createdAt)} · {r.reporterName ?? "anonymous"}
                    {r.reporterEmail ? ` (${r.reporterEmail})` : ""}
                    {r.pageUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a className="underline underline-offset-4" href={r.pageUrl}>
                          page
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <BugStatusButton id={r.id} status={r.status} />
              </div>
              {r.photoKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={publicUrlFor(r.photoKey) ?? ""}
                  alt="Screenshot attached to the bug report"
                  className="mt-3 max-h-64 rounded-md border border-border object-contain"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </RoleShell>
  );
}
