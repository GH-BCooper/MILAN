"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { MessageSquare } from "lucide-react";

import { postCommentAction } from "@/app/(public)/c/[trackingId]/actions";
import { COMMENT_MAX_LENGTH, type CommentView } from "@/lib/comments-shared";
import type { Role } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";

/** What the role chip says. Words, not enum names — this is a public page. */
const ROLE_LABEL: Record<Role, string> = {
  CITIZEN: "citizen",
  HEI_MEMBER: "university",
  INDUSTRY: "industry",
  GOVERNMENT: "officer",
  ADMIN: "admin",
  ASSISTED_SUBMITTER: "assisted reporter",
  INDEPENDENT_INNOVATOR: "innovator",
  EXPERT_PANEL: "expert panel",
};

/** en-IN, and never the visitor's locale — a date reads the same on every screen. */
function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function OneComment({ comment, depth }: { comment: CommentView; depth: 0 | 1 }) {
  return (
    <li className={depth === 1 ? "ms-6 border-s border-border ps-4" : ""}>
      <article className="py-3">
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">
            {comment.authorName}
            {comment.mine ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
          </span>
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {ROLE_LABEL[comment.authorRole]}
          </span>
          <time dateTime={comment.createdAt} className="text-xs text-muted-foreground">
            {formatWhen(comment.createdAt)}
          </time>
        </header>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{comment.content}</p>
      </article>
    </li>
  );
}

export function ChallengeComments({
  trackingId,
  comments,
  signedIn,
}: {
  trackingId: string;
  comments: CommentView[];
  signedIn: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function post() {
    setPending(true);
    setMessage(null);
    const result = await postCommentAction({
      trackingId,
      content,
      parentCommentId: replyTo?.id ?? null,
    });
    setPending(false);
    if (result.ok) {
      setContent("");
      setReplyTo(null);
      setMessage("Posted. Thank you — a comment carries your name on this page.");
      router.refresh();
    } else {
      setMessage(result.error);
    }
  }

  return (
    <div>
      {comments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No discussion yet. Reporting and confirming need no account; if you have something to add
          — what you saw, what worked elsewhere, a question for the reporter — sign in and write it.
          It will carry your name.
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-border" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id}>
              <OneComment comment={c} depth={0} />
              <div className="-mt-1 pb-2">
                {signedIn ? (
                  <button
                    type="button"
                    className="text-xs text-primary underline underline-offset-2"
                    onClick={() =>
                      setReplyTo((current) =>
                        current?.id === c.id ? null : { id: c.id, author: c.authorName },
                      )
                    }
                  >
                    {replyTo?.id === c.id ? "Cancel reply" : "Reply"}
                  </button>
                ) : null}
              </div>
              {c.replies.length > 0 ? (
                <ol aria-label={`Replies to ${c.authorName}`}>
                  {c.replies.map((r) => (
                    <OneComment key={r.id} comment={r} depth={1} />
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {signedIn ? (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          {replyTo ? (
            <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              Replying to {replyTo.author}. Replies go one level deep — reply to the top comment.
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => setReplyTo(null)}
              >
                stop replying
              </button>
            </p>
          ) : null}
          <label htmlFor="comment-box" className="text-sm font-medium">
            Add to the discussion
          </label>
          <textarea
            id="comment-box"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={COMMENT_MAX_LENGTH}
            required
            className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            placeholder="What you saw, what worked elsewhere, a question for the reporter…"
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {content.length}/{COMMENT_MAX_LENGTH}
            </p>
            <Button type="submit" disabled={pending || content.trim().length === 0}>
              <MessageSquare aria-hidden className="size-4" />
              {pending ? "Posting…" : replyTo ? "Post reply" : "Post comment"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link
            href={`/login?next=${encodeURIComponent(`/c/${trackingId}`)}`}
            className="text-primary underline underline-offset-4"
          >
            Sign in
          </Link>{" "}
          to join the discussion. Reporting and corroborating need no account; a comment carries
          your name.
        </p>
      )}

      {message ? (
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
