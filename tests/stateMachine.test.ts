/**
 * The state machine is the only writer of `challenges.status`. These tests run
 * against the real database, inside transactions that are always rolled back,
 * so they leave nothing behind. That matters more than usual here: rows in
 * `ledger_entries` cannot be deleted afterwards — the append-only trigger
 * refuses — so a test that committed would pollute the ledger permanently.
 */
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { challenges, ledgerEntries, outbox } = await import("@/lib/db/schema");
const {
  IllegalTransitionError,
  TERMINAL_STATES,
  TRANSITIONS,
  isTerminal,
  legalEdges,
  transition,
} = await import("@/lib/db/stateMachine");

type Status = keyof typeof TRANSITIONS;

/** Thrown to unwind a test transaction. Never escapes the helper. */
class Rollback extends Error {
  constructor(readonly inner?: unknown) {
    super("rollback");
  }
}

/** Run `fn` in a transaction and always roll it back. */
async function inRollback<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  let value: T | undefined;
  let failure: unknown;
  try {
    await db.transaction(async (tx) => {
      try {
        value = await fn(tx);
      } catch (e) {
        failure = e;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  if (failure) throw failure;
  return value as T;
}

/**
 * How long the legal-edge sweep may run before it is declared broken rather
 * than merely far away. The sweep is latency-bound, not compute-bound: each
 * edge pays the machine's serial round trips (row lock, status update, ledger
 * append under the global advisory lock, outbox, deadline rows) and there are
 * ~90 edges. That is well under a minute on a fast link to the database and
 * past the 180s default on a slow uplink, so the sweep carries the same
 * ceiling CI gives every test (vitest.config.ts) instead of whatever the
 * local default happens to be.
 */
const EDGE_SWEEP_TIMEOUT_MS = 600_000;

let counter = 0;

/** Insert a challenge already sitting in `status`, bypassing the machine on purpose. */
async function seedAt(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  status: Status,
): Promise<string> {
  counter += 1;
  const trackingId = `JH-TEST-${process.pid}-${counter}`;
  const [row] = await tx
    .insert(challenges)
    .values({
      trackingId,
      status,
      title: `state machine fixture ${counter}`,
      bodyOriginal: "fixture body, long enough to look like a real report from a citizen",
      bodyLang: "en",
    })
    .returning({ id: challenges.id });
  return row.id;
}

describe("state machine", () => {
  beforeAll(async () => {
    // Fail loudly rather than silently testing nothing.
    await db.execute(sql`SELECT 1`);
  });

  it("encodes a connected lifecycle with exactly six terminal states", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(
      ["CLOSED", "FORWARDED_EXTERNAL", "MERGED", "PARKED", "REJECTED_UNSAFE", "WITHDRAWN"].sort(),
    );
    for (const s of TERMINAL_STATES) {
      expect(TRANSITIONS[s], `${s} must have no outgoing edge`).toEqual([]);
    }
    // Every non-terminal state must lead somewhere, or a challenge could get stuck.
    for (const s of Object.keys(TRANSITIONS) as Status[]) {
      if (!isTerminal(s)) expect(TRANSITIONS[s].length, `${s} is a dead end`).toBeGreaterThan(0);
    }
    // No edge may point at a status that is not in the map.
    for (const [from, to] of legalEdges()) {
      expect(TRANSITIONS[to], `${from} -> ${to} targets an unknown status`).toBeDefined();
    }
  });

  it(
    "accepts every legal edge",
    async () => {
      const edges = legalEdges();
      expect(edges.length).toBeGreaterThan(0);

      await inRollback(async (tx) => {
        // One INSERT for every fixture: ~90 rows for ~90 edges. Seeding row by
        // row would cost a round trip per edge for zero extra assertion, and
        // on a high-latency link those trips are most of the test.
        const seeded = await tx
          .insert(challenges)
          .values(
            edges.map(([from], i) => ({
              trackingId: `JH-TEST-${process.pid}-edge-${i}`,
              status: from,
              title: `state machine fixture edge ${i}`,
              bodyOriginal: "fixture body, long enough to look like a real report from a citizen",
              bodyLang: "en",
            })),
          )
          .returning({ id: challenges.id, trackingId: challenges.trackingId });
        const idByTrackingId = new Map(seeded.map((r) => [r.trackingId, r.id]));

        const fixtures = edges.map(([from, to], i) => {
          const id = idByTrackingId.get(`JH-TEST-${process.pid}-edge-${i}`);
          if (!id) throw new Error(`bulk seed returned no row for edge ${from} -> ${to}`);
          return { from, to, id };
        });

        // The part under test. Still strictly serial, on this one transaction:
        // the ledger's transaction-scoped advisory lock is exactly what makes
        // the append safe, and it serialises appends across connections too.
        for (const { from, to, id } of fixtures) {
          const result = await transition(tx, { challengeId: id, to, actorId: null, reason: "test" });
          expect(result.from).toBe(from);
          expect(result.to).toBe(to);
        }

        // Every fixture is transitioned exactly once, so one batched read at
        // the end asserts precisely what the per-edge SELECT did — for one
        // round trip instead of ~90.
        const persisted = await tx
          .select({ id: challenges.id, status: challenges.status })
          .from(challenges)
          .where(inArray(challenges.id, fixtures.map((f) => f.id)));
        const persistedById = new Map(persisted.map((r) => [r.id, r.status]));
        expect(persistedById.size).toBe(fixtures.length);
        for (const { from, to, id } of fixtures) {
          expect(persistedById.get(id), `${from} -> ${to} did not persist`).toBe(to);
        }
      });
    },
    EDGE_SWEEP_TIMEOUT_MS,
  );

  it("refuses a representative illegal edge", async () => {
    await inRollback(async (tx) => {
      const id = await seedAt(tx, "SUBMITTED");
      // Skipping the whole pipeline from intake straight to implementation.
      await expect(transition(tx, { challengeId: id, to: "IMPLEMENTED" })).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );
    });
  });

  it("refuses every outgoing edge from a terminal state", async () => {
    const everyStatus = Object.keys(TRANSITIONS) as Status[];
    await inRollback(async (tx) => {
      for (const terminal of TERMINAL_STATES) {
        const id = await seedAt(tx, terminal);
        for (const to of everyStatus) {
          await expect(
            transition(tx, { challengeId: id, to }),
            `${terminal} -> ${to} should be refused`,
          ).rejects.toBeInstanceOf(IllegalTransitionError);
        }
      }
    });
  });

  it("writes the status, the ledger entry and the outbox event together", async () => {
    await inRollback(async (tx) => {
      const id = await seedAt(tx, "SUBMITTED");
      const result = await transition(tx, { challengeId: id, to: "TRIAGED", reason: "looks real" });

      const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.challengeId, id));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("STATE_CHANGE");
      expect(entries[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entries[0].id).toBe(result.ledgerEntryId);
      // Phase 3 Task 3.4 links the chain inside this same transaction rather
      // than backfilling it afterwards. A 64-character prev_hash here is the
      // evidence that appendEntry ran on THIS transaction and not on a second
      // connection that could have committed while the state change rolled back.
      expect(entries[0].prevHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entries[0].entryHash).toMatch(/^[0-9a-f]{64}$/);

      const events = await tx
        .select()
        .from(outbox)
        .where(sql`${outbox.payload} ->> 'challengeId' = ${id}`);
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe("challenge.status_changed");
    });
  });

  it("is atomic: an error after the update leaves nothing written", async () => {
    // Commit a challenge so we can observe it after the failed transaction.
    const id = await db.transaction(async (tx) => seedAt(tx, "SUBMITTED"));

    const boom = new Error("simulated failure after the status update");
    await expect(
      db.transaction(async (tx) => {
        await transition(tx, { challengeId: id, to: "TRIAGED" });
        throw boom;
      }),
    ).rejects.toBe(boom);

    const [after] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, id));
    expect(after.status, "the status update must have rolled back").toBe("SUBMITTED");

    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.challengeId, id));
    expect(entries, "the ledger append must have rolled back").toHaveLength(0);

    const events = await db
      .select()
      .from(outbox)
      .where(sql`${outbox.payload} ->> 'challengeId' = ${id}`);
    expect(events, "the outbox event must have rolled back").toHaveLength(0);

    // This challenge has no ledger rows, so it can be removed.
    await db.delete(challenges).where(eq(challenges.id, id));
  });
});
