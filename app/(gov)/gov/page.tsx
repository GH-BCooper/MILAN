import { ArrivesLater, RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Government" };

export default async function GovHome() {
  // Middleware already redirected a signed-out visitor. This is the check that
  // counts: a server action can be called without ever passing through it.
  const user = await requireRole("GOVERNMENT", "EXPERT_PANEL");

  return (
    <RoleShell
      title="District dashboard"
      subtitle={`Signed in as ${user.fullName}, scoped to district ${user.districtCode ?? "(unscoped)"}.`}
    >
      <ArrivesLater
        phase={3}
        what="The human gate for high-severity challenges, official verification, the SLA board and emergency mode."
      />
    </RoleShell>
  );
}
