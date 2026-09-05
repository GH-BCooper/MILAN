/** Task 3.1 verification: the SQL clock and the TypeScript clock must agree. */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
const { clockNow } = await import("@/lib/clock");
const { advanceClock, resetClock, syncClockOffset } = await import("@/lib/clock/server");

async function sqlNow(): Promise<Date> {
  const rows = (await db.execute<{ n: string }>(sql`SELECT clock_now() AS n`)) as unknown as { n: string }[];
  return new Date(rows[0].n.replace(" ", "T").replace("+00", "Z"));
}

async function report(label: string) {
  await syncClockOffset(true);
  const a = await sqlNow();
  const b = clockNow();
  const drift = Math.abs(a.getTime() - b.getTime());
  console.log(`${label.padEnd(14)} sql=${a.toISOString()}  app=${b.toISOString()}  drift=${drift}ms  ${drift < 2000 ? "AGREE" : "DISAGREE"}`);
  return drift < 2000;
}

let ok = await report("offset 0");
await advanceClock(7, null);
ok = (await report("offset +7")) && ok;
await resetClock(null);
ok = (await report("reset")) && ok;
console.log(ok ? "\nPASS — clock_now() and clockNow() agree at every offset" : "\nFAIL");
process.exit(ok ? 0 : 1);
