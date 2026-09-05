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
      title="Emergency filter"
      subtitle="One switch. It changes what is shown and how it is sorted; it never changes a stored priority score."
    >
      <div className={`rounded-lg border p-4 ${on ? "border-red-300 bg-red-50" : "border-border"}`}>
        <p className="text-sm font-semibold">{on ? `On — pinned to ${hazard?.replace(/_/g, " ").toLowerCase()}` : "Off"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {on
            ? "A red banner is on every page in the product, the map is filtered to this hazard, and priority lists are re-sorted to put it first."
            : "Turning this on puts a red banner on every page statewide and filters the map and the priority lists to one hazard."}
        </p>
        <EmergencyForm on={on} hazard={hazard} hazards={[...hazardEnum.enumValues]} />
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-border bg-muted p-4 text-sm">
        <p className="font-semibold">What this is not — a declared stub.</p>
        <p className="mt-1 text-muted-foreground">
          Full Emergency Mode would compress SLA windows for the selected hazard, open a separate
          response queue and surge-route to institutions with standing capacity. None of that is built
          in this cut. What is built is the filter, and calling it a filter on the screen a District
          Collector uses is the difference between a declared stub and a lie.
        </p>
        <p className="mt-2 text-muted-foreground">
          Milan is a <span className="font-medium text-foreground">mitigation</span> pipeline that runs
          in peacetime. Response is somebody else&rsquo;s system and we do not pretend to be it.
        </p>
        <Link href="/gov" className="mt-3 inline-block text-primary underline underline-offset-4">
          Back to the district dashboard
        </Link>
      </div>
    </RoleShell>
  );
}
