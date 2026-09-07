/**
 * The client-safe half of the comments feature: the length cap and the view
 * types. `lib/comments.ts` (the writer and reader) is server-only because it
 * talks to the database; the discussion UI needs these constants without
 * pulling a Postgres pool into the browser bundle.
 */
import type { Role } from "@/lib/db/schema";

export const COMMENT_MAX_LENGTH = 1000;

export interface CommentView {
  id: string;
  parentId: string | null;
  authorName: string;
  authorRole: Role;
  content: string;
  createdAt: string; // ISO — serialised for the client component
  /** True when the signed-in viewer wrote this comment. */
  mine: boolean;
  replies: CommentView[];
}

/** How many comments + replies a challenge has, for the section heading. */
export function commentCount(tree: CommentView[]): number {
  return tree.reduce((n, c) => n + 1 + c.replies.length, 0);
}
