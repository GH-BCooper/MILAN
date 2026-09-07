/**
 * The discussion layer, against the real database inside always-rolled-back
 * transactions — the same discipline as tests/stateMachine.test.ts, and for
 * the same reason: nothing here may leave rows behind.
 *
 * What is deliberately NOT covered: the rate-limit counter, which reads the
 * committed audit_log (that is the point of it — a rolled-back comment must
 * not still count) and so cannot be exercised inside a rollback test. The
 * counter shares the proven challenge.submitted pattern.
 */
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { challenges, challengeComments, user, userProfiles } = await import("@/lib/db/schema");
const {
  CommentRejectedError,
  insertComment,
  listComments,
} = await import("@/lib/comments");

class Rollback extends Error {}

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

let counter = 0;

/** A signed-in author with a Milan profile (full name + role). */
async function seedUser(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) {
  counter += 1;
  const id = `test-commenter-${process.pid}-${counter}`;
  await tx.insert(user).values({ id, name, email: `${id}@example.invalid` });
  await tx.insert(userProfiles).values({ userId: id, fullName: name });
  return id;
}

/** A challenge, inserted directly like the state-machine fixtures. */
async function seedChallenge(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  counter += 1;
  const [row] = await tx
    .insert(challenges)
    .values({
      trackingId: `JH-TEST-COM-${process.pid}-${counter}`,
      title: `comments fixture ${counter}`,
      bodyOriginal: "fixture body, long enough to look like a real report from a citizen",
      bodyLang: "en",
    })
    .returning({ id: challenges.id });
  return row.id;
}

describe("comments", () => {
  beforeAll(async () => {
    await db.execute(sql`SELECT 1`);
  });

  it("posts a top-level comment and lists it with the author's name and role", async () => {
    await inRollback(async (tx) => {
      const authorId = await seedUser(tx, "Sunita Oraon");
      const challengeId = await seedChallenge(tx);

      await insertComment(tx, { challengeId, userId: authorId, content: "  I saw this crack myself in June.  " });

      const tree = await listComments(tx, { challengeId, viewerId: authorId });
      expect(tree).toHaveLength(1);
      expect(tree[0].authorName).toBe("Sunita Oraon");
      expect(tree[0].authorRole).toBe("CITIZEN");
      expect(tree[0].content).toBe("I saw this crack myself in June."); // trimmed on write
      expect(tree[0].mine).toBe(true);
      expect(tree[0].replies).toHaveLength(0);

      const outsider = await listComments(tx, { challengeId, viewerId: null });
      expect(outsider[0].mine).toBe(false);
    });
  });

  it("threads a reply under its parent, one level", async () => {
    await inRollback(async (tx) => {
      const a = await seedUser(tx, "First Voice");
      const b = await seedUser(tx, "Second Voice");
      const challengeId = await seedChallenge(tx);

      const rootId = await insertComment(tx, { challengeId, userId: a, content: "Root." });
      await insertComment(tx, { challengeId, userId: b, content: "Reply.", parentCommentId: rootId });

      const tree = await listComments(tx, { challengeId });
      expect(tree).toHaveLength(1);
      expect(tree[0].replies).toHaveLength(1);
      expect(tree[0].replies[0].authorName).toBe("Second Voice");
      expect(tree[0].replies[0].parentId).toBe(rootId);
    });
  });

  it("refuses a reply to a reply", async () => {
    await inRollback(async (tx) => {
      const a = await seedUser(tx, "Nester One");
      const challengeId = await seedChallenge(tx);

      const rootId = await insertComment(tx, { challengeId, userId: a, content: "Root." });
      const replyId = await insertComment(tx, {
        challengeId,
        userId: a,
        content: "Reply.",
        parentCommentId: rootId,
      });

      await expect(
        insertComment(tx, { challengeId, userId: a, content: "Too deep.", parentCommentId: replyId }),
      ).rejects.toBeInstanceOf(CommentRejectedError);
    });
  });

  it("refuses a reply whose parent belongs to a different challenge", async () => {
    await inRollback(async (tx) => {
      const a = await seedUser(tx, "Cross Poster");
      const first = await seedChallenge(tx);
      const second = await seedChallenge(tx);

      const rootId = await insertComment(tx, { challengeId: first, userId: a, content: "Root." });

      await expect(
        insertComment(tx, { challengeId: second, userId: a, content: "Wrong room.", parentCommentId: rootId }),
      ).rejects.toBeInstanceOf(CommentRejectedError);
    });
  });

  it("refuses empty and over-length content", async () => {
    await inRollback(async (tx) => {
      const a = await seedUser(tx, "Length Tester");
      const challengeId = await seedChallenge(tx);

      await expect(
        insertComment(tx, { challengeId, userId: a, content: "   " }),
      ).rejects.toBeInstanceOf(CommentRejectedError);

      await expect(
        insertComment(tx, { challengeId, userId: a, content: "x".repeat(1001) }),
      ).rejects.toBeInstanceOf(CommentRejectedError);
    });
  });

  it("cascades with the challenge: deleting the report removes its discussion", async () => {
    await inRollback(async (tx) => {
      const a = await seedUser(tx, "Cascade Proof");
      const challengeId = await seedChallenge(tx);
      await insertComment(tx, { challengeId, userId: a, content: "This should go with the report." });

      await tx.delete(challenges).where(eq(challenges.id, challengeId));

      const left = await tx
        .select({ id: challengeComments.id })
        .from(challengeComments)
        .where(eq(challengeComments.challengeId, challengeId));
      expect(left).toHaveLength(0);
    });
  });
});
