/**
 * Emergency Mode's two deterministic halves, exercised without a database.
 *
 *  - the clock compression in `deadlinesFor(clockScale)`: every rung halves,
 *    annual re-reviews do not, and every compressed row says so in its payload;
 *  - the display surge in `surgeRank`: linked challenges lift by a bounded,
 *    explained multiplier; nothing else moves, and no stored score is touched.
 *
 * The SQL sweep that compresses *already-open* rows is exercised against the
 * real database by scripts/verify-emergency.mts, not here.
 */
import { describe, expect, it } from "vitest";

import {
  EMERGENCY_TIME_SCALE,
  deadlinesFor,
  emergencyScale,
} from "@/lib/sla/deadlines";
import { SURGE_BOOST_MAX, surgeLabel, surgeRank } from "@/lib/emergency/surge";

const now = new Date("2026-09-07T00:00:00.000Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe("emergencyScale — who gets compressed", () => {
  it("matches only the pinned hazard, and never NONE", () => {
    expect(emergencyScale(true, "FLOOD", "FLOOD")).toBe(EMERGENCY_TIME_SCALE);
    expect(emergencyScale(true, "FLOOD", "DROUGHT")).toBe(1);
    expect(emergencyScale(true, "FLOOD", null)).toBe(1);
    expect(emergencyScale(false, "FLOOD", "FLOOD")).toBe(1);
    expect(emergencyScale(true, "FLOOD", "NONE")).toBe(1);
  });
});

describe("deadlinesFor under Emergency Mode", () => {
  it("halves the full ladder-1 rungs, keeping their order", () => {
    const specs = deadlinesFor("ROUTED", { now, clockScale: EMERGENCY_TIME_SCALE });
    expect(specs.map((s) => [s.kind, s.dueAt.toISOString()])).toEqual([
      ["WIDEN", day(7 * EMERGENCY_TIME_SCALE).toISOString()],
      ["OPEN_ALL", day(14 * EMERGENCY_TIME_SCALE).toISOString()],
      ["BREACH", day(21 * EMERGENCY_TIME_SCALE).toISOString()],
      ["GRAND_CHALLENGE", day(45 * EMERGENCY_TIME_SCALE).toISOString()],
    ]);
  });

  it("marks every compressed row in its payload, so the badge on /gov/sla is honest", () => {
    const specs = deadlinesFor("PRIORITISED", { now, clockScale: EMERGENCY_TIME_SCALE });
    expect(specs).toHaveLength(1);
    expect(specs[0].payload?.emergencyClock).toBe(EMERGENCY_TIME_SCALE);
  });

  it("never compresses or marks an annual re-review", () => {
    const specs = deadlinesFor("PARKED", { now, clockScale: EMERGENCY_TIME_SCALE });
    expect(specs[0].kind).toBe("ANNUAL_REVIEW");
    expect(specs[0].dueAt.toISOString()).toBe(day(365).toISOString());
    expect(specs[0].payload?.emergencyClock).toBeUndefined();
  });

  it("keeps the escalation remainders on the same absolute (halved) dates", () => {
    // Entered UNCLAIMED_ESCALATED at (halved) day 3.5: the remainder rungs must
    // land on halved days 7, 10.5 and 22.5, not restart a full peacetime ladder.
    const at = day(7 * EMERGENCY_TIME_SCALE);
    const specs = deadlinesFor("UNCLAIMED_ESCALATED", { now: at, clockScale: EMERGENCY_TIME_SCALE });
    expect(specs.map((s) => s.dueAt.toISOString())).toEqual([
      day(14 * EMERGENCY_TIME_SCALE).toISOString(),
      day(21 * EMERGENCY_TIME_SCALE).toISOString(),
      day(45 * EMERGENCY_TIME_SCALE).toISOString(),
    ]);
  });

  it("degrades to peacetime on a nonsense scale rather than firing everything at once", () => {
    for (const bad of [0, -1, 2, Number.NaN]) {
      expect(deadlinesFor("ROUTED", { now, clockScale: bad })[0].dueAt.toISOString()).toBe(day(7).toISOString());
    }
  });

  it("peacetime specs carry no emergency marker, so pre-emergency rows stay untouched", () => {
    const specs = deadlinesFor("ROUTED", { now });
    expect(specs.every((s) => s.payload?.emergencyClock === undefined)).toBe(true);
  });
});

describe("surgeRank — the display re-rank", () => {
  it("lifts a linked challenge by its own hazard strength, and shows the arithmetic", () => {
    const r = surgeRank({ priorityScore: 60, hazard: "FLOOD", hazardStrength: 0.8, emergencyHazard: "FLOOD" });
    expect(r.multiplier).toBe(1 + SURGE_BOOST_MAX * 0.8);
    expect(r.sortKey).toBeCloseTo(60 * (1 + SURGE_BOOST_MAX * 0.8), 6);
    expect(surgeLabel(r)).toBe(
      `×${r.multiplier.toFixed(2)} emergency surge = ${r.sortKey.toFixed(1)} (display only; stored score 60.0 unchanged)`,
    );
  });

  it("leaves the stored score untouched and unlinked challenges exactly where they were", () => {
    const r = surgeRank({ priorityScore: 72, hazard: "DROUGHT", hazardStrength: 0.9, emergencyHazard: "FLOOD" });
    expect(r).toEqual({ sortKey: 72, multiplier: 1, matched: false, storedScore: 72 });
    expect(surgeLabel(r)).toBeNull();
  });

  it("cannot float a weak linked problem above a strong unlinked one — the boost is bounded", () => {
    const weak = surgeRank({ priorityScore: 40, hazard: "FLOOD", hazardStrength: 1, emergencyHazard: "FLOOD" });
    const strong = surgeRank({ priorityScore: 60, hazard: "DROUGHT", hazardStrength: 0.9, emergencyHazard: "FLOOD" });
    // 40 × 1.25 = 50 < 60: an emergency re-orders the top of the list, it does
    // not manufacture a new top of the list.
    expect(weak.sortKey).toBeLessThan(strong.sortKey);
  });

  it("treats unknown hazard strength as half-linked rather than hiding the report", () => {
    const r = surgeRank({ priorityScore: 50, hazard: "FLOOD", hazardStrength: null, emergencyHazard: "FLOOD" });
    expect(r.multiplier).toBe(1 + SURGE_BOOST_MAX * 0.5);
  });

  it("does nothing when no emergency is running", () => {
    const r = surgeRank({ priorityScore: 50, hazard: "FLOOD", hazardStrength: 0.9, emergencyHazard: null });
    expect(r.matched).toBe(false);
    expect(r.sortKey).toBe(50);
  });

  it("sorts unscored linked challenges above nothing, but below every scored one", () => {
    const unscored = surgeRank({ priorityScore: null, hazard: "FLOOD", hazardStrength: 1, emergencyHazard: "FLOOD" });
    expect(unscored.sortKey).toBe(0);
  });
});
