import "server-only";

import type { SQL } from "drizzle-orm";

import { db } from "./index";

/**
 * Raw SQL, serialised.
 *
 * Background: drizzle's postgres-js driver issues every statement through
 * postgres.js `unsafe()`, which is not pipelined. Two statements started
 * concurrently on the *same* connection deadlock, and a shared client then hangs
 * every later request in the instance. `/stats` and `/submit` both wedged the
 * server this way before `lib/db/index.ts` was given a real pool.
 *
 * The pool is the fix. This queue is the seat belt: raw analytics queries are
 * the ones most likely to be written as a fan-out `Promise.all`, they are the
 * least latency-sensitive code we have, and a page that is 50ms slower is a much
 * better outcome than an instance that stops answering. Use it for `db.execute`
 * from a page or a handler.
 *
 * `tx.execute()` inside a transaction needs no queue — a transaction is serial
 * by definition. Query-builder calls (`db.select()`, `db.insert()`, …) get a
 * connection each from the pool and may be run concurrently as normal.
 */
let tail: Promise<unknown> = Promise.resolve();

export function execRaw<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  const run = tail.then(
    () => db.execute<T>(query) as Promise<T[]>,
    // Keep the chain alive when a previous query rejected, or one failure would
    // block every raw query for the life of the instance.
    () => db.execute<T>(query) as Promise<T[]>,
  );
  tail = run.catch(() => undefined);
  return run;
}
