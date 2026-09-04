import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Invariant: the demo fast-forward moves one offset inside `lib/clock`. If any
 * other module reads the wall clock directly, that module silently ignores the
 * offset and the Phase 3 SLA demo shows the wrong thing on stage.
 *
 * We ban two forms only:
 *   Date.now()      — a wall-clock read
 *   new Date()      — a wall-clock read (no arguments)
 * `new Date(isoString)` is parsing, not a clock read, and stays legal.
 */
const ROOTS = ["app", "lib"];
const ALLOWED = [join("lib", "clock")];
const BANNED = [
  { pattern: /\bDate\.now\s*\(/, name: "Date.now()" },
  { pattern: /\bnew\s+Date\s*\(\s*\)/, name: "new Date()" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no raw wall-clock reads outside lib/clock", () => {
  it("finds none in app/ or lib/", () => {
    const offences: string[] = [];

    for (const root of ROOTS) {
      let files: string[];
      try {
        files = walk(root);
      } catch {
        continue; // the directory may not exist yet in an early phase
      }

      for (const file of files) {
        const rel = relative(process.cwd(), file);
        if (ALLOWED.some((a) => rel.startsWith(a + sep) || rel === a)) continue;

        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          // An explicit escape hatch, used once in lib/clock itself.
          if (line.includes("no-restricted-globals")) return;
          for (const { pattern, name } of BANNED) {
            if (pattern.test(line)) {
              offences.push(`${rel}:${i + 1} uses ${name} — import clockNow() from lib/clock`);
            }
          }
        });
      }
    }

    expect(offences, offences.join("\n")).toEqual([]);
  });
});
