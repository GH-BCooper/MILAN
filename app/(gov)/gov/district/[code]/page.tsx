import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { ArrivesLater, RoleShell } from "@/components/role-shell";
import { requireDistrict } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { districts } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * A district-scoped page. requireDistrict throws for a government user whose
 * own district does not match, which is what stops the DC of Gumla approving
 * Dhanbads gate items.
 */
export default async function DistrictPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const upper = code.toUpperCase();

  await requireDistrict(upper);

  const [district] = await db.select().from(districts).where(eq(districts.code, upper)).limit(1);
  if (!district) notFound();

  return (
    <RoleShell title={district.name} subtitle={`District ${district.code}`}>
      <ArrivesLater phase={3} what="Per-district SLA board, gate queue and verification queue." />
    </RoleShell>
  );
}
