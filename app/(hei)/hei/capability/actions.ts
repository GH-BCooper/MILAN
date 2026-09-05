"use server";

/**
 * Editing a department's declared capability.
 *
 * The tags and the capacity here are two of the five terms in the match score,
 * so this form is not administrative furniture: it is the control a department
 * has over what gets routed to it. The UI says so, and the numbers change
 * future routing immediately.
 *
 * Changing the tags invalidates the capability's embedding, so it is cleared
 * and the next routing run re-embeds it. Leaving a stale vector attached to new
 * tags would make the semantic term quietly wrong.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, capabilities } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { capabilityText } from "@/lib/ai/routing";
import { parseTags } from "../claim-constants";

const CapabilitySchema = z.object({
  id: z.string().uuid(),
  labName: z.string().trim().max(160).nullable().default(null),
  facultyName: z.string().trim().max(120).nullable().default(null),
  facultyDesignation: z.string().trim().max(120).nullable().default(null),
  /** Comma or pipe separated in the form; normalised to a lower-case array. */
  specialisationTags: z.string().trim().max(2000),
  declaredCapacity: z.number().int().min(0).max(50),
  capacityFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  capacityTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  active: z.boolean().default(true),
});

export type CapabilityResult = { ok: true; message: string } | { ok: false; error: string };

export async function updateCapabilityAction(raw: unknown): Promise<CapabilityResult> {
  const user = await requireRole("HEI_MEMBER");
  if (!user.orgId) return { ok: false, error: "Your account is not attached to an institution." };

  const parsed = CapabilitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That form could not be read." };
  }
  const input = parsed.data;

  const [before] = await db
    .select()
    .from(capabilities)
    .where(and(eq(capabilities.id, input.id), eq(capabilities.orgId, user.orgId)))
    .limit(1);

  if (!before) return { ok: false, error: "That department is not one of yours." };

  const tags = parseTags(input.specialisationTags);
  const at = clockNow();

  // Compare the text the embedding is built FROM, not the tags alone: a changed
  // lab name or faculty specialisation moves the vector too.
  const textBefore = capabilityText({
    department: before.department,
    labName: before.labName,
    specialisationTags: before.specialisationTags ?? [],
    facultyName: before.facultyName,
    facultyDesignation: before.facultyDesignation,
  });
  const textAfter = capabilityText({
    department: before.department,
    labName: input.labName,
    specialisationTags: tags,
    facultyName: input.facultyName,
    facultyDesignation: input.facultyDesignation,
  });
  const embeddingStale = textBefore !== textAfter;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(capabilities)
        .set({
          labName: input.labName,
          facultyName: input.facultyName,
          facultyDesignation: input.facultyDesignation,
          specialisationTags: tags,
          declaredCapacity: input.declaredCapacity,
          capacityFrom: input.capacityFrom,
          capacityTo: input.capacityTo,
          active: input.active,
          // Cleared, not recomputed here: embedding is a network call and this
          // is a form submit. S5 re-embeds anything missing on its next run.
          ...(embeddingStale ? { embedding: null } : {}),
        })
        .where(eq(capabilities.id, input.id));

      await tx.insert(auditLog).values({
        actorId: user.id,
        action: "CAPABILITY_UPDATED",
        targetType: "capability",
        targetId: input.id,
        reason: null,
        meta: {
          department: before.department,
          capacityBefore: before.declaredCapacity,
          capacityAfter: input.declaredCapacity,
          tagsBefore: before.specialisationTags ?? [],
          tagsAfter: tags,
          embeddingCleared: embeddingStale,
        },
        createdAt: at,
      });
    });
  } catch (e) {
    console.error("[hei/capability] failed", e);
    return { ok: false, error: "That could not be saved. Nothing was changed." };
  }

  revalidatePath("/hei/capability");
  revalidatePath("/hei");

  return {
    ok: true,
    message: embeddingStale
      ? `Saved. ${before.department} will be matched on the new description from the next routing run.`
      : `Saved. ${before.department} now declares ${input.declaredCapacity} slot${input.declaredCapacity === 1 ? "" : "s"}.`,
  };
}
