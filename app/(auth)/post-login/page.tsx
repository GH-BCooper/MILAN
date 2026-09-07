import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/guards";
import { HOME_FOR } from "@/lib/auth/home";
import { db } from "@/lib/db";
import { user as userTable, userProfiles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Sign-in with no explicit "next" lands here. An account that never finished
 *  its email/phone OTP (closed the tab mid-registration, say) goes back to
 *  /verify-account; everyone else is bounced straight to their own approved
 *  page — CITIZEN to /me, HEI_MEMBER to /hei, and so on (lib/auth/home.ts).
 *  requireRole() separately redirects a still-PENDING HEI/Industry account
 *  onward from there. */
export default async function PostLoginPage() {
  const me = await requireUser("/post-login");

  const [row] = await db
    .select({ emailVerified: userTable.emailVerified, phoneVerified: userProfiles.phoneVerified })
    .from(userTable)
    .innerJoin(userProfiles, eq(userProfiles.userId, userTable.id))
    .where(eq(userTable.id, me.id))
    .limit(1);

  if (!row?.emailVerified || !row.phoneVerified) redirect("/verify-account");
  redirect(HOME_FOR[me.role]);
}
