"use server";

/**
 * Emergency mode: the Disaster Management teeth, not just a filter.
 *
 * What the switch does, all of it reversible:
 *
 *  1. statewide banner, map filter pinned to the hazard, display re-sort with a
 *     visible surge multiplier (lib/emergency/surge.ts) — as before;
 *  2. **compresses the open SLA clocks** of every non-terminal challenge linked
 *     to the pinned hazard to EMERGENCY_TIME_SCALE, keeping the original due
 *     date in the row's payload so turning the switch off restores it exactly;
 *  3. every clock *newly opened* while the emergency runs (state transitions,
 *     reaper follow-ons) is born compressed — see `deadlinesFor(clockScale)` and
 *     the reaper.
 *
 * What it still never does: rewrite a stored priority score, or touch a
 * challenge linked to a different hazard. A flood week must not quietly rewrite
 * the history of every drought challenge in the state, and nothing here does.
 */
import { revalidatePath } from "next/cache";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { auditLog, demoState, hazardEnum } from "@/lib/db/schema";
import { EMERGENCY_TIME_SCALE } from "@/lib/sla/deadlines";

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

  const { compressed, restored } = await db.transaction<{ compressed: number; restored: number }>(async (tx) => {
    await tx.insert(demoState).values({ id: 1, emergencyMode: on, emergencyHazard: hazard, updatedAt: at }).onConflictDoUpdate({
      target: demoState.id,
      set: { emergencyMode: on, emergencyHazard: hazard, updatedAt: at },
    });

    let compressed = 0;
    let restored = 0;
    if (on) {
      // Compress the hazard's open clocks, keeping the original due date in the
      // payload. The marker doubles as the idempotence guard: re-pinning (or
      // pinning a second hazard) never double-compresses a row that is already
      // running at emergency speed. Rows already overdue stay overdue — they
      // will fire on the next reaper, which in an emergency is the point.
      const rows = (await tx.execute(sql`
        UPDATE sla_deadlines d
        SET due_at = ${at}::timestamptz + (d.due_at - ${at}::timestamptz) * ${EMERGENCY_TIME_SCALE}::float8,
            payload = COALESCE(d.payload, '{}'::jsonb) || jsonb_build_object('preEmergencyDueAt', to_jsonb(d.due_at))
        WHERE d.fired_at IS NULL AND d.cancelled_at IS NULL
          AND d.kind <> 'ANNUAL_REVIEW'
          AND NOT (COALESCE(d.payload, '{}'::jsonb) ? 'preEmergencyDueAt')
          AND EXISTS (
            SELECT 1 FROM challenges c
            WHERE c.id = d.challenge_id
              AND c.hazard = ${hazard}
              AND c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE')
          )
        RETURNING d.id
      `)) as unknown as Array<{ id: string }>;
      compressed = rows.length;
    } else {
      // Restore every compressed clock to the due date it had before the
      // emergency, hazard-agnostic: only compressed rows carry the marker.
      const rows = (await tx.execute(sql`
        UPDATE sla_deadlines d
        SET due_at = (d.payload->>'preEmergencyDueAt')::timestamptz,
            payload = d.payload - 'preEmergencyDueAt'
        WHERE d.fired_at IS NULL AND d.cancelled_at IS NULL
          AND COALESCE(d.payload, '{}'::jsonb) ? 'preEmergencyDueAt'
        RETURNING d.id
      `)) as unknown as Array<{ id: string }>;
      restored = rows.length;
    }

    await tx.insert(auditLog).values({
      actorId: user.id,
      action: on ? "gov.emergency.on" : "gov.emergency.off",
      targetType: "demo_state",
      targetId: "1",
      reason: on ? `Emergency pinned to ${hazard}` : "Emergency cleared",
      meta: {
        hazard,
        clocksCompressed: compressed,
        clocksRestored: restored,
        timeScale: on ? EMERGENCY_TIME_SCALE : null,
        note:
          "Compressed the open clocks of challenges linked to the pinned hazard; original due dates kept in payload. No stored priority score was changed.",
      },
      createdAt: at,
    });

    return { compressed, restored };
  });

  revalidatePath("/", "layout");
  revalidatePath("/gov/sla");
  return {
    message: on
      ? `Emergency on, pinned to ${hazard}. Banner statewide, lists surged, and ${compressed} open SLA clock${
          compressed === 1 ? "" : "s"
        } for ${(hazard ?? "").replace(/_/g, " ").toLowerCase()}-linked challenges now run at ${EMERGENCY_TIME_SCALE}× speed. No stored score changed.`
      : `Emergency off. ${restored} compressed clock${restored === 1 ? "" : "s"} restored to their original due dates, because the original was kept. Nothing else needs undoing.`,
  };
}
