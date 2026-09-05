/**
 * S1's decision layer — the code that decides, given what the model returned.
 *
 * CLAUDE.md invariant 3: the AI proposes, deterministic code decides. This file
 * tests the deciding half, and in particular the extra evidence a forward needs
 * on top of the model's confidence, because FORWARDED_EXTERNAL is terminal and
 * a false positive there costs a citizen their report with no way back.
 */
import { describe, expect, it } from "vitest";

import { hasGrievanceEvidence } from "@/lib/ai/gazetteer";
import { S1_THRESHOLDS, decideS1, mockReference } from "@/lib/ai/triage";
import type { S1Output } from "@/lib/ai/schemas";

function out(patch: Partial<S1Output> = {}): S1Output {
  return {
    is_unsafe: false,
    unsafe_category: null,
    is_grievance: false,
    grievance_target: null,
    confidence: 0.9,
    rationale: "test",
    ...patch,
  };
}

const EMBANKMENT =
  "The mud embankment on the South Koel river has a crack that started after last monsoon. " +
  "Nobody from the block has come to see it even after we told the mukhiya twice.";

const PMGSY =
  "The PMGSY road to our village was sanctioned in 2022 and not one metre has been laid.";

const TANK =
  "The overhead water tank on the school roof has cracked and water runs down the classroom " +
  "wall. Nobody can tell us whether the tank will come down or whether the wall can hold it.";

describe("decideS1 — unsafe", () => {
  it("rejects at or above the unsafe floor and offers the right helpline", () => {
    const decision = decideS1(
      out({ is_unsafe: true, unsafe_category: "SELF_HARM", confidence: S1_THRESHOLDS.unsafe }),
      "JH-2026-GUM-0001",
      "irrelevant",
    );
    expect(decision.kind).toBe("REJECT_UNSAFE");
    if (decision.kind === "REJECT_UNSAFE") expect(decision.helpline.number).toBe("14416");
  });

  it("does not reject below the floor — a human looks first", () => {
    const decision = decideS1(
      out({ is_unsafe: true, unsafe_category: "SELF_HARM", confidence: 0.55 }),
      "JH-2026-GUM-0001",
      "irrelevant",
    );
    expect(decision.kind).toBe("HUMAN_QUEUE");
  });

  it("falls back to 112 for an unrecognised category rather than a dead end", () => {
    const decision = decideS1(
      out({ is_unsafe: true, unsafe_category: "SOMETHING_NEW", confidence: 0.9 }),
      "JH-2026-GUM-0001",
      "irrelevant",
    );
    if (decision.kind === "REJECT_UNSAFE") expect(decision.helpline.number).toBe("112");
  });
});

describe("decideS1 — grievance", () => {
  it("forwards a real grievance that names its scheme", () => {
    const decision = decideS1(
      out({ is_grievance: true, grievance_target: "CPGRAMS", confidence: 0.92 }),
      "JH-2026-CHA-0001",
      PMGSY,
    );
    expect(decision.kind).toBe("FORWARD_EXTERNAL");
    if (decision.kind === "FORWARD_EXTERNAL") {
      expect(decision.target).toBe("CPGRAMS");
      expect(decision.reference).toBe("CPG/JH/2026/CHA/0001");
    }
  });

  it("refuses to forward a confident model call with no evidence in the text", () => {
    // The regression this guard exists for. Level 1 called the cracked school
    // water tank a grievance at 0.90 and forwarded it to JharSewa. The text
    // names no scheme, no sanctioned work and no entitlement, so the code now
    // holds it for a human instead of taking an action it cannot undo.
    const decision = decideS1(
      out({ is_grievance: true, grievance_target: "JharSewa", confidence: 0.9 }),
      "JH-2026-GUM-0005",
      TANK,
    );
    expect(decision.kind).toBe("HUMAN_QUEUE");
    if (decision.kind === "HUMAN_QUEUE") expect(decision.why).toMatch(/cannot be undone/);
  });

  it("does not forward below the grievance floor even with evidence", () => {
    const decision = decideS1(
      out({ is_grievance: true, grievance_target: "CPGRAMS", confidence: 0.65 }),
      "JH-2026-CHA-0001",
      PMGSY,
    );
    expect(decision.kind).not.toBe("FORWARD_EXTERNAL");
  });

  it("continues an ordinary research problem", () => {
    expect(decideS1(out(), "JH-2026-GUM-0001", EMBANKMENT).kind).toBe("CONTINUE");
  });

  it("holds a low-confidence answer for a human", () => {
    // A level-2 rules answer is 0.45, so degrading to the gazetteer always
    // lands in front of a person rather than deciding on a keyword.
    expect(decideS1(out({ confidence: 0.45 }), "JH-2026-GUM-0001", EMBANKMENT).kind).toBe(
      "HUMAN_QUEUE",
    );
  });
});

describe("hasGrievanceEvidence", () => {
  it("finds a named scheme in English and in Hindi", () => {
    expect(hasGrievanceEvidence(PMGSY)).toBe(true);
    expect(hasGrievanceEvidence("2022 में स्वीकृत पीएमजीएसवाई सड़क आज तक नहीं बनी")).toBe(true);
    expect(hasGrievanceEvidence("Jal Jeevan Mission taps were fitted in 2024")).toBe(true);
  });

  it("does not fire on a research problem that merely mentions officials", () => {
    expect(hasGrievanceEvidence(EMBANKMENT)).toBe(false);
    expect(hasGrievanceEvidence(TANK)).toBe(false);
    expect(
      hasGrievanceEvidence(
        "Forest guard says he has no people. We want to know where the fire will come from.",
      ),
    ).toBe(false);
  });
});

describe("mockReference", () => {
  it("is unique per district, not just per sequence number", () => {
    // Two different grievances once shared CPG/JH/2026/20260001 because the
    // district letters were stripped out of the tracking ID.
    const a = mockReference("CPGRAMS", "JH-2026-CHA-0001");
    const b = mockReference("CPGRAMS", "JH-2026-DEO-0001");
    expect(a).not.toBe(b);
  });

  it("is deterministic, so a replay produces the same reference", () => {
    expect(mockReference("JharSewa", "JH-2026-PAL-0003")).toBe(
      mockReference("JharSewa", "JH-2026-PAL-0003"),
    );
  });
});
