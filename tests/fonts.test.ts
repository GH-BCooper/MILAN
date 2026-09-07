/**
 * Font wiring, filesystem-only — no database, no browser.
 *
 * Guards the two failure modes that made Devanagari render as tofu while the
 * app believed it was multilingual:
 *
 *  1. Defined-but-unreferenced: the root layout registers the self-hosted
 *     faces as the CSS variables `--font-milan-sans` / `--font-milan-devanagari`
 *     (see app/layout.tsx). For months, `--font-milan-sans` was referenced in
 *     globals.css without being defined; then `--font-milan-devanagari` was
 *     defined without being referenced. Either half silently degrades half the
 *     app's text to whatever the OS ships — boxes on font-poor systems.
 *
 *  2. Empty-or-wrong font file: a woff2 on disk proves nothing unless it is a
 *     real font of non-trivial size. The coverage itself is verified once at
 *     vendor time (the devanagari subset covers U+0900–U+097F; the latin
 *     subset covers basic latin) and recorded in app/fonts/.
 *
 * If the stack changes on purpose, update this test with it.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

describe("self-hosted font wiring (tofu regression)", () => {
  const globalsCss = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const layoutTsx = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");

  it("the layout still defines both font variables", () => {
    expect(layoutTsx).toContain('"--font-milan-sans"');
    expect(layoutTsx).toContain('"--font-milan-devanagari"');
  });

  it("globals.css references both variables in the body font stack", () => {
    const bodyMatch = globalsCss.match(/body[\s]*\{[^}]*font-family:[^;]+;/);
    expect(bodyMatch, "globals.css must declare a body font-family stack").toBeTruthy();
    const stack = bodyMatch![0];
    expect(stack).toContain("var(--font-milan-sans)");
    expect(stack).toContain("var(--font-milan-devanagari)");
  });

  it("the Tailwind --font-sans token also carries the devanagari face", () => {
    const themeMatch = globalsCss.match(/--font-sans:[^;]+;/);
    expect(themeMatch).toBeTruthy();
    expect(themeMatch![0]).toContain("var(--font-milan-devanagari)");
  });

  it("the shipped faces precede the quoted OS font names", () => {
    const sansIdx = globalsCss.indexOf("var(--font-milan-devanagari)");
    const systemIdx = globalsCss.indexOf('"Noto Sans Devanagari"');
    expect(sansIdx).toBeGreaterThan(-1);
    if (systemIdx !== -1) {
      expect(sansIdx).toBeLessThan(systemIdx);
    }
  });

  it("both woff2 files exist and are real fonts (non-trivial size)", () => {
    for (const file of [
      "app/fonts/noto-sans-latin-wght-normal.woff2",
      "app/fonts/noto-sans-devanagari-devanagari-wght-normal.woff2",
    ]) {
      const size = statSync(join(ROOT, file)).size;
      expect(size, `${file} should be a real font, not a stub`).toBeGreaterThan(20_000);
    }
  });
});
