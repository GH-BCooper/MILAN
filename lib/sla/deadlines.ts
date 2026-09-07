/**
 * What clock a state starts.
 *
 * CLAUDE.md invariant 1: no challenge may silently die. Every challenge in a
 * non-terminal state must have at least one open row in `sla_deadlines`. That is
 * a statement about *all* twenty-two non-terminal states, not only the seven the
 * ladder table in PHASE_3_BUILD.md Task 3.2 names — so the pipeline states, the
 * human gate, the closure step and a dispute each get a clock too. A challenge
 * stuck at CLASSIFIED because the pipeline crashed is exactly the silent death
 * the invariant exists to prevent.
 *
 * This module is pure: it takes a state and a context and returns rows. It does
 * no I/O and it does not know what a transaction is, which is what lets
 * `tests/sla.test.ts` enumerate every state without a database.
 */
import { MS_PER_DAY } from "@/lib/clock";
import type { ChallengeStatus, SlaKind } from "@/lib/db/schema";
import { TERMINAL_STATES } from "@/lib/db/stateMachine";

export interface DeadlineSpec {
  kind: SlaKind;
  dueAt: Date;
  projectId?: string | null;
  payload?: Record<string, unknown>;
}

export interface DeadlineContext {
  /** Milan-now, passed in rather than read, so this module stays pure. */
  now: Date;
  projectId?: string | null;
  /**
   * The SILENT ladders are measured from the last thing the team actually did,
   * not from when they claimed. Rescheduled on every project write.
   */
  lastActivityAt?: Date | null;
  /** ROUTED restarting after a released claim keeps its original ladder shape. */
  escalationStage?: string | null;
  /**
   * Emergency Mode (hazard-pinned): every clock for a challenge linked to the
   * pinned hazard runs this much faster. 1 is peacetime. The District
   * Collector's flood week should not wait seven days for a WIDEN on a
   * flood-linked embankment problem — this is the Disaster Management teeth of
   * `/gov/emergency`, and it compresses the clocks the challenge already has
   * rather than rewriting history: due dates move closer, they are never
   * cancelled or re-kinded. ANNUAL_REVIEW is exempt (see below).
   */
  clockScale?: number;
}

/**
 * The compression factor Emergency Mode applies to a pinned hazard's clocks.
 * Halves every window: a 7-day WIDEN rung fires in 3.5 days. Chosen so the
 * demo can show a ladder climbing in one fast-forward, and so a full
 * ladder-1 escalation still takes 22.5 days of Milan time — compression must
 * not turn "nobody claimed it" into an instant bounty.
 */
export const EMERGENCY_TIME_SCALE = 0.5;

/**
 * Peacetime unless the pinned hazard is this challenge's hazard. Pure so both
 * the state machine (inside a transaction) and the reaper (once per run) can
 * compute it from the same two facts without duplicating the rule.
 */
export function emergencyScale(
  on: boolean,
  emergencyHazard: string | null | undefined,
  challengeHazard: string | null | undefined,
): number {
  return on &&
    Boolean(emergencyHazard) &&
    Boolean(challengeHazard) &&
    challengeHazard !== "NONE" &&
    emergencyHazard === challengeHazard
    ? EMERGENCY_TIME_SCALE
    : 1;
}

/** ANNUAL_REVIEW never compresses: re-review cadence is not an emergency tool,
 *  and halving a 365-day clock every flood alert would compound nonsensically. */
const UNSCALED_KINDS: readonly SlaKind[] = ["ANNUAL_REVIEW"];

function scaleFor(ctx: DeadlineContext): number {
  const s = ctx.clockScale ?? 1;
  // Guard the pure module against nonsense from a caller: a scale outside
  // (0, 1] is a programming error, and peacetime is the safe degradation.
  if (!Number.isFinite(s) || s <= 0 || s > 1) return 1;
  return s;
}

