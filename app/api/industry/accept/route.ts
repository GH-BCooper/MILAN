/**
 * Accepting or declining an expression of interest, over HTTP.
 *
 * The same server action the EOI page uses, behind a route, so that the
 * verification harness and the /demo console can drive it without scraping a
 * form. Role and team membership are rechecked inside the action.
 */
import { NextResponse } from "next/server";

import { respondToInterest } from "@/app/(industry)/industry/challenges/[trackingId]/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await respondToInterest(null, form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
