/**
 * The clock button, over HTTP.
 *
 * The /demo page uses server actions; these routes are the same actions behind a
 * URL so the verification harness can drive the exact code path a judge presses,
 * rather than a parallel one that might diverge from it. ADMIN is rechecked
 * inside each action.
 */
import { NextResponse } from "next/server";

import { advanceAndReap } from "@/app/(admin)/demo/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await advanceAndReap(null, form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
