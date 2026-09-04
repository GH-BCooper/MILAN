import { NextResponse } from "next/server";

import { submitChallengeAction } from "@/app/(citizen)/submit/actions";

/**
 * Machine-facing intake.
 *
 * Same validation, same transaction, same rate limit as the wizard — it calls
 * the identical server action. Anonymous submission is allowed here exactly as
 * it is in the browser: a citizen must never need an account to report that the
 * embankment above their village is cracked.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const result = await submitChallengeAction(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
