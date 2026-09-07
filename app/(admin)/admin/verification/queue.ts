import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { organisationsMeta, organization, user, userProfiles } from "@/lib/db/schema";

export interface PendingVerification {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: "HEI_MEMBER" | "INDUSTRY";
  orgId: string | null;
  orgName: string | null;
  orgWebsite: string | null;
  proofType: string | null;
  proofMeta: Record<string, unknown> | null;
  proofDocumentKey: string | null;
}

/** Every HEI/Industry account whose proof of affiliation has not yet been
 *  decided — mirrors app/(admin)/admin/triage/queue.ts's shape. */
export async function verificationQueue(): Promise<PendingVerification[]> {
  const rows = await db
    .select({
      userId: userProfiles.userId,
      fullName: userProfiles.fullName,
      phone: userProfiles.phone,
      role: userProfiles.role,
      orgId: userProfiles.orgId,
      orgName: organization.name,
      orgWebsite: organisationsMeta.website,
      proofType: userProfiles.orgProofType,
      proofMeta: userProfiles.orgProofMeta,
      proofDocumentKey: userProfiles.orgProofDocumentKey,
      email: user.email,
    })
    .from(userProfiles)
    .innerJoin(user, eq(user.id, userProfiles.userId))
    .leftJoin(organization, eq(organization.id, userProfiles.orgId))
    .leftJoin(organisationsMeta, eq(organisationsMeta.orgId, userProfiles.orgId))
    .where(eq(userProfiles.orgVerificationStatus, "PENDING"))
    .orderBy(asc(userProfiles.fullName));

  return rows
    .filter((r): r is typeof r & { role: "HEI_MEMBER" | "INDUSTRY" } => r.role === "HEI_MEMBER" || r.role === "INDUSTRY")
    .map((r) => ({ ...r, proofMeta: (r.proofMeta as Record<string, unknown>) ?? null }));
}
