/**
 * `pnpm s3:matrix` — print the cosine similarity matrix for a set of challenges.
 *
 * PHASE_2_BUILD.md Task 2.3 asks to see this for the three planted
 * near-duplicates, and to confirm two genuinely different water challenges do
 * not merge. Defaults to exactly that set.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("../lib/db");
const { challenges } = await import("../lib/db/schema");
const { S3_THRESHOLDS, bandFor } = await import("../lib/ai/stages/s3");
const { cosine } = await import("../lib/ai/providers/embed");
const { inArray, asc } = await import("drizzle-orm");

const DEFAULT = [
  // The three planted near-duplicates: one embankment crack at Basia, reported
  // three times, in two languages.
  "JH-2026-GUM-0001",
  "JH-2026-GUM-0002",
  "JH-2026-GUM-0003",
  // Two genuinely different water problems, as the negative control.
  "JH-2026-GAR-0001",
  "JH-2026-SKH-0001",
];

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = args.length > 0 ? args.map((a) => a.toUpperCase()) : DEFAULT;

const rows = await db
  .select({
    trackingId: challenges.trackingId,
    title: challenges.title,
    status: challenges.status,
    blockCode: challenges.blockCode,
    corroborationCount: challenges.corroborationCount,
    parentId: challenges.parentId,
    embedding: challenges.embedding,
  })
  .from(challenges)
  .where(inArray(challenges.trackingId, ids))
  .orderBy(asc(challenges.trackingId));

const present = rows.filter((r) => r.embedding && r.embedding.length > 0);
for (const id of ids) {
  if (!present.some((r) => r.trackingId === id)) console.error(`  ! ${id} has no embedding`);
}

const width = Math.max(...present.map((r) => r.trackingId.length));
console.log(
  `\nCosine similarity. auto-merge >= ${S3_THRESHOLDS.autoMerge}, ` +
    `adjudicate >= ${S3_THRESHOLDS.adjudicate}, otherwise distinct.\n`,
);
console.log(
  "".padEnd(width) + "  " + present.map((r) => r.trackingId.slice(-8).padStart(8)).join("  "),
);
for (const a of present) {
  const cells = present.map((b) => {
    if (a.trackingId === b.trackingId) return "       -";
    return cosine(a.embedding as number[], b.embedding as number[]).toFixed(4).padStart(8);
  });
  console.log(a.trackingId.padEnd(width) + "  " + cells.join("  "));
}

console.log("\nBands:");
for (let i = 0; i < present.length; i++) {
  for (let j = i + 1; j < present.length; j++) {
    const s = cosine(present[i].embedding as number[], present[j].embedding as number[]);
    console.log(
      `  ${present[i].trackingId} vs ${present[j].trackingId}  ${s.toFixed(4)}  ${bandFor(s)}`,
    );
  }
}

console.log("\nOutcome in the database:");
for (const r of present) {
  console.log(
    `  ${r.trackingId}  ${r.status.padEnd(18)} block=${r.blockCode ?? "-"}  ` +
      `reports=${r.corroborationCount}  parent=${r.parentId ? "yes" : "no"}  ${r.title.slice(0, 46)}`,
  );
}
process.exit(0);
