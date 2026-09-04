import { NextResponse } from "next/server";

import { uploadEvidenceAction } from "@/app/(citizen)/submit/actions";

/**
 * Machine-facing evidence upload.
 *
 * The wizard calls the server action directly. This route exists so that a
 * non-browser client can use the same code path — the IVR and WhatsApp intake
 * routes are declared stubs for this cut, and the Phase 1 verification harness
 * is the first consumer. It deliberately shares the action rather than
 * duplicating the EXIF-stripping logic, because a second copy is a second place
 * for GPS data to survive.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await uploadEvidenceAction(form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
