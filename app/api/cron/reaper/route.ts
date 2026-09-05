/**
 * The SLA reaper, on a schedule.
 *
 * Called by Vercel Cron every five minutes and by the /demo console after a
 * clock fast-forward. Both paths present `CRON_SECRET`; the comparison is
 * constant-time, because an endpoint that can move a challenge's state is worth
 * a timing attack even at hackathon scale.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runReaper } from "@/lib/sla/reaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const url = new URL(request.url);
  const given = bearer || url.searchParams.get("secret") || request.headers.get("x-cron-secret") || "";

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "");
  const result = await runReaper(Number.isFinite(limit) && limit > 0 ? { limit } : {});
  return NextResponse.json(result, { status: result.errors.length > 0 ? 207 : 200 });
}

export const GET = handle;
export const POST = handle;
