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
  const rows = (await db.execute<{ n: number }>(
    sql`WITH picked AS (
          SELECT id FROM outbox WHERE processed_at IS NULL
          ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox SET processed_at = ${at}
        WHERE id IN (SELECT id FROM picked)
        RETURNING 1 AS n`,
  )) as unknown as Array<{ n: number }>;
  return rows.length;
}
