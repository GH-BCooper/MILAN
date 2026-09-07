import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import type { Db, Tx } from "@/lib/db";
import { challengeComments, userProfiles, user } from "@/lib/db/schema";
import { COMMENT_MAX_LENGTH, commentCount, type CommentView } from "./comments-shared";

export { COMMENT_MAX_LENGTH, commentCount };
export type { CommentView };

/**
 * Comments on a public challenge.
 *
 * Deliberately held to three rules, each of which is a documented decision
 * rather than a default:
 *
 *  1. Signed-in only. Anonymous discussion is the brigading vector LOOPHOLES
 *     row 7 warns about; the anonymous channel is corroboration, which is one
 *     tap and carries weight, not words.
 *  2. One nesting level. Deep threads reward winning the argument; a flat
 *     list with replies keeps the page a work surface for the challenge.
 *  3. No edits and no deletes this cut. What you write is what the page shows.
 *     Ephemeral discussion systems encourage hit-and-run posting; a permanent
 *     public comment attached to your name is a mild but real reputation
 *     stake, which is the same argument as the trust score.
 */

export class CommentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentRejectedError";
  }
}

export interface PostCommentInput {
  challengeId: string;
  userId: string;
  content: string;
  parentCommentId?: string | null;
}

/** Insert one comment. Validates everything the schema cannot express. */
export async function insertComment(tx: Tx, input: PostCommentInput): Promise<string> {
  const content = input.content.trim();
  if (content.length === 0) {
    throw new CommentRejectedError("Write something first.");
  }
  if (content.length > COMMENT_MAX_LENGTH) {
    throw new CommentRejectedError(
      `Keep it under ${COMMENT_MAX_LENGTH} characters — this is a discussion, not a report.`,
    );
  }

  if (input.parentCommentId) {
    const [parent] = await tx
      .select({
        id: challengeComments.id,
        challengeId: challengeComments.challengeId,
        parentCommentId: challengeComments.parentCommentId,
      })
      .from(challengeComments)
      .where(eq(challengeComments.id, input.parentCommentId))
      .limit(1);

    if (!parent || parent.challengeId !== input.challengeId) {
      // Replying across challenges would stitch two discussions together.
      throw new CommentRejectedError("The comment you are replying to is not on this report.");
    }
    if (parent.parentCommentId) {
      throw new CommentRejectedError("Replies go one level deep. Reply to the top-level comment.");
    }
  }

  const [row] = await tx
    .insert(challengeComments)
    .values({
      challengeId: input.challengeId,
      userId: input.userId,
      parentCommentId: input.parentCommentId ?? null,
      content,
      createdAt: clockNow(),
    })
    .returning({ id: challengeComments.id });

  return row.id;
}

/**
 * The discussion under a challenge, as a one-level tree in posting order.
 * The display name is the Milan profile's full name, falling back to the
 * auth account name so a comment is never authored by "undefined".
 *
 * Takes Db or a transaction: the page passes the pool, tests pass the
 * rollback transaction they are observing from inside of.
 */
export async function listComments(
  db: Db | Tx,
  args: { challengeId: string; viewerId?: string | null },
): Promise<CommentView[]> {
  const rows = await db
    .select({
      id: challengeComments.id,
      parentId: challengeComments.parentCommentId,
      content: challengeComments.content,
      createdAt: challengeComments.createdAt,
      authorName: sql<string>`coalesce(${userProfiles.fullName}, ${user.name})`,
      authorRole: userProfiles.role,
      authorId: challengeComments.userId,
    })
    .from(challengeComments)
    .innerJoin(user, eq(user.id, challengeComments.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, challengeComments.userId))
    .where(eq(challengeComments.challengeId, args.challengeId))
    .orderBy(asc(challengeComments.createdAt));

  const flat: CommentView[] = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    authorName: r.authorName ?? "Milan member",
    authorRole: r.authorRole ?? "CITIZEN",
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    mine: args.viewerId != null && r.authorId === args.viewerId,
    replies: [],
  }));

  const top: CommentView[] = [];
  const byId = new Map(flat.map((c) => [c.id, c]));
  for (const c of flat) {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (parent && !parent.parentId) parent.replies.push(c);
    else top.push(c); // a reply whose root was removed displays as top-level
  }
  return top;
}
