/**
 * The only writer of `challenges.status` in the codebase.
 *
 * A hand-written `UPDATE challenges SET status = ...` anywhere else is a bug.
 * The point of a state machine is that "what happens next" is a property of the
 * data, not of somebody remembering: Phase 3's SLA engine can attach a deadline
 * to every non-terminal state only because the set of states is finite, explicit
 * and enumerated here.
 *
 * One transaction per state change. The status update, the ledger append, the
 * outbox event and the SLA deadline rows are all written together or not at all.
 * Without that, the ledger can disagree with the challenge table and the whole
 * provenance claim collapses.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { appendEntry } from "@/lib/ledger/append";
import { deadlinesFor } from "@/lib/sla/deadlines";
import type { Tx } from "./index";
import {
  challenges,
  outbox,
  slaDeadlines,
  type ChallengeStatus,
} from "./schema";

/* -------------------------------------------------------------- the table */

/**
 * The lifecycle from PHASE_1_LEARN.md section 4, plus its branches.
 *
 * Reading the happy path down the left:
 *   SUBMITTED -> TRIAGED -> CLASSIFIED -> CLUSTERED -> PRIORITISED -> VERIFIED
 *   -> ROUTED -> CLAIMED -> PROPOSAL_APPROVED -> IN_RESEARCH -> SOLUTION_PUBLISHED
 *   -> INDUSTRY_INTEREST -> IMPLEMENTED -> CITIZEN_VERIFIED -> CLOSED
 *
 * Everything else is a branch off that spine. Three states are in the enum with
 * no UI this cut (AGREEMENT_SIGNED, PILOT, DISPUTED) but they are wired here so
 * that adding the UI later is additive.
 */
export const TRANSITIONS: Record<ChallengeStatus, ChallengeStatus[]> = {
  // Intake. S1 triages: safe/unsafe, problem/grievance, enough detail or not.
  SUBMITTED: ["TRIAGED", "REJECTED_UNSAFE", "FORWARDED_EXTERNAL", "NEEDS_MORE_INFO", "WITHDRAWN"],
  // The citizen answered the follow-up, or withdrew.
  NEEDS_MORE_INFO: ["TRIAGED", "SUBMITTED", "WITHDRAWN", "PARKED"],
  TRIAGED: ["CLASSIFIED", "REJECTED_UNSAFE", "FORWARDED_EXTERNAL", "NEEDS_MORE_INFO", "WITHDRAWN"],
  // Duplicates are signal: clustering can merge this into a parent instead.
  CLASSIFIED: ["CLUSTERED", "MERGED", "NEEDS_MORE_INFO", "WITHDRAWN"],
  CLUSTERED: ["PRIORITISED", "MERGED", "WITHDRAWN"],
  // severity >= 0.7 waits at /gov/gate for a human before it can be VERIFIED.
  PRIORITISED: ["VERIFIED", "PARKED", "REJECTED_UNSAFE", "FORWARDED_EXTERNAL", "MERGED", "WITHDRAWN"],
  VERIFIED: ["ROUTED", "PARKED", "BOUNTY_LISTED", "WITHDRAWN"],
  // Nobody claimed it inside the window: widen, then open to all, then escalate.
  ROUTED: ["CLAIMED", "UNCLAIMED_ESCALATED", "PARKED", "WITHDRAWN"],
  UNCLAIMED_ESCALATED: ["ROUTED", "CLAIMED", "BOUNTY_LISTED", "PARKED", "WITHDRAWN"],
  // A bounty is the last resort before parking: money, or a grand challenge.
  BOUNTY_LISTED: ["CLAIMED", "PARKED", "WITHDRAWN"],
  CLAIMED: ["PROPOSAL_APPROVED", "AT_RISK", "ROUTED", "WITHDRAWN"],
  PROPOSAL_APPROVED: ["IN_RESEARCH", "AT_RISK", "WITHDRAWN"],
  IN_RESEARCH: ["SOLUTION_PUBLISHED", "AT_RISK", "FORKED", "WITHDRAWN"],
  // A team went silent. It can recover, be forked to another team, or go back out.
  AT_RISK: ["IN_RESEARCH", "SOLUTION_PUBLISHED", "FORKED", "ROUTED", "PARKED", "WITHDRAWN"],
  // Forked: the original team keeps its credit edges, a new team carries on.
  FORKED: ["CLAIMED", "IN_RESEARCH", "ROUTED", "PARKED", "WITHDRAWN"],
  SOLUTION_PUBLISHED: ["INDUSTRY_INTEREST", "IMPLEMENTED", "PARKED", "CLOSED", "DISPUTED"],
  INDUSTRY_INTEREST: ["AGREEMENT_SIGNED", "IMPLEMENTED", "SOLUTION_PUBLISHED", "PARKED", "DISPUTED"],
  AGREEMENT_SIGNED: ["PILOT", "IMPLEMENTED", "DISPUTED", "PARKED"],
  PILOT: ["IMPLEMENTED", "DISPUTED", "PARKED"],
  // Invariant 7: the impact counter moves at CITIZEN_VERIFIED and nowhere else.
  // An implementer's claim is not a confirmation, so IMPLEMENTED is not terminal.
  IMPLEMENTED: ["CITIZEN_VERIFIED", "DISPUTED", "AT_RISK", "PARKED"],
  CITIZEN_VERIFIED: ["CLOSED", "DISPUTED"],
  DISPUTED: ["SOLUTION_PUBLISHED", "IMPLEMENTED", "IN_RESEARCH", "PARKED", "CLOSED"],

  // Terminal states. No outgoing edges.
  CLOSED: [],
  MERGED: [],
  FORWARDED_EXTERNAL: [],
  WITHDRAWN: [],
  REJECTED_UNSAFE: [],
  // PARKED is terminal for routing purposes, but it carries an automatic annual
  // re-review deadline (sla_kind ANNUAL_REVIEW) that puts it back in play. The
  // re-entry is performed by the reaper creating a new challenge revision, not
  // by an outgoing edge, which is why this list is empty. See invariant 1.
  PARKED: [],
};

