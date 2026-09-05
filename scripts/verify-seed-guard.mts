/**
 * Task 3.9 step 7: fail the build if placeholder data reaches the seed or the UI.
 *
 * "Do not invent seed data. Real Jharkhand districts, real HEIs, real firms."
 * A judge who finds "Test University" on a slide stops believing the other
 * twenty-four rows, so this is a required CI check rather than a habit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Two patterns, because the two places have different risks.
 *
 * In `seed-data/` anything invented is a problem, including the word
 * "placeholder" itself. In the UI the risk is narrower: a fabricated institution
 * or a lorem-ipsum paragraph rendered to a judge.
 *
 * `Foo` and `Bar` from the build file's suggested pattern are deliberately NOT
 * here: <Bar/> is a Recharts component and Barharwa, Barhi, Bardiha, Barwadih
 * and Barhait are real Jharkhand blocks. "District A" only matches as a whole
 * field, not inside "the district a challenge is scoped to". A check that cries
 * wolf gets suppressed, which is worse than no check at all.
 */
const BANNED_DATA = /(\b(Test University|Lorem|Ipsum|Sample College|Acme|placeholder|TODO_DATA)\b)|((^|[",|])\s*District [A-Z]\s*($|[",|]))/i;
const BANNED_UI = /(\b(Test University|Lorem|Ipsum|Sample College|Acme Corp|TODO_DATA)\b)|((^|[",|>])\s*District [A-Z]\s*($|[",|<]))/i;

/** Legitimate in prose or in an attribute, never in data. */
const ALLOWED_CONTEXT = [
  /placeholder=/i,
  /placeholder:/i,
  /placeholder text/i,
  /"placeholder"/i,
  /HUMAN:/,
];

const DATA_ROOTS = ["seed-data"];
const ROOTS = ["seed-data", "app", "components", "lib", "packages"];
const offences: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
      // README.md in seed-data documents the dataset's own history, including
      // the word "placeholder" describing what was replaced. Prose about the
      // data is not the data.
    } else if (/\.(ts|tsx|csv|json)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

for (const root of ROOTS) {
  let files: string[];
  try {
    files = walk(root);
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const isData = DATA_ROOTS.some((d) => rel.startsWith(d));
        if (!(isData ? BANNED_DATA : BANNED_UI).test(line)) return;
        if (ALLOWED_CONTEXT.some((re) => re.test(line))) return;
        offences.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
  }
}

if (offences.length > 0) {
  console.error(`FAIL  ${offences.length} placeholder string(s) found:\n`);
  for (const o of offences) console.error(`  ${o}`);
  console.error(`\nMilan runs on real Jharkhand data. Replace these, do not suppress the check.`);
  process.exit(1);
}

console.log(`PASS  no placeholder strings in ${ROOTS.join(", ")}`);
process.exit(0);
