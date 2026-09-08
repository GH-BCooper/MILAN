/**
 * Backfill the JDIP 4.1 district columns from seed-data/districts-enrichment.csv.
 *
 * These columns (division, population, internet_penetration,
 * tribal_population_pct) arrived in migration 0013 after the last full seed, so
 * a database seeded before that migration has them all null and
 * /gov/district/[code] reads "not recorded" for every figure. The full seeder
 * does this too; this is the part of it that is safe to re-run on a live
 * database, because it only UPDATEs reference rows.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import Papa from "papaparse";

const { db } = await import("@/lib/db");
const { districts } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

const csv = readFileSync("seed-data/districts-enrichment.csv", "utf8");
const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;

let n = 0;
for (const r of rows) {
  const code = (r.district_code ?? "").trim();
  if (!code) continue;

  const population = r.population ? Math.trunc(Number(r.population)) : null;
  const res = await db
    .update(districts)
    .set({
      division: r.division?.trim() || null,
      population: population !== null && Number.isFinite(population) ? population : null,
      internetPenetration: r.internet_penetration?.trim() || null,
      tribalPopulationPct: r.tribal_population_pct?.trim() || null,
    })
    .where(eq(districts.code, code))
    .returning({ code: districts.code });
  if (res.length) n += 1;
  else console.warn(`districts-enrichment.csv: ${code} is not a seeded district — skipped`);
}
console.log(`${n}/${rows.length} districts enriched.`);
process.exit(0);
