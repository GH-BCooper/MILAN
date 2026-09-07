import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guards";
import { HOME_FOR } from "@/lib/auth/home";
import { db } from "@/lib/db";
import { user as userTable, userProfiles } from "@/lib/db/schema";
import { OtpBox } from "./otp-form";

export const metadata = { title: "Verify your account" };
export const dynamic = "force-dynamic";

/** Every new account lands here straight out of registration. Both channels
 *  must be verified before a citizen/government/admin account reaches its
 *  dashboard; an HEI/Industry account still needs admin approval of its proof
 *  of affiliation after that (lib/auth/guards.ts requireRole enforces it, so
 *  this page's own redirect below is a convenience, not the real gate). */
export default async function VerifyAccountPage() {
  const me = await requireUser("/verify-account");

  const [row] = await db
    .select({ emailVerified: userTable.emailVerified, phoneVerified: userProfiles.phoneVerified, phone: userProfiles.phone })
    .from(userTable)
    .innerJoin(userProfiles, eq(userProfiles.userId, userTable.id))
    .where(eq(userTable.id, me.id))
    .limit(1);

  const emailVerified = row?.emailVerified ?? false;
  const phoneVerified = row?.phoneVerified ?? false;

  if (emailVerified && phoneVerified) {
    const needsProof = me.role === "HEI_MEMBER" || me.role === "INDUSTRY";
    redirect(needsProof && me.orgVerificationStatus !== "APPROVED" ? "/verify-account/pending" : HOME_FOR[me.role]);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Verify your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Two codes, one for your email and one for your phone. Press &ldquo;Send code&rdquo; on each,
        then enter it below — this confirms you actually control both, since Milan uses them to
        reach you about your own reports.
      </p>

      <div className="mt-6 space-y-4">
        <OtpBox kind="email" label="Email" destination={me.email} verified={emailVerified} />
        <OtpBox kind="phone" label="Phone" destination={row?.phone ?? "(no phone on file)"} verified={phoneVerified} />
      </div>
    </div>
  );
}
