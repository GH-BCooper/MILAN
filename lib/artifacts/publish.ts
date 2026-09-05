/**
 * Publishing an artifact.
 *
 * Two rules that are not negotiable and are visible on the artifact page:
 *
 *  1. The storage object is keyed by the SHA-256 of the file's own bytes. The
 *     same file uploaded twice is one object, which is dedup for free and, more
 *     importantly, means the ledger can cite the file by a hash anybody holding
 *     the file can recompute. The page says so, and shows when a dedup happened.
 *  2. Title, problem and abstract are ALWAYS public, whatever the licence. A
 *     RESTRICTED artifact restricts the FILE, never the knowledge that the work
 *     exists — otherwise "restricted" becomes a way to make a citizen's problem
 *     disappear, which is loophole row 11.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { artifacts, challenges, projects, type Licence } from "@/lib/db/schema";
import { appendEntry } from "@/lib/ledger/append";
import { sha256Hex } from "@/lib/ledger/hash";
import { putObject } from "@/lib/media/storage";

export interface PublishInput {
  projectId: string;
  kind: string;
  title: string;
  abstract: string;
  licence: Licence;
  authorId: string;
  file?: { bytes: Buffer; mime: string; name: string } | null;
}

export interface PublishResult {
  artifactId: string;
  contentHash: string;
  storageKey: string | null;
  deduped: boolean;
  ledgerSeq: number;
  entryHash: string;
  storageAvailable: boolean;
}

export async function publishArtifact(input: PublishInput): Promise<PublishResult> {
  const at = clockNow();

  // The hash of the bytes, computed before anything is stored. With no file the
  // hash is of the abstract, so a text-only artifact is still citable by hash.
  const contentHash = input.file
    ? sha256Hex(input.file.bytes)
    : sha256Hex(`${input.title}\n\n${input.abstract}`);

  const storageKey = input.file ? `artifacts/${contentHash}` : null;

  // Was this file already in the store? Same bytes, same key, one object.
  const existing = storageKey
    ? await db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.contentHash, contentHash)).limit(1)
    : [];
  const deduped = existing.length > 0;

  let storageAvailable = true;
  if (input.file && storageKey) {
    const stored = await putObject(storageKey, input.file.bytes, input.file.mime);
    // Invariant 8: storage being unreachable degrades the artifact to its
    // metadata rather than losing the publication.
    storageAvailable = stored !== null;
  }

  const [project] = await db
    .select({ challengeId: projects.challengeId, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) throw new Error(`project ${input.projectId} does not exist`);

  const [challenge] = await db
    .select({ trackingId: challenges.trackingId })
    .from(challenges)
    .where(eq(challenges.id, project.challengeId))
    .limit(1);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(artifacts)
      .values({
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        abstract: input.abstract,
        storageKey,
        contentHash,
        licence: input.licence,
        publishedAt: at,
      })
      .returning({ id: artifacts.id });

    const entry = await appendEntry(tx, {
      challengeId: project.challengeId,
      projectId: input.projectId,
      kind: "REPORT",
      authorId: input.authorId,
      at,
      // The ledger commits to the FILE, not to a description of it. That is what
      // makes this a defensive publication rather than a claim of one.
      contentHash,
      payload: {
        event: "ARTIFACT_PUBLISHED",
        artifactId: row.id,
        trackingId: challenge?.trackingId ?? null,
        title: input.title,
        abstract: input.abstract,
        licence: input.licence,
        contentHash,
        storageKey,
        deduped,
        at: at.toISOString(),
        note:
          "Title, problem and abstract are public regardless of licence. A RESTRICTED licence restricts " +
          "the file, never the knowledge that this work exists.",
      },
    });

    await tx
      .update(projects)
      .set({ lastActivityAt: at, ipTrack: input.licence === "CC_BY" ? "OPEN" : "RESTRICTED" })
      .where(eq(projects.id, input.projectId));

    return { artifactId: row.id, ledgerSeq: entry.seq, entryHash: entry.entryHash };
  });

  return { ...result, contentHash, storageKey, deduped, storageAvailable };
}

/** Whether this user may download the file behind a RESTRICTED artifact. */
export async function mayDownload(artifactId: string, userId: string | null): Promise<{ allowed: boolean; reason: string }> {
  const [a] = await db
    .select({ licence: artifacts.licence, projectId: artifacts.projectId })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  if (!a) return { allowed: false, reason: "That artifact does not exist." };
  if (a.licence === "CC_BY") return { allowed: true, reason: "Published under CC-BY. Anyone may download it, with attribution." };
  if (!userId) return { allowed: false, reason: "This artifact is restricted. Sign in and request access with a stated purpose." };

  const { accessRequests, projectMembers } = await import("@/lib/db/schema");

  const [member] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, a.projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (member) return { allowed: true, reason: "You are on the project team." };

  const [granted] = await db
    .select({ state: accessRequests.state })
    .from(accessRequests)
    .where(and(eq(accessRequests.artifactId, artifactId), eq(accessRequests.requesterId, userId)))
    .limit(1);

  if (granted?.state === "GRANTED") return { allowed: true, reason: "Access granted by the project lead. This download is logged." };
  if (granted?.state === "PENDING") return { allowed: false, reason: "Your request is with the project lead." };
  if (granted?.state === "DENIED") return { allowed: false, reason: "The project lead declined this request." };
  return { allowed: false, reason: "This artifact is restricted. Request access with a stated purpose." };
}
