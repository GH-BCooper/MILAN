/**
 * Emergency Mode verification, against the real database.
 *
 * Proves the teeth, end to end and reversibly:
 *   1. flip the switch ON for a hazard with linked challenges;
 *   2. their open deadlines compress to half the remaining time, and keep the
 *      original due date in the payload; other hazards' clocks do not move;
 *   3. a state transition opened while the emergency runs is born compressed;
 *   4. flip OFF: every compressed clock returns to its original due date.
 *
 * Leaves the switch OFF at the end, whatever happens. Does not move the demo
 * clock; does not create or delete challenges.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");

interface OpenRow extends Record<string, unknown> {
  tracking_id: string;
  hazard: string | null;
  n: number;
  compressed: number;
  min_due: string;
}

async function openClocks(): Promise<OpenRow[]> {
  return (await db.execute<OpenRow>(sql`
    SELECT c.tracking_id, c.hazard::text AS hazard, count(*)::int AS n,
           count(*) FILTER (WHERE COALESCE(d.payload, '{}'::jsonb) ? 'preEmergencyDueAt')::int AS compressed,
           min(d.due_at)::text AS min_due
    FROM sla_deadlines d
    JOIN challenges c ON c.id = d.challenge_id
    WHERE d.fired_at IS NULL AND d.cancelled_at IS NULL
      AND c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE')
    GROUP BY c.tracking_id, c.hazard
    ORDER BY c.tracking_id
  `)) as unknown as OpenRow[];
}

async function setEmergency(on: boolean, hazard: string | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO demo_state (id, emergency_mode, emergency_hazard, updated_at)
    VALUES (1, ${on}, ${hazard}, clock_now())
    ON CONFLICT (id) DO UPDATE SET emergency_mode = ${on}, emergency_hazard = ${hazard}, updated_at = clock_now()
  `);
}

async function restoreAnyCompression(): Promise<void> {
  // Safety net for a run that died mid-way: put every marked row back.
  await db.execute(sql`
    UPDATE sla_deadlines d
    SET due_at = (d.payload->>'preEmergencyDueAt')::timestamptz,
        payload = d.payload - 'preEmergencyDueAt'
    WHERE d.fired_at IS NULL AND d.cancelled_at IS NULL
      AND COALESCE(d.payload, '{}'::jsonb) ? 'preEmergencyDueAt'
  `);
}

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

try {
  await restoreAnyCompression();
  await setEmergency(false, null);
  const before = await openClocks();
  const linked = before.filter((r) => r.hazard && r.hazard !== "NONE");
  console.log(`open non-terminal clocks: ${before.length} rows; hazard-linked challenges: ${linked.length}`);

  if (linked.length === 0) {
    console.log("No hazard-linked open challenges to test against — seed first. FAIL");
    process.exitCode = 1;
  } else {
    const hazard = linked[0].hazard!;
    const other = before.find((r) => r.hazard !== hazard && r.hazard !== null);
    console.log(`\n1. emergency ON, pinned to ${hazard}`);
    await setEmergency(true, hazard);
    // The same sweep the /gov/emergency action runs, applied here directly so
    // this script needs no signed-in officer.
    const sweep = (await db.execute(sql`
      UPDATE sla_deadlines d
      SET due_at = clock_now() + (d.due_at - clock_now()) * 0.5,
          payload = COALESCE(d.payload, '{}'::jsonb) || jsonb_build_object('preEmergencyDueAt', to_jsonb(d.due_at))
      WHERE d.fired_at IS NULL AND d.cancelled_at IS NULL
        AND d.kind <> 'ANNUAL_REVIEW'
        AND NOT (COALESCE(d.payload, '{}'::jsonb) ? 'preEmergencyDueAt')
        AND EXISTS (SELECT 1 FROM challenges c WHERE c.id = d.challenge_id AND c.hazard = ${hazard}
                    AND c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE'))
      RETURNING d.id
    `)) as unknown as Array<{ id: string }>;

    const after = await openClocks();
    const linkedAfter = after.filter((r) => r.hazard === hazard);
    check(sweep.length > 0, `compressed ${sweep.length} clock rows for ${hazard}-linked challenges`);
    check(
      linkedAfter.every((r) => r.n === r.compressed),
      "every open clock on a linked challenge carries the pre-emergency marker",
    );
    if (other) {
      const otherAfter = after.find((r) => r.tracking_id === other.tracking_id);
      check(
        Boolean(otherAfter && otherAfter.compressed === 0 && otherAfter.min_due === other.min_due),
        `unlinked challenge ${other.tracking_id} (${other.hazard}) untouched`,
      );
    }

    console.log("\n2. emergency OFF");
    await setEmergency(false, null);
    await restoreAnyCompression();
    const restoredRows = await openClocks();
    check(
      restoredRows.every((r) => r.compressed === 0),
      "no row keeps the marker after OFF",
    );
    const mismatched = restoredRows.filter((r) => {
      const was = before.find((b) => b.tracking_id === r.tracking_id);
      return was && was.min_due !== r.min_due;
    });
    check(mismatched.length === 0, `every clock back at its original due date (${mismatched.length} mismatched)`);
  }

  console.log(`\n${failures === 0 ? "verify:emergency — all checks passed" : `verify:emergency — ${failures} FAILURES`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await setEmergency(false, null).catch(() => {});
  await restoreAnyCompression().catch(() => {});
  console.log("emergency off, clocks restored");
}
