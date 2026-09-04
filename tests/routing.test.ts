/**
 * S5's guardrail and its arithmetic.
 *
 * CLAUDE.md invariant 4 says the AI never invents a routing reason. The prompt
 * asks it not to; `guardReason` is what makes it true. These tests are the
 * evidence for that claim, and they run without a network or a database
 * because both functions under test are pure.
 */
import { describe, expect, it } from "vitest";

import {
  MATCH_WEIGHTS,
  ROUTING,
  capacityWindowCovers,
  guardReason,
  templateReason,
} from "@/lib/ai/routing";
import type { S5ReasonInput } from "@/lib/ai/schemas";

const FACTS: S5ReasonInput = {
  institution: "BIT Sindri",
  department: "Civil Engineering",
  lab: "Hydraulics and Water Resources Laboratory",
  terms: [
    { label: "Semantic fit", detail: "a good match to the department's declared work", contribution: 0.249 },
    { label: "Specialisation overlap", detail: "specialisation tags covering embankment, flood", contribution: 0.1 },
    { label: "Declared capacity", detail: "3 capstone team slots declared open", contribution: 0.072 },
  ],
};

describe("match weights", () => {
  it("sum to 1.00", () => {
    const sum = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("weight semantic fit highest", () => {
    const ranked = Object.entries(MATCH_WEIGHTS).sort((a, b) => b[1] - a[1]);
    expect(ranked[0][0]).toBe("semantic");
  });
});

describe("guardReason", () => {
  it("accepts a sentence built only from the supplied facts", () => {
    const sentence =
      "Matched to BIT Sindri, Civil Engineering — Hydraulics and Water Resources Laboratory: " +
      "a good match to the department's declared work, specialisation tags covering embankment " +
      "and flood, and 3 capstone team slots declared open.";
    expect(guardReason(sentence, FACTS)).toEqual({ ok: true });
  });

  it("rejects an invented distance", () => {
    // The classic hallucination: a plausible number nobody supplied. No
    // distance term was given here at all.
    const sentence =
      "Matched to BIT Sindri, Civil Engineering: a good match to the department's declared work, " +
      "148 km from the reported location, and 3 capstone team slots declared open.";
    const verdict = guardReason(sentence, FACTS);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("148");
  });

  it("rejects an invented year or ranking", () => {
    const sentence =
      "Matched to BIT Sindri, Civil Engineering, established in 1949 and ranked among the top " +
      "engineering colleges: a good match to the department's declared work.";
    expect(guardReason(sentence, FACTS).ok).toBe(false);
  });

  it("rejects a quantity written as a word when the digit was not supplied", () => {
    const sentence =
      "Matched to BIT Sindri, Civil Engineering: a good match to the department's declared work, " +
      "with seven faculty members available.";
    const verdict = guardReason(sentence, FACTS);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("seven");
  });

  it("accepts a quantity written as a word when the digit WAS supplied", () => {
    const sentence =
      "Matched to BIT Sindri, Civil Engineering: a good match to the department's declared work, " +
      "with three capstone team slots declared open.";
    expect(guardReason(sentence, FACTS)).toEqual({ ok: true });
  });

  it("rejects a sentence that does not name the institution it was given", () => {
    const sentence =
      "Matched to a nearby engineering college: a good match to the department's declared work.";
    expect(guardReason(sentence, FACTS).ok).toBe(false);
  });

  it("passes its own template output", () => {
    // The level-2 fallback must never be rejected by the guardrail, or a
    // degraded run would have no reason sentence at all.
    expect(guardReason(templateReason(FACTS), FACTS)).toEqual({ ok: true });
  });

  it("treats 1,500 and 1500 as the same number", () => {
    const facts: S5ReasonInput = {
      ...FACTS,
      terms: [{ label: "People", detail: "about 1,500 people affected", contribution: 0.1 }],
    };
    const sentence = "Matched to BIT Sindri, Civil Engineering: about 1500 people affected.";
    expect(guardReason(sentence, facts)).toEqual({ ok: true });
  });
});

describe("capacityWindowCovers", () => {
  const inside = new Date("2026-10-01T00:00:00Z");
  const outside = new Date("2027-03-01T00:00:00Z");

  it("is open when both bounds are null", () => {
    expect(capacityWindowCovers({ capacityFrom: null, capacityTo: null }, outside)).toBe(true);
  });

  it("is open inside the declared window", () => {
    expect(
      capacityWindowCovers({ capacityFrom: "2026-08-01", capacityTo: "2026-12-31" }, inside),
    ).toBe(true);
  });

  it("is closed outside the declared window", () => {
    // A closed window zeroes the capacity term entirely, so a department that
    // has declared no slots this semester does not get offered work.
    expect(
      capacityWindowCovers({ capacityFrom: "2026-08-01", capacityTo: "2026-12-31" }, outside),
    ).toBe(false);
  });
});

describe("the human gate", () => {
  it("is set at 0.7 severity", () => {
    // PHASE_2_LEARN.md section 8. Moving this number changes who has to look at
    // a challenge before it can be routed, so it gets a test of its own.
    expect(ROUTING.humanGateSeverity).toBe(0.7);
  });

  it("offers a 7-day claim window to 3 institutions", () => {
    expect(ROUTING.claimWindowDays).toBe(7);
    expect(ROUTING.shortlist).toBe(3);
  });
});
