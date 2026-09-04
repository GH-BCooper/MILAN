import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Runtime connections use DATABASE_URL — the Supabase transaction pooler on
 * 6543. Serverless functions open a connection per invocation, so `max: 1`
 * and `prepare: false` are not tuning, they are correctness: the transaction
 * pooler cannot hold a prepared statement across a checkout.
 *
 * Migrations use DIRECT_URL (session pooler, 5432) via drizzle.config.ts.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const globalForDb = globalThis as unknown as { milanSql?: ReturnType<typeof postgres> };

/**
 * Why this is not `max: 1`.
 *
 * The usual serverless advice is one connection per instance. That is wrong for
 * us: drizzle's postgres-js driver issues every statement through postgres.js
 * `unsafe()`, which is not pipelined. With a single connection, two queries
 * started concurrently — `Promise.all([db.select(...), db.select(...)])`, which
 * is the normal shape of a server component — deadlock, and because the client
 * is shared the whole instance then hangs on every later request.
 *
 * That was not theoretical: `/stats` and `/submit` both wedged the server on
 * first load until this was raised. A small pool against the Supabase
 * transaction pooler is exactly what the transaction pooler is for.
 */
const poolSize = Number(process.env.DATABASE_POOL_MAX ?? 8);

export const sql =
  globalForDb.milanSql ??
  postgres(url, {
    max: Number.isFinite(poolSize) && poolSize > 0 ? poolSize : 8,
    // The transaction pooler cannot hold a prepared statement across a checkout.
    prepare: false,
    // Supabase poolers close idle connections; do not fight them.
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.milanSql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });

export type Db = typeof db;
/** The type of the argument handed to a `db.transaction(async (tx) => ...)` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export * from "./schema";
