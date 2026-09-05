"use server";

/**
 * Publishing an artifact, and deciding who may read a restricted one.
 *
 * The licence choice is on the form with its consequences in plain language,
 * because "CC-BY or RESTRICTED" means nothing to a final-year student and the
 * decision is permanent for everybody downstream.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { accessRequests, artifacts, auditLog, challenges, projectMembers, projects } from "@/lib/db/schema";
import { appendEntry } from "@/lib/ledger/append";
import { publishArtifact } from "@/lib/artifacts/publish";
import { notify } from "@/lib/notify";

const PublishInput = z.object({
  projectId: z.string().uuid(),
  kind: z.string().min(2).max(40),
  title: z.string().trim().min(5).max(300),
  abstract: z.string().trim().min(20, "An abstract of at least twenty characters. It is always public.").max(5000),
  licence: z.enum(["CC_BY", "RESTRICTED"]),
});

export interface PublishState {
  ok: boolean;
  message: string;
  artifactId?: string;
  contentHash?: string;
  deduped?: boolean;
}

async function assertOnTeam(projectId: string, userId: string, role: string) {
  if (role === "ADMIN") return;
  const [member] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  const [lead] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.leadUserId, userId)))
    .limit(1);
  if (!member && !lead) throw new Error("You are not on this project team.");
}

export async function publishArtifactAction(_prev: PublishState | null, form: FormData): Promise<PublishState> {
  const user = await requireRole("HEI_MEMBER", "INDEPENDENT_INNOVATOR", "ADMIN");

  const parsed = PublishInput.safeParse({
    projectId: form.get("projectId"),
    kind: form.get("kind") ?? "REPORT",
    title: form.get("title"),
    abstract: form.get("abstract"),
    licence: form.get("licence"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That could not be read." };

  await assertOnTeam(parsed.data.projectId, user.id, user.role);

  const upload = form.get("file");
  let file: { bytes: Buffer; mime: string; name: string } | null = null;
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > 25 * 1024 * 1024) return { ok: false, message: "That file is over 25 MB. Split it or link to it." };
    file = { bytes: Buffer.from(await upload.arrayBuffer()), mime: upload.type || "application/octet-stream", name: upload.name };
  }

  const result = await publishArtifact({ ...parsed.data, authorId: user.id, file });

  // Publishing is a project write, so the SILENT ladders are rescheduled from
  // now — see lib/sla/deadlines.ts. That happens through the state machine when
  // the challenge moves; the last_activity_at bump is in publishArtifact.
  await db.insert(auditLog).values({
    actorId: user.id,
    action: "hei.artifact.publish",
    targetType: "artifact",
    targetId: result.artifactId,
    reason: `Published under ${parsed.data.licence}`,
    meta: { contentHash: result.contentHash, deduped: result.deduped, ledgerSeq: result.ledgerSeq },
    createdAt: clockNow(),
  });

  revalidatePath(`/hei/projects/${parsed.data.projectId}`);

  return {
    ok: true,
    artifactId: result.artifactId,
    contentHash: result.contentHash,
    deduped: result.deduped,
    message:
      `Published under ${parsed.data.licence === "CC_BY" ? "CC-BY" : "a restricted licence"}. ` +
      `Ledger entry ${result.ledgerSeq}, content hash ${result.contentHash.slice(0, 16)}…` +
      (result.deduped ? " These exact bytes were already in the store, so this is the same object — that is the dedup working, not a failure." : "") +
      (result.storageAvailable ? "" : " The file could not be stored (object storage unreachable); the metadata and the hash are published and the file can be re-attached."),
  };
}

/* ----------------------------------------------------- restricted access */

const RequestInput = z.object({
  artifactId: z.string().uuid(),
  purpose: z.string().trim().min(20, "Say what you want to use it for, in at least twenty characters.").max(2000),
});

export async function requestAccessAction(_prev: PublishState | null, form: FormData): Promise<PublishState> {
  // A verified identity, not an anonymous download. That is the whole point.
  const user = await requireRole("INDUSTRY", "HEI_MEMBER", "GOVERNMENT", "EXPERT_PANEL", "INDEPENDENT_INNOVATOR", "ADMIN");
  const parsed = RequestInput.safeParse({ artifactId: form.get("artifactId"), purpose: form.get("purpose") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That could not be read." };

  const [artifact] = await db
    .select({ id: artifacts.id, projectId: artifacts.projectId, title: artifacts.title, licence: artifacts.licence })
    .from(artifacts)
    .where(eq(artifacts.id, parsed.data.artifactId))
    .limit(1);
  if (!artifact) return { ok: false, message: "That artifact does not exist." };
  if (artifact.licence === "CC_BY") return { ok: false, message: "This artifact is CC-BY. You can download it now; no request is needed." };

  const at = clockNow();
  await db
    .insert(accessRequests)
    .values({ artifactId: artifact.id, requesterId: user.id, orgId: user.orgId, purpose: parsed.data.purpose, createdAt: at })
    .onConflictDoUpdate({
      target: [accessRequests.artifactId, accessRequests.requesterId],
      set: { purpose: parsed.data.purpose, state: "PENDING", decidedAt: null, decidedBy: null },
    });

  const [project] = await db
    .select({ leadUserId: projects.leadUserId })
    .from(projects)
    .where(eq(projects.id, artifact.projectId))
    .limit(1);

  if (project?.leadUserId) {
    await notify({
      userId: project.leadUserId,
      kind: "ACCESS_REQUEST",
      title: "Someone has asked to read your restricted report",
      body: `${user.fullName} wants access to "${artifact.title}". Their stated purpose: ${parsed.data.purpose}`,
      actionUrl: `/hei/projects/${artifact.projectId}`,
      channels: ["inapp", "email"],
    });
  }

  revalidatePath(`/artifacts/${artifact.id}`);
  return { ok: true, message: "Request sent to the project lead. You will be notified either way." };
}

const DecideInput = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["GRANT", "DENY"]),
  note: z.string().trim().max(1000).optional(),
});

