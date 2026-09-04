/**
 * `packages/scoring` is the one place in Milan where a bug would be invisible:
 * a wrong weight or a wrong normaliser produces a plausible number on every
 * screen and nothing fails. These tests are what stands between that and us.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SCORING_VERSION,
  TERM_ORDER,
  WEIGHTS,
  computePriority,
  normalise,
  topContributors,
  weightsSum,
  type ScoringInput,
} from "@/packages/scoring";

const MAXIMAL: ScoringInput = {
  severity: 1,
  hazard: "FLOOD",
  hazardStrength: 1,
  peopleAffected: 100_000,
  blockVulnerability: 1,
  corroborationCount: 50,
  recurrence: "constant",
  officialEndorsed: true,
};

const MINIMAL: ScoringInput = {
  severity: 0.01,
  hazard: "NONE",
  hazardStrength: 0,
  peopleAffected: 1,
  blockVulnerability: 0,
  corroborationCount: 1,
  recurrence: "one-off",
  officialEndorsed: false,
};

describe("weights", () => {
  it("sum to exactly 1.00", () => {
    // Floating point: 0.22+0.20+0.15+0.15+0.12+0.10+0.06 does not land on 1
    // exactly in binary, so assert to a tolerance far tighter than any weight.
    expect(weightsSum()).toBeCloseTo(1, 10);
  });

  it("cover every term exactly once", () => {
    expect(new Set(TERM_ORDER).size).toBe(TERM_ORDER.length);
    expect(TERM_ORDER.slice().sort()).toEqual(Object.keys(WEIGHTS).sort());
  });

  it("give hazard linkage the second-highest weight", () => {
    // This is a Disaster Management PS. If hazard ever stops being second, that
    // was a decision someone should have argued for out loud.
    const ranked = TERM_ORDER.slice().sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
    expect(ranked[0]).toBe("severity");
    expect(ranked[1]).toBe("hazard");
  });
});

describe("computePriority", () => {
  it("scores a maximal input at 100", () => {
    expect(computePriority(MAXIMAL).total).toBeCloseTo(100, 6);
  });

  it("scores a minimal input above zero", () => {
    // A real report by a real person is never worth nothing.
    const result = computePriority(MINIMAL);
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThan(15);
  });

  it("is deterministic: the same input twice gives an identical result", () => {
    const a = computePriority(MAXIMAL);
    const b = computePriority(MAXIMAL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("records the version it was computed under", () => {
    expect(computePriority(MINIMAL).version).toBe(SCORING_VERSION);
  });

  it("returns every term with a contribution that reconstructs the total", () => {
    const result = computePriority({
      severity: 0.62,
      hazard: "DROUGHT",
      hazardStrength: 0.71,
      peopleAffected: 550,
      blockVulnerability: 0.48,
      corroborationCount: 7,
      recurrence: "seasonal",
      officialEndorsed: false,
    });

    expect(result.terms).toHaveLength(TERM_ORDER.length);
    const sum = result.terms.reduce((s, t) => s + t.contribution, 0) * 100;
    expect(sum).toBeCloseTo(result.total, 3);

    // Invariant 10: every number on screen is clickable through to its
    // derivation, which is only possible if every term carries its own.
    for (const term of result.terms) {
      expect(term.contribution).toBeCloseTo(term.weight * term.normalised, 6);
      expect(term.rawValue.length).toBeGreaterThan(0);
      expect(term.source.length).toBeGreaterThan(0);
    }
  });

  it("scores hazard at exactly zero when the hazard is NONE", () => {
    const result = computePriority({ ...MAXIMAL, hazard: "NONE", hazardStrength: 0.9 });
    const hazardTerm = result.terms.find((t) => t.key === "hazard");
    expect(hazardTerm?.normalised).toBe(0);
    expect(hazardTerm?.contribution).toBe(0);
  });

  it("keeps a severe village problem above a mild town problem", () => {
    // The equity property, asserted rather than asserted-in-a-comment.
    // 50 people, severe, hazard-linked, recurring, in a vulnerable block.
    const village = computePriority({
      severity: 0.85,
      hazard: "FLOOD",
      hazardStrength: 0.9,
      peopleAffected: 50,
      blockVulnerability: 0.7,
      corroborationCount: 4,
      recurrence: "yearly",
      officialEndorsed: false,
    });
    // 5,000 people, mild, no hazard linkage, one-off.
    const town = computePriority({
      severity: 0.3,
      hazard: "NONE",
      hazardStrength: 0,
      peopleAffected: 5_000,
      blockVulnerability: 0.4,
      corroborationCount: 20,
      recurrence: "one-off",
      officialEndorsed: false,
    });
    expect(village.total).toBeGreaterThan(town.total);
  });

  it("gives brigading a bounded payoff", () => {
    const base: ScoringInput = { ...MINIMAL, corroborationCount: 5 };
    const brigaded: ScoringInput = { ...MINIMAL, corroborationCount: 5_000 };
    const gain = computePriority(brigaded).total - computePriority(base).total;
    // The whole corroboration term is worth 12 points; 1,000x the reports
    // cannot buy more than what is left of it.
    expect(gain).toBeLessThanOrEqual(WEIGHTS.corroborations * 100);
    expect(gain).toBeLessThan(11);
  });

  it("treats missing inputs as zero rather than throwing", () => {
    const result = computePriority({
      severity: null,
      hazard: null,
      hazardStrength: null,
      peopleAffected: null,
      blockVulnerability: null,
      corroborationCount: null,
      recurrence: null,
      officialEndorsed: false,
    });
    expect(result.total).toBe(0);
    expect(result.terms).toHaveLength(TERM_ORDER.length);
  });
});

describe("normalisers", () => {
  it("log-normalises people affected so a 10x population is not a 10x score", () => {
    const small = normalise.peopleAffected(50);
    const large = normalise.peopleAffected(500);
    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeLessThan(2);
  });

  it("caps corroborations at 1", () => {
    expect(normalise.corroborations(10_000)).toBe(1);
  });

  it("orders recurrence one-off < seasonal < yearly < constant", () => {
    expect(normalise.recurrence("one-off")).toBeLessThan(normalise.recurrence("seasonal"));
    expect(normalise.recurrence("seasonal")).toBeLessThan(normalise.recurrence("yearly"));
    expect(normalise.recurrence("yearly")).toBeLessThan(normalise.recurrence("constant"));
  });

  it("clamps out-of-range values instead of propagating them", () => {
    expect(normalise.severity(4)).toBe(1);
    expect(normalise.severity(-1)).toBe(0);
    expect(normalise.blockVulnerability(9)).toBe(1);
  });
});

describe("topContributors", () => {
  it("returns the three largest, and never a term contributing nothing", () => {
    const result = computePriority({ ...MINIMAL, severity: 0.9, blockVulnerability: 0.8 });
    const top = topContributors(result, 3);
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top.every((t) => t.contribution > 0)).toBe(true);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].contribution).toBeGreaterThanOrEqual(top[i].contribution);
    }
  });
});

describe("purity", () => {
  /**
   * The contract in the package's own doc comment, enforced. A future edit that
   * reaches for the database or the clock from inside the scoring function
   * fails here rather than quietly making the score unreproducible.
   */
  it("imports nothing from app/, lib/ or node, and reads no clock", () => {
    const dir = join(process.cwd(), "packages/scoring");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(code, `${file} imports from outside the package`).not.toMatch(
        /from\s+["'](@\/|node:|drizzle|postgres|next|react)/,
      );
      expect(code, `${file} reads the clock`).not.toMatch(/Date\.now|new Date/);
      expect(code, `${file} performs I/O`).not.toMatch(/\bfetch\s*\(|process\.env/);
    }
  });
});
