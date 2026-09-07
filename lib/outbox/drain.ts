/**
 * Draining the transactional outbox.
 *
 * This is the reason Milan needs no Kafka, and the slide says so: at state scale
 * a Postgres table covers every event we emit. A state change writes its event
 * in the same transaction as the change itself, so the two can never disagree;
 * this worker marks them processed afterwards.
 *
 * The mock channels (`notify.sms.mock`, `notify.whatsapp.mock`) are deliberately
 * left unprocessed-looking to nobody: they are marked processed here too, and
 * /demo reads the rows themselves, not their processed flag.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";

export async function drainOutbox(limit = 500): Promise<number> {
  const at = clockNow();
  // ISO string, not a Date: drizzle passes sql`` params through to postgres-js
  // raw, and a JS Date in that path fails serialisation (ERR_INVALID_ARG_TYPE).
  // Found by actually running the nightly cron against a database — the same
  // fix applies to every raw date param in the codebase, which is why they all
  // pass ISO strings or use clock_now() in SQL.
  const rows = (await db.execute<{ n: number }>(
    sql`WITH picked AS (
          SELECT id FROM outbox WHERE processed_at IS NULL
          ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox SET processed_at = ${at.toISOString()}
        WHERE id IN (SELECT id FROM picked)
        RETURNING 1 AS n`,
  )) as unknown as Array<{ n: number }>;
  return rows.length;
}
