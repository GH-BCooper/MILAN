import { ArrivesLater, RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Triage" };

export default async function AdminTriage() {
  const user = await requireRole("ADMIN");
  return (
    <RoleShell title="Triage" subtitle={`Signed in as ${user.fullName}.`}>
      <ArrivesLater phase={2} what="The AI run log, routing weights and the manual triage queue." />
    </RoleShell>
  );
}
