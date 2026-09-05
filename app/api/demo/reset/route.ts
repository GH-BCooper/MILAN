import { NextResponse } from "next/server";

import { resetDemoState } from "@/app/(admin)/demo/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const result = await resetDemoState();
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
