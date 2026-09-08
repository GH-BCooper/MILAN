/**
 * Start the pipeline for a challenge. POST, fire-and-forget.
 *
 * The browser side is the success page: it asks here to begin, then watches
 * the receipts land by polling /api/pipeline/trace. This route intentionally
 * does not stream — a poll is stateless, survives refreshes, and can never
 * pretend progress that the database has not recorded.
 *
 * Authorisation matches the old SSE stream exactly: a fresh challenge runs
 * for anyone (the citizen's own submission, seconds old); a replay needs the
 * reporter, a government user or an admin — a stranger must not be able to
 * spend our tokens or move someone else's challenge.
 */
import { after } from "next/server";
import { eq } from "drizzle-orm";

import { currentUser } from "@/lib/auth/guards";
import { inflightPromise, runOnce } from "@/lib/ai/inflight";
import { runPipeline } from "@/lib/ai/pipeline";
import { projectTrace } from "@/lib/ai/trace-projection";
import { db } from "@/lib/db";
import { challenges } from "@/lib/db/schema";
import { isTerminal } from "@/lib/db/stateMachine";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const trackingId = url.searchParams.get("trackingId")?.toUpperCase();
  const replay = url.searchParams.get("replay") === "1";

  if (!trackingId) {
    return Response.json({ error: "trackingId is required" }, { status: 400 });
  }

  const [challenge] = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      status: challenges.status,
      reporterId: challenges.reporterId,
    })
    .from(challenges)
    .where(eq(challenges.trackingId, trackingId))
    .limit(1);

  if (!challenge) {
    return Response.json({ error: "no such challenge" }, { status: 404 });
  }

  const user = await currentUser();
  const privileged =
    user?.role === "ADMIN" ||
    user?.role === "GOVERNMENT" ||
    (user?.id !== undefined && user.id === challenge.reporterId);

  if (replay && !privileged) {
    return Response.json(
      { error: "Replaying the pipeline needs the reporter, a district officer or an admin." },
      { status: 403 },
    );
  }

  /* "Fresh" cannot be read from the status alone: a report S1 held for a
   * human stays SUBMITTED forever, by design, and it may have been through a
   * full pipeline run already. The receipts are the authority — if the trace
   * is complete, a stranger re-running it would only spend tokens and noise. */
  const projection = await projectTrace(challenge.id);

  if (!replay && !privileged && projection?.complete) {
    return Response.json(
      { error: "This challenge has already been through the pipeline. Ask for a replay." },
      { status: 403 },
    );
  }
  if (isTerminal(challenge.status) && !privileged) {
    return Response.json({ error: "This challenge is closed." }, { status: 403 });
  }

  /**
   * Start the run now, not inside `after()`.
   *
   * `after()` exists to keep a *serverless invocation* alive past the point
   * where the response has been sent — it is a lifetime extension, not a
   * scheduler. Registering the run itself inside its callback made starting
   * the pipeline depend on that callback actually firing promptly, and in
   * `next dev` a file-watcher recompile between the response and the
   * deferred callback could delay or drop it — the success page would then
   * sit on "waiting" until the citizen reloaded the page, at which point the
   * server component re-read the (by-then-finished, or now-restarted) trace
   * directly and looked fine. Calling `runOnce` here, synchronously, starts
   * the pipeline in the same tick as the request — it does not block the
   * response, because it is not awaited — and removes that dependency
   * entirely, in dev and in production alike.
   *
   * `after()` is still used, but only for its real job: holding this
   * invocation open (Vercel Fluid Compute, Node runtime) until the tracked
   * promise settles, so the platform cannot freeze or recycle the function
   * mid-run the way it would once the response finishes.
   */
  const started = runOnce(challenge.id, () => runPipeline(challenge.id, async () => undefined));
  // The success page shows a spinner from this response until the receipts
  // land; these two lines are how a terminal tells "the run is slow" apart
  // from "the run never started" and "the run wedged mid-flight".
  console.info(`[pipeline] run ${started ? "started" : "already in flight"} for ${challenge.trackingId}`);
  const tracked = inflightPromise(challenge.id);
  if (tracked) {
    after(async () => {
      await tracked;
      console.info(`[pipeline] run finished for ${challenge.trackingId}`);
    });
  }

  return Response.json({ ok: true, trackingId: challenge.trackingId });
}
