/**
 * The nightly job: rescore, drain the outbox, anchor the ledger.
 *
 * Separate from the five-minute reaper because these are the things that should
 * happen once a day and would be waste at cron frequency. Same authentication.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { anchorLedger } from "@/lib/ledger/anchor";
import { drainOutbox } from "@/lib/outbox/drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const given = bearer || new URL(request.url).searchParams.get("secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { rescoreAll } = await import("@/lib/ai/stages/s4");
  const rescored = await rescoreAll();
  const drained = await drainOutbox();
  const anchor = await anchorLedger();

  return NextResponse.json({ rescored, drained, anchor });
}

export const GET = handle;
export const POST = handle;
