/**
 * Streams a proof-of-affiliation document to an admin reviewing it on
 * /admin/verification. Same shape as app/api/artifacts/download/route.ts:
 * fetch the stored bytes by key, fail loudly (never silently) if storage is
 * unreachable (invariant 8).
 */
import { eq } from "drizzle-orm";

import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getObject } from "@/lib/media/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPE: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

export async function GET(request: Request) {
  await requireRole("ADMIN");

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return new Response("Missing userId.", { status: 400 });

  const [row] = await db
    .select({ key: userProfiles.orgProofDocumentKey })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  if (!row?.key) return new Response("No document on file.", { status: 404 });

  const bytes = await getObject(row.key);
  if (!bytes) {
    return new Response("The document could not be retrieved from object storage.", { status: 503 });
  }

  const ext = row.key.split(".").pop() ?? "";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": CONTENT_TYPE[ext] ?? "application/octet-stream",
      "content-disposition": `inline; filename="proof.${ext}"`,
    },
  });
}
