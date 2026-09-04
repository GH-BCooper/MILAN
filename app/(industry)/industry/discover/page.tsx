import { ArrivesLater, RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Industry" };

export default async function IndustryDiscover() {
  const user = await requireRole("INDUSTRY");
  return (
    <RoleShell title="Discover challenges" subtitle={`Signed in as ${user.fullName}.`}>
      <ArrivesLater phase={2} what="Search by hazard and district, express interest, and export a CSR report." />
    </RoleShell>
  );
}
