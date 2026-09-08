import { NextResponse } from "next/server";

import { markPublishedAction } from "@/app/(hei)/hei/projects/[id]/artifact-actions";

/**
 * Machine-facing publish.
 *
 * The same seam as `/api/hei/claim`: it calls the identical server action, with
 * the identical role and team-membership checks and the identical transaction,
 * so the verification harness can drive the publish over real HTTP with a real
 * session cookie. It exists because marking a solution published is the step
 * that carries an accepted funder into INDUSTRY_INTEREST (H-17), and that
 * transition is exactly what the harness must be able to prove end to end.
 *
 * There is no privileged path here. An unauthenticated caller is refused by the
 * same guard that refuses one in the UI.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await markPublishedAction(null, form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
