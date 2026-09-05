import { NextResponse } from "next/server";

import { runScenario } from "@/app/(admin)/demo/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await runScenario(null, form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
