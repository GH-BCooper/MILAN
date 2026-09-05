/** The impact counter, read from the one definition. For the demo harness. */
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/guards";
import { impactCounts } from "@/lib/impact/counter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole("ADMIN");
  return NextResponse.json(await impactCounts());
}
