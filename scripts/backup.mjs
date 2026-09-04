/**
 * A logical backup of every Milan table, written as SQL INSERTs.
 *
 *   node scripts/backup.mjs backups/phase1.sql
 *
 * Why not pg_dump: Supabase is running PostgreSQL 17 and pg_dump refuses to
 * dump a server newer than itself. Rather than make the backup path depend on
 * every machine having a matching client installed, this reads through the
 * connection the app already uses.
 *
 * What it is and is not. This dumps DATA, not schema — restore by running the
 * migrations first (`pnpm drizzle-kit migrate`), then this file. Tables are
 * emitted in foreign-key order and the whole restore is one transaction, so a
 * half-restored database is not a state you can end up in.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

config({ path: ".env.local" });

const out = process.argv[2] ?? "backups/phase1.sql";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });

/** Parent tables first: a restore has to satisfy the same foreign keys. */
const TABLES = [
  "districts",
  "blocks",
  "user",
  "organization",
  "account",
  "session",
  "verification",
  "member",
  "invitation",
  "user_profiles",
  "organisations_meta",
  "capabilities",
  "challenges",
  "clusters",
  "challenge_media",
  "corroborations",
  "routes",
  "projects",
  "project_members",
  "milestones",
  "sla_deadlines",
  "ledger_entries",
  "credit_edges",
  "artifacts",
  "access_log",
  "notifications",
  "outbox",
  "ai_runs",
  "audit_log",
  "demo_state",
  "industry_interests",
];

/** Columns Postgres generates for itself and refuses on insert. */
const GENERATED = { challenges: ["search_tsv"] };

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) {
    // text[] and vector both round-trip through their literal syntax.
    return `'{${value.map((v) => `"${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}'`;
  }
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

const lines = [
  "-- Milan logical backup (data only).",
  `-- Generated ${new Date().toISOString()}`,
  "--",
  "-- Restore:  pnpm drizzle-kit migrate   then   psql \"$(node scripts/pg-url.mjs)\" -f this-file",
  "--",
  "-- ledger_entries refuses UPDATE and DELETE, so a restore into a database that",
  "-- already holds ledger rows will conflict on the primary key. Restore into an",
  "-- empty database, or run `pnpm seed --reset` first.",
  "",
  "BEGIN;",
  "SET session_replication_role = replica;  -- defer FK checks until COMMIT",
  "",
];

let totalRows = 0;
const summary = [];

for (const table of TABLES) {
  const rows = await sql`SELECT * FROM ${sql(table)}`;
  summary.push([table, rows.length]);
  totalRows += rows.length;
  if (rows.length === 0) continue;

  const skip = new Set(GENERATED[table] ?? []);
  const columns = Object.keys(rows[0]).filter((c) => !skip.has(c));

  lines.push(`-- ${table}: ${rows.length} row(s)`);
  for (const row of rows) {
    const values = columns.map((c) => literal(row[c])).join(", ");
    lines.push(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values});`,
    );
  }
  lines.push("");
}

lines.push("SET session_replication_role = DEFAULT;", "COMMIT;", "");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"), "utf8");

console.log(`Wrote ${out}`);
console.log("-".repeat(40));
for (const [table, n] of summary) {
  if (n > 0) console.log(`${table.padEnd(22)} ${String(n).padStart(6)}`);
}
console.log("-".repeat(40));
console.log(`${totalRows} rows across ${summary.filter(([, n]) => n > 0).length} tables`);

await sql.end();
