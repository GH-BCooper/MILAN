"use server";

/**
 * Project milestones and activity.
 *
 * Every write here touches `projects.last_activity_at`, and that column has to
 * stay honest because Phase 3's inactivity ladder reads it and nothing else: a
 * project that goes quiet for 30 days becomes AT_RISK and one that goes quiet
 * for 45 is offered to another team. A stale timestamp would either escalate a
 * working team or protect a dead one.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, milestones, projects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/guards";

const MilestoneSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(4, "Say what the milestone is.").max(160),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
});

const CompleteSchema = z.object({
  milestoneId: z.string().uuid(),
  projectId: z.string().uuid(),
  completed: z.boolean(),
});

export type ProjectResult = { ok: true; message: string } | { ok: false; error: string };

/** Membership is rechecked here, never trusted from the form. */
async function assertOwnsProject(projectId: string, orgId: string | null) {
  if (!orgId) return null;
  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  return project ?? null;
}

export async function addMilestoneAction(raw: unknown): Promise<ProjectResult> {
  const user = await requireRole("HEI_MEMBER");
  const parsed = MilestoneSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That could not be read." };
  }

  const project = await assertOwnsProject(parsed.data.projectId, user.orgId);
  if (!project) return { ok: false, error: "That project is not one of yours." };

  const at = clockNow();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(milestones).values({
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        dueAt: parsed.data.dueAt ? new Date(`${parsed.data.dueAt}T00:00:00Z`) : null,
        notes: parsed.data.notes,
      });
      await tx
        .update(projects)
        .set({ lastActivityAt: at })
        .where(eq(projects.id, parsed.data.projectId));
      await tx.insert(auditLog).values({
        actorId: user.id,
        action: "MILESTONE_ADDED",
        targetType: "project",
        targetId: parsed.data.projectId,
        meta: { title: parsed.data.title, dueAt: parsed.data.dueAt },
        createdAt: at,
      });
    });
  } catch (e) {
    console.error("[hei/project] milestone failed", e);
    return { ok: false, error: "That could not be saved." };
  }

  revalidatePath(`/hei/projects/${parsed.data.projectId}`);
  return { ok: true, message: "Milestone added. The inactivity clock has been reset." };
}

export async function setMilestoneDoneAction(raw: unknown): Promise<ProjectResult> {
  const user = await requireRole("HEI_MEMBER");
  const parsed = CompleteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That could not be read." };

  const project = await assertOwnsProject(parsed.data.projectId, user.orgId);
  if (!project) return { ok: false, error: "That project is not one of yours." };

  const at = clockNow();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(milestones)
        .set({ completedAt: parsed.data.completed ? at : null })
        .where(eq(milestones.id, parsed.data.milestoneId));
      await tx
        .update(projects)
        .set({ lastActivityAt: at })
        .where(eq(projects.id, parsed.data.projectId));
      await tx.insert(auditLog).values({
        actorId: user.id,
        action: parsed.data.completed ? "MILESTONE_COMPLETED" : "MILESTONE_REOPENED",
        targetType: "project",
        targetId: parsed.data.projectId,
        meta: { milestoneId: parsed.data.milestoneId },
        createdAt: at,
      });
    });
  } catch (e) {
    console.error("[hei/project] milestone update failed", e);
    return { ok: false, error: "That could not be saved." };
  }

  revalidatePath(`/hei/projects/${parsed.data.projectId}`);
  return {
    ok: true,
    message: parsed.data.completed ? "Marked done." : "Reopened.",
  };
}
