import { NextResponse } from "next/server";

import { claimChallengeAction } from "@/app/(hei)/hei/challenges/[trackingId]/claim/actions";

/**
 * Machine-facing claim.
 *
 * The same seam Phase 1 established for `/api/intake`: it calls the identical
 * server action, with the identical `requireRole("HEI_MEMBER")` check and the
 * identical transaction. It exists so the verification harness can drive the
 * claim over real HTTP with a real session cookie rather than reaching around
 * the auth it is supposed to be testing — and so a university's own systems
 * could one day claim without a browser.
 *
 * There is no privileged path here. An unauthenticated caller is refused by the
 * same guard that refuses one in the UI.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const result = await claimChallengeAction(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