/** CLAUDE.md invariant 1. Exactly these six, and no others. */
export const TERMINAL_STATES = [
  "CLOSED",
  "MERGED",
  "FORWARDED_EXTERNAL",
  "WITHDRAWN",
  "REJECTED_UNSAFE",
  "PARKED",
] as const satisfies readonly ChallengeStatus[];

export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminal(status: ChallengeStatus): status is TerminalState {
  return (TERMINAL_STATES as readonly ChallengeStatus[]).includes(status);
}

export function canTransition(from: ChallengeStatus, to: ChallengeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Every legal edge in the machine, for tests and for the /admin state graph. */
export function legalEdges(): Array<[ChallengeStatus, ChallengeStatus]> {
  return (Object.keys(TRANSITIONS) as ChallengeStatus[]).flatMap((from) =>
    TRANSITIONS[from].map((to) => [from, to] as [ChallengeStatus, ChallengeStatus]),
  );
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: ChallengeStatus,
    readonly to: ChallengeStatus,
    readonly challengeId: string,
  ) {
    super(
      `Illegal transition ${from} -> ${to} for challenge ${challengeId}. ` +
        `Legal targets from ${from}: ${TRANSITIONS[from].join(", ") || "(none — terminal state)"}`,
    );
    this.name = "IllegalTransitionError";
  }
}

export class ChallengeNotFoundError extends Error {
  constructor(readonly challengeId: string) {
    super(`Challenge ${challengeId} does not exist.`);
    this.name = "ChallengeNotFoundError";
  }
}

/* ------------------------------------------------------------- deadlines */

/**
 * Which SLA deadlines a state opens, and which it closes.
 *
 * Phase 3 Task 3.2 filled the hook Phase 1 stubbed. The table itself lives in
 * `lib/sla/deadlines.ts`, which is pure and separately tested; this file's job
 * is to write the rows inside the caller's transaction so that a state change,
 * its ledger append, its deadlines and its outbox event are one atomic fact.
 */