export async function decideAccessAction(_prev: PublishState | null, form: FormData): Promise<PublishState> {
  const user = await requireRole("HEI_MEMBER", "INDEPENDENT_INNOVATOR", "ADMIN");
  const parsed = DecideInput.safeParse({
    requestId: form.get("requestId"),
    decision: form.get("decision"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "That could not be read." };

  const [req] = await db
    .select({
      id: accessRequests.id,
      artifactId: accessRequests.artifactId,
      requesterId: accessRequests.requesterId,
      purpose: accessRequests.purpose,
      projectId: artifacts.projectId,
      title: artifacts.title,
    })
    .from(accessRequests)
    .innerJoin(artifacts, eq(artifacts.id, accessRequests.artifactId))
    .where(eq(accessRequests.id, parsed.data.requestId))
    .limit(1);
  if (!req) return { ok: false, message: "That request does not exist." };

  await assertOnTeam(req.projectId, user.id, user.role);

  const at = clockNow();
  const granted = parsed.data.decision === "GRANT";

  await db.transaction(async (tx) => {
    await tx
      .update(accessRequests)
      .set({ state: granted ? "GRANTED" : "DENIED", decidedBy: user.id, decidedAt: at, decisionNote: parsed.data.note ?? null })
      .where(eq(accessRequests.id, req.id));

    await appendEntry(tx, {
      projectId: req.projectId,
      kind: "ACCESS",
      authorId: user.id,
      at,
      payload: {
        event: granted ? "ACCESS_GRANTED" : "ACCESS_DENIED",
        artifactId: req.artifactId,
        artifactTitle: req.title,
        requesterId: req.requesterId,
        purpose: req.purpose,
        decidedBy: user.fullName,
        at: at.toISOString(),
      },
    });
  });

  await notify({
    userId: req.requesterId,
    kind: "ACCESS_DECISION",
    title: granted ? "Your access request was granted" : "Your access request was declined",
    body: granted
      ? `You can now download "${req.title}". Every download is logged with your name, your organisation and the purpose you stated.`
      : `The project lead declined access to "${req.title}".${parsed.data.note ? ` Reason: ${parsed.data.note}` : ""}`,
    actionUrl: `/artifacts/${req.artifactId}`,
    channels: ["inapp", "email"],
  });

  revalidatePath(`/hei/projects/${req.projectId}`);
  return { ok: true, message: granted ? "Granted. Every download will be logged." : "Declined, and the requester has been told." };
}

/** Used by the challenge page to move to SOLUTION_PUBLISHED after an artifact lands. */
export async function markPublishedAction(_prev: PublishState | null, form: FormData): Promise<PublishState> {
  const user = await requireRole("HEI_MEMBER", "INDEPENDENT_INNOVATOR", "ADMIN");
  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) return { ok: false, message: "No project." };
  await assertOnTeam(projectId, user.id, user.role);

  const [project] = await db
    .select({ challengeId: projects.challengeId, lastActivityAt: projects.lastActivityAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { ok: false, message: "No project." };

  const { transition, canTransition } = await import("@/lib/db/stateMachine");
  const [c] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, project.challengeId)).limit(1);
  if (!c) return { ok: false, message: "No challenge." };
  if (!canTransition(c.status, "SOLUTION_PUBLISHED")) {
    return { ok: false, message: `A challenge at ${c.status} cannot be marked published. The state machine refuses illegal edges rather than letting the data drift.` };
  }

  await db.transaction(async (tx) => {
    await transition(tx, {
      challengeId: project.challengeId,
      to: "SOLUTION_PUBLISHED",
      actorId: user.id,
      projectId,
      lastActivityAt: clockNow(),
      reason: "Solution artifact published.",
    });
  });

  revalidatePath(`/hei/projects/${projectId}`);
  return { ok: true, message: "Marked as published. The challenge is now visible to industry on /industry/discover." };
}
