"use server";

/**
 * Emergency mode: a display filter, and nothing else.
 *
 * PHASE_3_BUILD.md Task 3.6 is explicit that this changes display and filtering,
 * not the stored score, and PROGRESS.md records full Emergency Mode as a
 * declared stub. So this action writes two columns on `demo_state` and touches
 * no challenge, no priority score and no route. If it did anything else, a
 * flood week would silently rewrite the history of every drought challenge in
 * the state — which is precisely the failure a "temporary" priority override
 * causes in real systems.
 */
import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, demoState, hazardEnum } from "@/lib/db/schema";

const Input = z.object({
  on: z.enum(["on", "off"]),
  hazard: z.enum(hazardEnum.enumValues).optional(),
});

export async function setEmergency(_prev: { message: string } | null, form: FormData): Promise<{ message: string }> {
  const user = await requireRole("GOVERNMENT", "ADMIN");
  const parsed = Input.safeParse({ on: form.get("on"), hazard: form.get("hazard") || undefined });
  if (!parsed.success) return { message: "That could not be read." };

  const at = clockNow();
  const on = parsed.data.on === "on";
  const hazard = on ? (parsed.data.hazard ?? "FLOOD") : null;

  await db.insert(demoState).values({ id: 1, emergencyMode: on, emergencyHazard: hazard, updatedAt: at }).onConflictDoUpdate({
    target: demoState.id,
    set: { emergencyMode: on, emergencyHazard: hazard, updatedAt: at },
  });

  await db.insert(auditLog).values({
    actorId: user.id,
    action: on ? "gov.emergency.on" : "gov.emergency.off",
    targetType: "demo_state",
    targetId: "1",
    reason: on ? `Emergency filter pinned to ${hazard}` : "Emergency filter cleared",
    meta: { hazard, note: "Display and filtering only. No stored priority score was changed." },
    createdAt: at,
  });

  revalidatePath("/", "layout");
  return {
    message: on
      ? `Emergency filter on, pinned to ${hazard}. A banner is now on every page statewide. No stored score changed.`
      : "Emergency filter off. Nothing needs undoing, because nothing was overwritten.",
  };
}
