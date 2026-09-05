import { NextResponse } from "next/server";

import { proposeFramingAction } from "@/app/(citizen)/submit/actions";

/**
 * Machine-facing framing proposal.
 *
 * The same seam as `/api/intake`: the wizard calls the server action directly,
 * and this route lets the IVR and WhatsApp stubs — and the verification
 * harness — reach the identical code path with the identical rate limit.
 *
 * It proposes. It writes nothing. Whatever comes back is a suggestion for the
 * citizen to accept or reject, and only what they approve is ever submitted.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const result = await proposeFramingAction(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
