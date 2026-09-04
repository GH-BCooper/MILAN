import { ArrivesLater, RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "University" };

export default async function HeiHome() {
  const user = await requireRole("HEI_MEMBER");
  return (
    <RoleShell title="University workspace" subtitle={`Signed in as ${user.fullName}.`}>
      <ArrivesLater
        phase={2}
        what="Your routed inbox, the claim flow, your capability declaration and your project workspace."
      />
    </RoleShell>
  );
}
