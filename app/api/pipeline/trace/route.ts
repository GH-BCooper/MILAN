/**
 * The pipeline trace, as it stands right now. GET, JSON, short-poll friendly.
 *
 * Reconstructed from the receipts the pipeline left behind (ai_runs rows,
 * routes rows, the challenge's own columns) — never from a live in-flight
 * stream. A page that just submitted polls this every couple of seconds and
 * ticks the stage cards off as the rows land; a page showing an old, already
 * processed report gets the same complete picture in one shot.
 *
 * Who may read: anyone, while the report is still fresh (the citizen watching
 * their own submission go through — that is the whole point of the success
 * page); anyone at all once the run is complete, because by then every part
 * of it is on the public challenge page anyway; while it is mid-run and past
 * the fresh window, only the reporter, government or an admin — the same
 * rule the SSE stream used.
 */
import { eq } from "drizzle-orm";

import { projectTrace } from "@/lib/ai/trace-projection";
import { currentUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { challenges } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const trackingId = url.searchParams.get("trackingId")?.toUpperCase();

  if (!trackingId) {
    return Response.json({ error: "trackingId is required" }, { status: 400 });
  }

  const [challenge] = await db
    .select({
      id: challenges.id,
      status: challenges.status,
      reporterId: challenges.reporterId,
    })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);

  if (!challenge) {
    return Response.json({ error: "no such challenge" }, { status: 404 });
  }

  let projection: Awaited<ReturnType<typeof projectTrace>>;
  try {
    projection = await projectTrace(challenge.id);
  } catch (e) {
    // Per-stage isolation inside projectTrace should make this unreachable;
    // if it fires, the terminal — not a silent spinner — says what broke.
    console.error(`[trace] projection failed for ${trackingId}:`, e);
    return Response.json({ error: "The trace could not be read right now." }, { status: 500 });
  }
  if (!projection) {
    return Response.json({ error: "no such challenge" }, { status: 404 });
  }

  const fresh = challenge.status === "SUBMITTED" || challenge.status === "NEEDS_MORE_INFO";
  if (!fresh && !projection.complete) {
    const user = await currentUser();
    const privileged =
      user?.role === "ADMIN" ||
      user?.role === "GOVERNMENT" ||
      (user?.id !== undefined && user.id === challenge.reporterId);
    if (!privileged) {
      return Response.json(
        { error: "This trace is still being worked out." },
        { status: 403 },
      );
    }
  }

  return Response.json(projection, {
    headers: { "cache-control": "no-store" },
  });
}
