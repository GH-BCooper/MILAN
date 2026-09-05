/**
 * /hei/capability — what this institution declares it can do.
 *
 * This is the Institutional Capability Graph, edited by the people who actually
 * know. Two of the five match-score terms come straight off this page, and the
 * page says so: a department that understands editing capacity changes future
 * routing will keep it honest, and one that thinks this is a directory listing
 * will not.
 */
import Link from "next/link";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { capabilitiesFor, summaryFor } from "@/lib/hei/queries";
import { MATCH_WEIGHTS } from "@/lib/ai/routing";
import { CapabilityCard } from "./capability-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capability" };

export default async function CapabilityPage() {
  const user = await requireRole("HEI_MEMBER");
  if (!user.orgId) {
    return (
      <RoleShell title="Capability">
        <p className="rounded-lg border border-border p-4 text-sm">
          Your account is not attached to an institution.
        </p>
      </RoleShell>
    );
  }

  const [caps, summary] = await Promise.all([capabilitiesFor(user.orgId), summaryFor(user.orgId)]);

  return (
    <RoleShell
      title="What your institution can take on"
      subtitle={`${summary.orgName} · ${caps.length} department${caps.length === 1 ? "" : "s"} declared · ${summary.capacityRemaining} slots open of ${summary.capacityDeclared}`}
    >
      <div className="rounded-lg border border-border bg-muted p-4 text-sm">
        <p className="font-medium">Editing this changes what gets routed to you.</p>
        <p className="mt-1 text-muted-foreground">
          Milan scores every match on five signals: semantic fit against your declared work (
          {Math.round(MATCH_WEIGHTS.semantic * 100)}%), overlap with these tags (
          {Math.round(MATCH_WEIGHTS.tagOverlap * 100)}%), distance to the problem (
          {Math.round(MATCH_WEIGHTS.distance * 100)}%), the capacity you declare below (
          {Math.round(MATCH_WEIGHTS.capacity * 100)}%), and your track record (
          {Math.round(MATCH_WEIGHTS.trackRecord * 100)}%). Set capacity to zero, or close the
          window, and nothing is offered to that department at all — the capacity term becomes zero
          rather than small.{" "}
          <Link className="text-primary underline underline-offset-4" href="/hei/inbox">
            See what is currently routed to you.
          </Link>
        </p>
      </div>

      {caps.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium">No departments declared yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Self-serve onboarding is a declared stub for this cut: institutions and their
            departments are seeded. Nothing can be routed to a department Milan does not know
            exists.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {caps.map((c) => (
            <li key={c.id}>
              <CapabilityCard {...c} />
            </li>
          ))}
        </ul>
      )}
    </RoleShell>
  );
}