export type { DeadlineSpec } from "@/lib/sla/deadlines";

/* ------------------------------------------------------------ the writer */

export interface TransitionInput {
  challengeId: string;
  to: ChallengeStatus;
  /** Passed through to `deadlinesFor` — the SILENT ladders are measured from it. */
  projectId?: string | null;
  lastActivityAt?: Date | null;
  actorId?: string | null;
  /** Mandatory for a human override; recorded in the ledger payload either way. */
  reason?: string | null;
  meta?: Record<string, unknown>;
}

export interface TransitionResult {
  challengeId: string;
  trackingId: string;
  from: ChallengeStatus;
  to: ChallengeStatus;
  at: Date;
  ledgerEntryId: string;
  deadlinesOpened: number;
  deadlinesCancelled: number;
}

/** SHA-256 of the canonical JSON of an entry's content. Invariant 2. */
export function contentHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Move a challenge to a new state.
 *
 * Must be called inside a transaction (`db.transaction(async (tx) => ...)`).
 * The caller owns the transaction so that a state change can be bundled with
 * whatever else the same action writes — media rows, credit edges, a project.
 */
export async function transition(tx: Tx, input: TransitionInput): Promise<TransitionResult> {
  const { challengeId, to, actorId = null, reason = null, meta = {} } = input;

  // Lock the row. Two reapers firing on the same challenge in the same minute is
  // not hypothetical: Vercel Cron can overlap runs.
  const [row] = await tx
    .select({ id: challenges.id, trackingId: challenges.trackingId, status: challenges.status })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .for("update");

  if (!row) throw new ChallengeNotFoundError(challengeId);

  const from = row.status;
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to, challengeId);

  const at = clockNow();

  await tx.update(challenges).set({ status: to, updatedAt: at }).where(eq(challenges.id, challengeId));

  // The ledger append, chain-linked inside this same transaction (Task 3.4).
  const payload = { from, to, reason, actorId, trackingId: row.trackingId, at: at.toISOString(), ...meta };
  const entry = await appendEntry(tx, {
    challengeId,
    projectId: input.projectId ?? null,
    kind: "STATE_CHANGE",
    authorId: actorId,
    payload,
    at,
  });

  await tx.insert(outbox).values({
    topic: "challenge.status_changed",
    payload: { challengeId, trackingId: row.trackingId, from, to, actorId, at: at.toISOString() },
    createdAt: at,
  });

  // Deadlines that belonged to the state we just left no longer apply. Cancel
  // before opening, so that a self-edge does not cancel what it just created.
  const cancelled = await tx
    .update(slaDeadlines)
    .set({ cancelledAt: at })
    .where(
      and(
        eq(slaDeadlines.challengeId, challengeId),
        isNull(slaDeadlines.firedAt),
        isNull(slaDeadlines.cancelledAt),
      ),
    )
    .returning({ id: slaDeadlines.id });

  const specs = deadlinesFor(to, {
    now: at,
    projectId: input.projectId ?? null,
    lastActivityAt: input.lastActivityAt ?? null,
  });
  if (specs.length > 0) {
    await tx.insert(slaDeadlines).values(
      specs.map((s) => ({
        challengeId,
        projectId: s.projectId ?? input.projectId ?? null,
        kind: s.kind,
        dueAt: s.dueAt,
        payload: s.payload ?? {},
        createdAt: at,
      })),
    );
  }

  return {
    challengeId,
    trackingId: row.trackingId,
    from,
    to,
    at,
    ledgerEntryId: entry.id,
    deadlinesOpened: specs.length,
    deadlinesCancelled: cancelled.length,
  };
}

/** Count of challenges in a non-terminal state with no open deadline — invariant 1. */
export const INVARIANT_ORPHAN_QUERY = sql`
  SELECT count(*)::int AS n
  FROM challenges c
  WHERE c.status NOT IN (${sql.join(
    TERMINAL_STATES.map((s) => sql`${s}`),
    sql`, `,
  )})
    AND NOT EXISTS (
      SELECT 1 FROM sla_deadlines d
      WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL
    )
`;
