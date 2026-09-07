import Link from "next/link";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { execRaw } from "@/lib/db/raw";
import { hazardEnum } from "@/lib/db/schema";
import { EmergencyForm } from "./emergency-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emergency filter" };

/**
 * Emergency mode, declared honestly.
 *
 * The build scope for this cut is the toggle: a statewide banner, a map filter
 * pinned to the selected hazard, and priority DISPLAY re-sorted for it. It is
 * labelled a filter on screen because that is what it is. Full Emergency Mode —
 * surge routing, a separate response queue, hazard-specific SLA compression — is
 * a declared stub and appears on the stubs slide.
 */
export default async function EmergencyPage() {
  await requireRole("GOVERNMENT", "ADMIN");

  const rows = await execRaw<{ emergency_mode: boolean; emergency_hazard: string | null }>(
    sql`SELECT emergency_mode, emergency_hazard FROM demo_state WHERE id = 1`,
  );
  const on = Boolean(rows[0]?.emergency_mode);
  const hazard = rows[0]?.emergency_hazard ?? null;

  return (
    <RoleShell
      title="Emergency mode"
      subtitle="One switch. It changes what is shown, how it is sorted, and how fast the pinned hazard's clocks run; it never changes a stored priority score."
    >
      <div className={`rounded-lg border p-4 ${on ? "border-red-400/40 bg-red-500/15" : "border-border"}`}>
        <p className="text-sm font-semibold">{on ? `On — pinned to ${hazard?.replace(/_/g, " ").toLowerCase()}` : "Off"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {on
            ? "A red banner is on every page in the product, the map and lists are filtered to this hazard, priority lists are re-sorted with a visible surge multiplier, and every open SLA clock on a linked challenge now runs at half speed."
            : "Turning this on puts a red banner on every page statewide, filters the map and lists to one hazard, adds a display surge of up to ×1.25 on linked challenges, and compresses their open SLA clocks to half time — keeping the original due date so switching off restores it exactly."}
        </p>
        <EmergencyForm on={on} hazard={hazard} hazards={[...hazardEnum.enumValues]} />
      </div>

      <div className="mt-6 milan-glass rounded-xl bg-muted p-4 text-sm">
        <p className="font-semibold">What this does, and what it does not.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Clocks, compressed reversibly.</span> Every open
            deadline on a challenge linked to the pinned hazard is rescheduled to half its remaining
            time (annual re-reviews excepted). The pre-emergency due date is kept in the row and
            restored when the switch goes off — an emergency must not quietly rewrite history.
          </li>
          <li>
            <span className="font-medium text-foreground">New clocks, born compressed.</span> While the
            emergency runs, every deadline a state transition or the reaper opens for a linked
            challenge starts at half time, so a ladder cannot slow back down halfway up.
          </li>
          <li>
            <span className="font-medium text-foreground">Lists, surged — visibly.</span> Linked
            challenges get a display multiplier of up to ×1.25 derived from their own hazard
            strength, labelled on every row and marker. The stored priority score never moves.
          </li>
          <li>
            <span className="font-medium text-foreground">Still not built, declared:</span> a separate
            live response queue and automatic surge-routing to institutions with standing capacity.
            Milan is a <span className="font-medium text-foreground">mitigation</span> pipeline that
            runs in peacetime; response is somebody else&rsquo;s system and we do not pretend to be it.
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Every switch of this toggle is written to the audit log with the counts of clocks
          compressed and restored.
        </p>
        <Link href="/gov" className="mt-3 inline-block text-primary underline underline-offset-4">
          Back to the district dashboard
        </Link>
      </div>
    </RoleShell>
  );
}
