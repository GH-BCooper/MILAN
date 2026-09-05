/**
 * The "Verify chain" button's endpoint.
 *
 * Public and unauthenticated on purpose. The claim is that anybody can check the
 * ledger; requiring a login to check it would make the claim smaller than it
 * sounds. It reads and computes, and it writes nothing.
 */
import { NextResponse } from "next/server";

import { chainHead } from "@/lib/ledger/append";
import { verifyChain } from "@/lib/ledger/verify";
import { latestAnchor } from "@/lib/ledger/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const [result, head, anchor] = await Promise.all([verifyChain(), chainHead(), latestAnchor()]);
  return NextResponse.json({
    ...result,
    head,
    anchor: anchor
      ? { seq: anchor.seq, at: anchor.at.toISOString(), receipt: (anchor.payload as { receipt?: unknown }).receipt ?? null }
      : null,
  });
}
