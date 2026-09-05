/**
 * The SLA table, exercised without a database.
 *
 * `lib/sla/deadlines.ts` is pure on purpose: invariant 1 is a claim about every
 * state in the machine, and the only way to check every state is to enumerate
 * them. `tests/invariant.test.ts` then proves the same thing against the real
 * data; this proves it against the definition.
 */
import { describe, expect, it } from "vitest";

import { deadlinesFor } from "@/lib/sla/deadlines";
import { TERMINAL_STATES, TRANSITIONS, type TerminalState } from "@/lib/db/stateMachine";
import type { ChallengeStatus } from "@/lib/db/schema";

const ALL = Object.keys(TRANSITIONS) as ChallengeStatus[];
const now = new Date("2026-09-05T00:00:00.000Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe("invariant 1, at the definition", () => {
  it("every non-terminal state opens at least one deadline", () => {
    const bare = ALL.filter(
      (s) => !(TERMINAL_STATES as readonly ChallengeStatus[]).includes(s) && deadlinesFor(s, { now }).length === 0,
    );
    expect(bare, `states with no deadline: ${bare.join(", ")}`).toEqual([]);
  });

  it("PARKED carries an annual re-review, so it re-enters routing", () => {
    const specs = deadlinesFor("PARKED", { now });
    expect(specs).toHaveLength(1);
    expect(specs[0].kind).toBe("ANNUAL_REVIEW");
    expect(specs[0].dueAt.toISOString()).toBe(day(365).toISOString());
  });

  it("the other five terminal states open nothing", () => {
    for (const s of TERMINAL_STATES.filter((t) => t !== "PARKED") as TerminalState[]) {
      expect(deadlinesFor(s, { now }), s).toEqual([]);
    }
  });
});

describe("ladder 1 — nobody claimed it", () => {
  it("ROUTED opens the full ladder at 7, 14, 21 and 45 days", () => {
    const specs = deadlinesFor("ROUTED", { now });
    expect(specs.map((s) => [s.kind, s.dueAt.toISOString()])).toEqual([
      ["WIDEN", day(7).toISOString()],
      ["OPEN_ALL", day(14).toISOString()],
      ["BREACH", day(21).toISOString()],
      ["GRAND_CHALLENGE", day(45).toISOString()],
    ]);
  });

  it("the escalation states carry the REMAINDER, so the ladder does not reset when it climbs", () => {
    // Entering UNCLAIMED_ESCALATED happens on day 7 of the ladder above. Its
    // rungs must land on the same absolute days 14, 21 and 45.
    const atDay7 = day(7);
    const specs = deadlinesFor("UNCLAIMED_ESCALATED", { now: atDay7 });
    expect(specs.map((s) => [s.kind, s.dueAt.toISOString()])).toEqual([
      ["OPEN_ALL", day(14).toISOString()],
      ["BREACH", day(21).toISOString()],
      ["GRAND_CHALLENGE", day(45).toISOString()],
    ]);

    // And BOUNTY_LISTED is entered on day 21 by the BREACH rung.
    const atDay21 = day(21);
    const bounty = deadlinesFor("BOUNTY_LISTED", { now: atDay21 });
    expect(bounty[0].kind).toBe("GRAND_CHALLENGE");
    expect(bounty[0].dueAt.toISOString()).toBe(day(45).toISOString());
  });
});

describe("ladder 3 — silence is measured from the last thing the team did", () => {
  it("SILENT_30 and SILENT_45 run from last_activity_at, not from now", () => {
    const lastActivityAt = new Date("2026-08-01T00:00:00.000Z");
    const specs = deadlinesFor("IN_RESEARCH", { now, lastActivityAt, projectId: "p1" });
    expect(specs.map((s) => s.kind)).toEqual(["SILENT_30", "SILENT_45"]);
    expect(specs[0].dueAt.toISOString()).toBe(new Date("2026-08-31T00:00:00.000Z").toISOString());
    expect(specs[1].dueAt.toISOString()).toBe(new Date("2026-09-15T00:00:00.000Z").toISOString());
    expect(specs.every((s) => s.projectId === "p1")).toBe(true);
  });

  it("AT_RISK opens fork rights 15 days later — day 45 of the same ladder", () => {
    const specs = deadlinesFor("AT_RISK", { now, lastActivityAt: now });
    expect(specs.map((s) => s.kind)).toEqual(["SILENT_45"]);
    expect(specs[0].dueAt.toISOString()).toBe(day(15).toISOString());
  });
});

describe("the confirmation clock", () => {
  it("IMPLEMENTED starts a 30-day clock on the citizen's confirmation, not on the claim", () => {
    const specs = deadlinesFor("IMPLEMENTED", { now });
    expect(specs.map((s) => s.kind)).toEqual(["IMPACT_UNCONFIRMED_30"]);
    expect(specs[0].dueAt.toISOString()).toBe(day(30).toISOString());
  });

  it("CITIZEN_VERIFIED is not the end — closure is on a clock too", () => {
    expect(deadlinesFor("CITIZEN_VERIFIED", { now }).map((s) => s.kind)).toEqual(["CLOSURE_DUE"]);
  });
});
