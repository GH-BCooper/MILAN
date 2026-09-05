/**
 * Downloading an artifact.
 *
 * A CC-BY file is served to anyone. A RESTRICTED file is served only to the
 * project team or to someone the lead has granted, and every one of those reads
 * writes an `access_log` row AND an `ACCESS` ledger entry in the same
 * transaction as the read is authorised. There is no path through this handler
 * that returns restricted bytes without leaving a record.
 */
import { eq } from "drizzle-orm";

import { currentUser } from "@/lib/auth/guards";
import { mayDownload } from "@/lib/artifacts/publish";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { accessLog, accessRequests, artifacts } from "@/lib/db/schema";
import { appendEntry } from "@/lib/ledger/append";
import { getObject } from "@/lib/media/storage";
import { and } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id.", { status: 400 });

  const user = await currentUser();
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  if (!artifact) return new Response("No such artifact.", { status: 404 });
  if (!artifact.storageKey) return new Response("This artifact has no file.", { status: 404 });

  const access = await mayDownload(id, user?.id ?? null);
  if (!access.allowed) return new Response(access.reason, { status: 403 });

  const at = clockNow();

  if (artifact.licence === "RESTRICTED" && user) {
    const [req] = await db
      .select({ purpose: accessRequests.purpose })
      .from(accessRequests)
      .where(and(eq(accessRequests.artifactId, id), eq(accessRequests.requesterId, user.id)))
      .limit(1);

    await db.transaction(async (tx) => {
      await tx.insert(accessLog).values({
        artifactId: id,
        userId: user.id,
        orgId: user.orgId,
        purpose: req?.purpose ?? "Project team member",
        createdAt: at,
      });
      await appendEntry(tx, {
        projectId: artifact.projectId,
        kind: "ACCESS",
        authorId: user.id,
        at,
        payload: {
          event: "ARTIFACT_DOWNLOADED",
          artifactId: id,
          contentHash: artifact.contentHash,
          by: user.fullName,
          orgId: user.orgId,
          purpose: req?.purpose ?? "Project team member",
          at: at.toISOString(),
        },
      });
    });
  }

  const bytes = await getObject(artifact.storageKey);
  if (!bytes) {
    // Invariant 8: object storage being unreachable is reported, not disguised.
    return new Response(
      "The file could not be retrieved from object storage. Its hash and its publication record are still on the artifact page.",
      { status: 503 },
    );
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${artifact.contentHash?.slice(0, 16) ?? "artifact"}"`,
      "x-milan-content-hash": artifact.contentHash ?? "",
    },
  });
}
