import Link from "next/link";
import { eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { organization, userProfiles } from "@/lib/db/schema";

export const metadata = { title: "Verification pending" };
export const dynamic = "force-dynamic";

/** Where an HEI/Industry account lands once both OTPs are verified but its
 *  proof of affiliation has not yet been reviewed on /admin/verification.
 *  requireRole() redirects here from every /hei and /industry page too, so
 *  this is the one place that explanation has to live. */
export default async function VerificationPendingPage() {
  const me = await requireUser("/verify-account/pending");

  const [row] = await db
    .select({ status: userProfiles.orgVerificationStatus, reason: userProfiles.orgVerificationReason, orgName: organization.name })
    .from(userProfiles)
    .leftJoin(organization, eq(organization.id, userProfiles.orgId))
    .where(eq(userProfiles.userId, me.id))
    .limit(1);

  const status = row?.status ?? "PENDING";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {status === "REJECTED" ? "Your proof of affiliation was not accepted" : "Awaiting verification"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {status === "REJECTED"
          ? `An admin reviewed the document you submitted for ${row?.orgName ?? "your organisation"} and could not confirm it.`
          : `A Milan admin is checking the proof of affiliation you submitted for ${row?.orgName ?? "your organisation"}. Your account and email/phone are already verified — this is the last step before the university or industry tools unlock.`}
      </p>
      {row?.reason ? (
        <p className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">{row.reason}</p>
      ) : null}
      <p className="mt-6 text-sm">
        You can still browse public pages while you wait.{" "}
        <Link className="font-medium text-primary underline underline-offset-4" href="/challenges">
          See challenges
        </Link>
      </p>
    </div>
  );
}
