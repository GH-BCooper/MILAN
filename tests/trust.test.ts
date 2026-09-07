/**
 * The trust policy, pinned without a database.
 *
 * lib/credit/trust.ts is pure on purpose: an anti-brigading rule you cannot
 * read in one sitting is a rule nobody believes at judging. These tests are
 * the slide — earn, lose, decay, and the fixed points that stop it being
 * gameable.
 */
import { describe, expect, it } from "vitest";

import {
  DELTA_MERGE_CREDITED,
  DELTA_REJECTED_UNSAFE,
  DELTA_REPORT_VERIFIED,
  TRUST_BASELINE,
  applyDelta,
  corroborationWeight,
  decayTrust,
  tierLabel,
} from "@/lib/credit/trust";
import { corroborationTrustWeight } from "@/packages/scoring/normalise";

describe("applyDelta", () => {
  it("earns and clamps at 1", () => {
    expect(applyDelta(0.5, DELTA_REPORT_VERIFIED)).toBe(0.6);
    expect(applyDelta(0.95, DELTA_REPORT_VERIFIED)).toBe(1);
  });

  it("loses, clamps at 0, and never lets one merge outrank one unsafe report", () => {
    expect(applyDelta(0.5, DELTA_REJECTED_UNSAFE)).toBe(0.3);
    expect(applyDelta(0.1, DELTA_REJECTED_UNSAFE)).toBe(0);
    // The profitability check, as arithmetic: brigading must not pay.
    const gains = 5 * DELTA_MERGE_CREDITED;
    expect(gains).toBeLessThan(Math.abs(DELTA_REJECTED_UNSAFE));
  });

  it("rounds to 2dp so the value always fits numeric(3,2) exactly", () => {
    expect(applyDelta(0.33, 0.03)).toBe(0.36);
    expect(applyDelta(0.16, 0.03)).toBe(0.19);
  });
});

describe("decayTrust", () => {
  it("moves toward the baseline from both sides", () => {
    expect(decayTrust(1, 10)).toBeLessThan(1);
    expect(decayTrust(1, 10)).toBeGreaterThan(0.5);
    expect(decayTrust(0, 10)).toBeGreaterThan(0);
    expect(decayTrust(0, 10)).toBeLessThan(0.5);
  });

  it("is a no-op at the baseline — idle accounts neither gain nor lose", () => {
    expect(decayTrust(TRUST_BASELINE, 365)).toBe(TRUST_BASELINE);
  });

  it("applies zero days as zero change, and survives nonsense", () => {
    expect(decayTrust(0.9, 0)).toBe(0.9);
    expect(decayTrust(0.9, -5)).toBe(0.9);
  });

  it("has the intended half-life: about 23 days", () => {
    // 0.97^23 ≈ 0.5, so an earned 0.5-point lead halves in ~23 days.
    const half = decayTrust(1, 23);
    expect(half).toBeGreaterThan(0.7);
    expect(half).toBeLessThan(0.8);
  });
});

describe("corroborationWeight — the score-side coupling", () => {
  it("weights an unknown crowd as exactly 1 (the v1.0.0 fixed point)", () => {
    expect(corroborationWeight(null)).toBe(1);
    expect(corroborationWeight(undefined)).toBe(1);
    expect(corroborationTrustWeight(null)).toBe(1);
  });

  it("doubles a fully proven crowd and zeroes a fully penalised one", () => {
    expect(corroborationWeight(1)).toBe(2);
    expect(corroborationWeight(0)).toBe(0);
    expect(corroborationWeight(0.5)).toBe(1);
  });

  it("clamps nonsense instead of exploding", () => {
    expect(corroborationWeight(5)).toBe(2);
    expect(corroborationWeight(-3)).toBe(0);
  });
});

describe("tierLabel", () => {
  it("names the identity tiers", () => {
    expect(tierLabel(1)).toBe("Phone-verified");
    expect(tierLabel(2)).toBe("Verified by an official");
    expect(tierLabel(3)).toBe("Aadhaar-tier verified identity");
  });
});
