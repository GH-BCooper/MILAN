/**
 * Tracking IDs. `JH-2026-GUM-0042` = state, year, district, zero-padded sequence.
 *
 * Human-readable, sayable over a phone, and it tells you the district at a
 * glance. It is generated at submit time and returned in seconds, and it is the
 * citizen's whole relationship with the platform — so it is never regenerated,
 * never reused, and never changed once issued.
 */
import { sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import type { Tx } from "./index";

const STATE = "JH";
/** Districts we have no code for (a pin outside Jharkhand, say) still get an ID. */
const UNKNOWN_DISTRICT = "XXX";

export function trackingIdPrefix(districtCode: string | null | undefined, year?: number): string {
  const d = (districtCode ?? UNKNOWN_DISTRICT).toUpperCase().slice(0, 3).padEnd(3, "X");
  return `${STATE}-${year ?? clockNow().getUTCFullYear()}-${d}`;
}

/**
 * Allocate the next tracking ID for a district.
 *
 * Must run inside the same transaction as the challenge insert. The sequence is
 * derived from the rows themselves rather than from a Postgres sequence per
 * district, because districts are seed data and a sequence per district would
 * have to be created by a migration every time a district is added. Two
 * concurrent submissions in the same district are serialised by the unique index
 * on `tracking_id`: the loser retries.
 */
export async function nextTrackingId(tx: Tx, districtCode: string | null | undefined): Promise<string> {
  const prefix = trackingIdPrefix(districtCode);

  const rows = await tx.execute<{ n: number }>(sql`
    SELECT coalesce(max(substring(tracking_id from '[0-9]+$')::int), 0) + 1 AS n
    FROM challenges
    WHERE tracking_id LIKE ${prefix + "-%"}
  `);

  const next = Number(rows[0]?.n ?? 1);
  return `${prefix}-${String(next).padStart(4, "0")}`;
}