const daysRaw = (from: Date, n: number): Date => new Date(from.getTime() + n * MS_PER_DAY);

/** Scale-aware clock offsets live inside the builder, so every rung definition
 *  stays in peacetime days and the compression is applied in exactly one place. */
function specsFor(status: ChallengeStatus, ctx: DeadlineContext): DeadlineSpec[] {
  const { now } = ctx;
  const project = ctx.projectId ?? null;
  const activity = ctx.lastActivityAt ?? now;
  const scale = scaleFor(ctx);
  const days = (from: Date, n: number): Date => new Date(from.getTime() + n * scale * MS_PER_DAY);

/**
 * The ladder table from PHASE_3_BUILD.md Task 3.2, plus full coverage.
 *
 * The three escalation states each carry the REMAINDER of ladder 1 rather than a
 * fresh copy: entering UNCLAIMED_ESCALATED happens on day 7, so its OPEN_ALL is
 * +7 more days, which is day 14 from routing — the same absolute date the
 * ROUTED row named. A state change cancels open deadlines (it must: they belong
 * to the state being left), so without this the ladder would reset itself every
 * time it climbed a rung. Under Emergency Mode the whole ladder scales
 * uniformly, so those "same absolute date" guarantees keep holding at half time.
 */
  switch (status) {
    /* --- intake and the pipeline. Nothing may stall unseen. ---------------- */
    case "SUBMITTED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 1), payload: { expect: "TRIAGED", stage: "S1" } }];
    case "TRIAGED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 1), payload: { expect: "CLASSIFIED", stage: "S2" } }];
    case "CLASSIFIED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 1), payload: { expect: "CLUSTERED", stage: "S3" } }];
    case "CLUSTERED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 1), payload: { expect: "PRIORITISED", stage: "S4" } }];
    case "NEEDS_MORE_INFO":
      // The citizen has a fortnight to answer; after that it parks rather than rots.
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 14), payload: { expect: "PARKED", stage: "citizen-reply" } }];
    case "PRIORITISED":
      // Invariant 5: severity >= 0.7 waits for a human. A human who never comes
      // is the failure mode, so the wait itself is on a clock.
      return [{ kind: "GATE_TIMEOUT", dueAt: days(now, 3), payload: { queue: "/gov/gate" } }];
    case "VERIFIED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 2), payload: { expect: "ROUTED", stage: "S5" } }];

    /* --- ladder 1: nobody claimed it -------------------------------------- */
    case "ROUTED":
      return [
        { kind: "WIDEN", dueAt: days(now, 7) },
        { kind: "OPEN_ALL", dueAt: days(now, 14) },
        { kind: "BREACH", dueAt: days(now, 21) },
        { kind: "GRAND_CHALLENGE", dueAt: days(now, 45) },
      ];
    case "UNCLAIMED_ESCALATED":
      // Entered at day 7 of ladder 1. The remainder, at the same absolute dates.
      return [
        { kind: "OPEN_ALL", dueAt: days(now, 7) },
        { kind: "BREACH", dueAt: days(now, 14) },
        { kind: "GRAND_CHALLENGE", dueAt: days(now, 38) },
      ];
    case "BOUNTY_LISTED":
      // Entered at day 21 by BREACH. Grand Challenges at day 45; if that passes
      // too it goes to an annual re-review rather than dropping off the board.
      return [
        { kind: "GRAND_CHALLENGE", dueAt: days(now, 24) },
        // Unscaled: a re-review cadence is not an emergency tool.
        { kind: "ANNUAL_REVIEW", dueAt: daysRaw(now, 365) },
      ];

    /* --- ladder 2: claimed, but nothing arrives --------------------------- */
    case "CLAIMED":
      return [{ kind: "PROPOSAL_DUE", dueAt: days(now, 14), projectId: project }];
    case "FORKED":
      return [{ kind: "PROPOSAL_DUE", dueAt: days(now, 14), projectId: project }];

    /* --- ladder 3: silence ------------------------------------------------ */
    case "PROPOSAL_APPROVED":
    case "IN_RESEARCH":
      return [
        { kind: "SILENT_30", dueAt: days(activity, 30), projectId: project },
        { kind: "SILENT_45", dueAt: days(activity, 45), projectId: project },
      ];
    case "AT_RISK":
      // SILENT_30 already fired. Fork rights open 15 days later — day 45.
      return [{ kind: "SILENT_45", dueAt: days(activity, 15), projectId: project }];

    /* --- publication, uptake and delivery --------------------------------- */
    case "SOLUTION_PUBLISHED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 60), projectId: project, payload: { expect: "uptake" } }];
    case "INDUSTRY_INTEREST":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 30), projectId: project, payload: { expect: "AGREEMENT_SIGNED" } }];
    case "AGREEMENT_SIGNED":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 60), projectId: project, payload: { expect: "PILOT" } }];
    case "PILOT":
      return [{ kind: "STAGE_TIMEOUT", dueAt: days(now, 90), projectId: project, payload: { expect: "IMPLEMENTED" } }];

    /* --- the confirmation loop -------------------------------------------- */
    case "IMPLEMENTED":
      // Invariant 7. An implementer's claim is not an outcome until the person
      // who reported the problem says it is, and this is the clock on that.
      return [{ kind: "IMPACT_UNCONFIRMED_30", dueAt: days(now, 30), projectId: project }];
    case "CITIZEN_VERIFIED":
      return [{ kind: "CLOSURE_DUE", dueAt: days(now, 7), projectId: project }];
    case "DISPUTED":
      return [{ kind: "DISPUTE_REVIEW", dueAt: days(now, 14), projectId: project }];

    /* --- terminal ---------------------------------------------------------- */
    case "PARKED":
      // Terminal for routing, but never forgotten. Invariant 1's parenthesis.
      // Unscaled: re-review cadence is not an emergency tool.
      return [{ kind: "ANNUAL_REVIEW", dueAt: daysRaw(now, 365) }];
    case "CLOSED":
    case "MERGED":
    case "FORWARDED_EXTERNAL":
    case "WITHDRAWN":
    case "REJECTED_UNSAFE":
      return [];
  }
}

