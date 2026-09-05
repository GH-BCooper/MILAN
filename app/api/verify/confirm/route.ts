/**
 * The confirmation, over HTTP.
 *
 * The page uses a server action; this is the same code path behind a route so
 * that the verification harness and the /demo console can drive it, and so that
 * an IVR or WhatsApp integration has a seam to plug into later (the same seam
 * /api/intake is for submission).
 */
import { NextResponse } from "next/server";

import { confirmImpact } from "@/app/(citizen)/me/verify/[token]/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await confirmImpact(null, form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
