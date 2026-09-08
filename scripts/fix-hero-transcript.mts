/**
 * Restore the hero voice-note record to the language it was actually spoken in.
 *
 * seed-data/voice-note.transcript.txt is authored in Hindi and names the
 * challenge it belongs to ("Crack spreading along the South Koel embankment
 * near Basia"), but that row shipped with the *English translation* as
 * `body_original` and `body_lang = 'en'`. The consequence was that the one
 * record with a real recording attached had nothing to put on the left-hand
 * side of the bilingual view — CLAUDE.md invariant 6, and the single strongest
 * thing the intake screen has to show.
 *
 * challenges.csv is now correct, so a fresh `pnpm seed --reset` needs none of
 * this. But the seeder identifies an existing row by (title, body_original),
 * so a database seeded before the fix would not be updated — it would gain a
 * duplicate. This repairs that row in place. It is idempotent.
 *
 * The correction is written to the ledger as an OVERRIDE rather than applied
 * silently: invariant 2 says the chain is the record of what happened to a
 * challenge, and "the operator rewrote the citizen's own words" is exactly the
 * kind of thing it exists to make impossible to do quietly. The superseded
 * English text is carried in the entry payload, so nothing is destroyed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";

const { db } = await import("@/lib/db");
const { challenges } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");
const { appendEntry } = await import("@/lib/ledger/append");
const { clockNow } = await import("@/lib/clock");
const { syncClockOffset } = await import("@/lib/clock/server");

const TITLE = "Crack spreading along the South Koel embankment near Basia";

/** Pull the two paragraphs out of the human-authored transcript rather than
 *  restating them here — one source of truth for the words Sunita spoke. */
function section(transcript: string, heading: string): string {
  const m = new RegExp(`-+ ${heading} -+\\n([\\s\\S]*?)(?=\\n-+ |$)`).exec(transcript);
  if (!m) throw new Error(`voice-note.transcript.txt has no "${heading}" section`);
  return m[1].split(/\s+/).filter(Boolean).join(" ");
}

const transcript = readFileSync("seed-data/voice-note.transcript.txt", "utf8");
const hindi = section(transcript, "HINDI \\(read this exactly\\)");
const english = section(transcript, "ENGLISH TRANSLATION");

await syncClockOffset(true);
const now = clockNow();

const [row] = await db
  .select({
    id: challenges.id,
    trackingId: challenges.trackingId,
    bodyOriginal: challenges.bodyOriginal,
    bodyLang: challenges.bodyLang,
  })
  .from(challenges)
  .where(eq(challenges.title, TITLE))
  .limit(1);

if (!row) {
  console.error(`No challenge titled "${TITLE}". Seed first.`);
  process.exit(1);
}

if (row.bodyLang === "hi" && row.bodyOriginal === hindi) {
  console.log(`${row.trackingId} already carries the spoken Hindi. Nothing to do.`);
  process.exit(0);
}

const superseded = row.bodyOriginal;

await db.transaction(async (tx) => {
  await tx
    .update(challenges)
    .set({ bodyOriginal: hindi, bodyLang: "hi", bodyEn: english, updatedAt: now })
    .where(eq(challenges.id, row.id));

  await appendEntry(tx, {
    challengeId: row.id,
    kind: "OVERRIDE",
    authorId: null,
    at: now,
    payload: {
      trackingId: row.trackingId,
      reason:
        "The seeded row carried the English translation as the citizen's own words. " +
        "Restored the Hindi she actually spoke on the attached recording, and moved " +
        "the English to the working copy where it belongs (invariant 6).",
      source: "seed-data/voice-note.transcript.txt",
      supersededBodyLang: row.bodyLang,
      supersededBodyOriginal: superseded,
      at: now.toISOString(),
    },
  });
});

console.log(`${row.trackingId}: body_lang en → hi, original restored to the spoken Hindi, English moved to body_en.`);
console.log(`Correction recorded in the ledger as an OVERRIDE entry.`);
process.exit(0);