/**
 * The public entry point: the peacetime ladder, compressed and marked when
 * Emergency Mode pins this challenge's hazard.
 *
 * The marker (`payload.emergencyClock`) is what /gov/sla and /demo render as a
 * "clock compressed ×0.5" badge, so a shorter window is explained on the screen
 * it appears on rather than looking like a bug in the ladder. Exempt kinds are
 * returned untouched, marker and all, so an annual re-review row never claims
 * compression that did not happen.
 */
export function deadlinesFor(status: ChallengeStatus, ctx: DeadlineContext): DeadlineSpec[] {
  const scale = scaleFor(ctx);
  const specs = specsFor(status, ctx);
  if (scale === 1) return specs;
  return specs.map((s) =>
    UNSCALED_KINDS.includes(s.kind)
      ? s
      : { ...s, payload: { ...(s.payload ?? {}), emergencyClock: scale } },
  );
}

/** Terminal states other than PARKED open nothing; PARKED opens the annual review. */
export function isTerminalWithoutDeadline(status: ChallengeStatus): boolean {
  return (TERMINAL_STATES as readonly ChallengeStatus[]).includes(status) && status !== "PARKED";
}

/** What the reaper falls back to if an action leaves a challenge with no clock.
 *  Peacetime by design: the backstop guards invariant 1 (a clock exists), not
 *  urgency (how soon it fires), and the reaper passes the challenge's own scale
 *  through `deadlinesFor` when it can. */
export function fallbackDeadline(now: Date): DeadlineSpec {
  return { kind: "STAGE_TIMEOUT", dueAt: daysRaw(now, 30), payload: { reason: "invariant-1 backstop" } };
}
