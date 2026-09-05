import { NextResponse } from "next/server";

import { resolveTriageAction } from "@/app/(admin)/admin/triage/actions";

/**
 * Machine-facing triage decision.
 *
 * The third of the same seam: `/api/intake`, `/api/hei/claim` and this one all
 * call the identical server action with the identical role guard, so the
 * verification harness can drive the real code path over real HTTP with a real
 * session rather than reaching around the auth it is meant to be testing.
 *
 * There is no privileged path here. `requireRole("ADMIN")` refuses an
 * unauthenticated caller exactly as it does in the UI, and the written reason is
 * as mandatory here as it is in the form.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const result = await resolveTriageAction(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
