import Link from "next/link";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { verificationQueue } from "./queue";
import { VerificationCard } from "./verification-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verification" };

/** /admin/verification — the proof-of-affiliation queue.
 *
 * Real institutional onboarding (an MoU, a nodal officer, a verified email
 * domain) is a declared stub; this is that stub's gate. An HEI/Industry
 * self-registration cannot claim a challenge or use industry tools until an
 * admin approves it here — see lib/auth/guards.ts requireRole(). */
export default async function AdminVerification() {
  const user = await requireRole("ADMIN");
  const queue = await verificationQueue();

  return (
    <RoleShell
      title="Verification"
      subtitle={`Signed in as ${user.fullName}. ${queue.length} account${queue.length === 1 ? "" : "s"} waiting on a proof-of-affiliation review.`}
    >
      <p className="milan-glass rounded-xl bg-muted p-4 text-sm">
        Every HEI or Industry self-registration lands here before its dashboard unlocks. See{" "}
        <Link className="text-primary underline underline-offset-4" href="/admin/triage">
          the triage queue
        </Link>{" "}
        for AI-proposed classifications that need a human instead.
      </p>

      {queue.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium">Nothing waiting.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every HEI/Industry registration since the last review has been decided.
          </p>
        </div>
      ) : (
        <ol className="mt-6 space-y-4">
          {queue.map((item) => (
            <li key={item.userId}>
              <VerificationCard item={item} />
            </li>
          ))}
        </ol>
      )}
    </RoleShell>
  );
}
