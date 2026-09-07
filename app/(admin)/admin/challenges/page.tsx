/**
 * /admin/challenges — every challenge, with an admin state override on each
 * (item 9a). "Delete" is a transition to a terminal state; nothing is erased and
 * every move carries a written reason. See ./actions.ts.
 */
import { desc, eq } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { challenges, districts } from "@/lib/db/schema";
import { TRANSITIONS } from "@/lib/db/stateMachine";
import { ManageRow } from "./manage-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Challenges (manage)" };

export default async function AdminChallengesPage() {
  await requireRole("ADMIN");

  const rows = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      status: challenges.status,
      districtName: districts.name,
    })
    .from(challenges)
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .orderBy(desc(challenges.createdAt))
    .limit(500);

  return (
    <RoleShell
      title="Manage challenges"
      subtitle="Every report. Changing a state needs a written reason; it is appended to the ledger and the audit log, never a silent edit."
    >
      <ul className="divide-y divide-border milan-glass rounded-xl">
        {rows.map((r) => (
          <ManageRow
            key={r.id}
            challengeId={r.id}
            trackingId={r.trackingId}
            title={r.title}
            status={r.status}
            district={r.districtName}
            legalTargets={TRANSITIONS[r.status]}
          />
        ))}
      </ul>
    </RoleShell>
  );
}
