import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

/**
 * Migrations use DIRECT_URL (the Supabase session pooler, port 5432).
 * The app runtime uses DATABASE_URL (the transaction pooler, port 6543).
 * DDL over the transaction pooler fails on prepared statements, so this
 * distinction is not cosmetic.
 */
const url = process.env.DIRECT_URL;
if (!url) throw new Error("DIRECT_URL is not set — migrations need the session pooler string.");

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
