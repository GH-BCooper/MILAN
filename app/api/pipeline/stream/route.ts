/**
 * The live pipeline trace, over Server-Sent Events.
 *
 * A normal HTTP response held open, streaming `data: {...}\n\n`. No websocket
 * server, no library, no second runtime (CLAUDE.md section 3). The browser side
 * is `new EventSource(url)` and `onmessage`.
 *
 * Every tick a judge sees on screen corresponds to one real row in `ai_runs`.
 * If they ask whether the animation is fake, open /admin/ai-runs.
 */
import { eq } from "drizzle-orm";

import { currentUser } from "@/lib/auth/guards";
import { runPipeline, type PipelineEvent } from "@/lib/ai/pipeline";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges } from "@/lib/db/schema";
import { isTerminal } from "@/lib/db/stateMachine";

export const dynamic = "force-dynamic";
// Node, not edge: the pipeline reaches the database and the provider chain, and
// streaming works perfectly well on the default runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
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

  /**
   * Authorisation, rechecked here and not left to middleware.
   *
   * Watching the pipeline is a read of a public page's own workings, so anyone
   * may watch. RUNNING it is a write, and a stranger must not be able to spend
   * our tokens or move someone else's challenge: a fresh challenge runs for
   * anyone (that is the citizen's own submission, seconds old), and a replay
   * needs the reporter, a government user or an admin.
   */
  const user = await currentUser();
  const fresh = challenge.status === "SUBMITTED" || challenge.status === "NEEDS_MORE_INFO";
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
  if (!replay && !fresh && !privileged) {
    return Response.json(
      { error: "This challenge has already been through the pipeline. Ask for a replay." },
      { status: 403 },
    );
  }
  if (isTerminal(challenge.status) && !privileged) {
    return Response.json({ error: "This challenge is closed." }, { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // A comment line flushes any proxy that is holding the first byte back.
      controller.enqueue(encoder.encode(": milan pipeline trace\n\n"));

      // The client going away must not leave the pipeline half-run against a
      // dead socket; the run finishes, the events simply stop being written.
      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      try {
        await runPipeline(challenge.id, send);
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
          at: clockNow().toISOString(),
        });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform matters as much as no-cache: some proxies will happily
      // buffer or gzip a stream into uselessness otherwise.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
