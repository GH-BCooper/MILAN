"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { decideAccessAction, markPublishedAction, publishArtifactAction, type PublishState } from "./artifact-actions";

export interface ArtifactView {
  id: string;
  title: string;
  abstract: string | null;
  kind: string;
  licence: "CC_BY" | "RESTRICTED";
  contentHash: string | null;
  publishedAt: string | null;
}

export interface AccessRequestView {
  id: string;
  artifactTitle: string;
  requesterName: string;
  orgName: string | null;
  purpose: string;
  state: string;
  createdAt: string;
}

/**
 * The publish form.
 *
 * The licence radio carries its consequences beside it in plain words. A student
 * choosing RESTRICTED because it sounds safer, without being told that it means
 * every reader has to ask their supervisor by name, is a student who has not
 * really chosen.
 */
export function PublishForm({ projectId, canMarkPublished }: { projectId: string; canMarkPublished: boolean }) {
  const [state, action, pending] = useActionState<PublishState | null, FormData>(publishArtifactAction, null);
  const [mark, markAction, marking] = useActionState<PublishState | null, FormData>(markPublishedAction, null);
  const [licence, setLicence] = useState<"CC_BY" | "RESTRICTED">("CC_BY");

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Publish an artifact</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The file is stored under the SHA-256 of its own bytes, and that hash goes into the append-only
        ledger. Upload the same file twice and it is one object — the same hash, the same key. That is
        what lets anyone holding the file prove it is the file this project published.
      </p>

      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="kind" value="REPORT" />

        <div>
          <label className="block text-xs font-medium" htmlFor="artifact-title">
            Title — always public, whatever licence you choose
          </label>
          <input
            id="artifact-title"
            name="title"
            required
            minLength={5}
            className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium" htmlFor="artifact-abstract">
            Abstract — always public, whatever licence you choose
          </label>
          <textarea
            id="artifact-abstract"
            name="abstract"
            required
            minLength={20}
            rows={4}
            className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium" htmlFor="artifact-file">
            File (optional, up to 25 MB)
          </label>
          <input id="artifact-file" name="file" type="file" className="mt-1 block w-full text-sm" />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Licence — this is permanent for everybody downstream</legend>

          <label className={`block rounded-md border p-3 ${licence === "CC_BY" ? "border-emerald-400 bg-emerald-50" : "border-input"}`}>
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="licence"
                value="CC_BY"
                checked={licence === "CC_BY"}
                onChange={() => setLicence("CC_BY")}
              />
              <span className="text-sm font-semibold">CC-BY — anyone may use it, if they credit you</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Anyone can download the file, build on it and sell what they build, as long as they name
              you. You cannot withdraw this later. It is the choice that gets your work used.
            </span>
          </label>

          <label className={`block rounded-md border p-3 ${licence === "RESTRICTED" ? "border-amber-400 bg-amber-50" : "border-input"}`}>
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="licence"
                value="RESTRICTED"
                checked={licence === "RESTRICTED"}
                onChange={() => setLicence("RESTRICTED")}
              />
              <span className="text-sm font-semibold">Restricted — the file is behind a request</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              The title, the problem and this abstract stay public — always, and we will not let you
              hide them, because hiding them would make a citizen&rsquo;s problem disappear. What is
              restricted is the file: a named person from a named organisation asks you, with a stated
              purpose, and every download they make is logged where you and the citizen can both see it.
            </span>
          </label>
        </fieldset>

        <button
          disabled={pending}
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Publishing…" : "Publish"}
        </button>

        {state ? (
          <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
            {state.message}
            {state.ok && state.artifactId ? (
              <>
                {" "}
                <Link href={`/artifacts/${state.artifactId}`} className="underline underline-offset-4">
                  open the artifact page
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </form>

      {canMarkPublished ? (
        <form action={markAction} className="mt-4 border-t border-border pt-3">
          <input type="hidden" name="projectId" value={projectId} />
          <button
            disabled={marking}
            className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50"
          >
            Mark the challenge as SOLUTION_PUBLISHED
          </button>
          {mark ? (
            <p className={`mt-2 text-sm ${mark.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
              {mark.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

/** The lead's queue of people asking to read a restricted artifact. */
export function AccessRequests({ requests }: { requests: AccessRequestView[] }) {
  const [state, action, pending] = useActionState<PublishState | null, FormData>(decideAccessAction, null);

  if (requests.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
        Nobody has asked to read a restricted artifact on this project. Requests appear here with the
        requester&rsquo;s name, organisation and stated purpose.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">
            {r.requesterName}
            {r.orgName ? <span className="font-normal text-muted-foreground"> · {r.orgName}</span> : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            wants &ldquo;{r.artifactTitle}&rdquo; · asked {r.createdAt.slice(0, 10)} ·{" "}
            <span className="font-medium">{r.state.toLowerCase()}</span>
          </p>
          <p className="mt-2 rounded bg-muted p-2 text-sm">{r.purpose}</p>
          {r.state === "PENDING" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                name="requestId"
                value={r.id}
                formAction={action}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (form) (form.elements.namedItem("decision") as HTMLInputElement).value = "GRANT";
                }}
                disabled={pending}
                className="inline-flex h-11 items-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Grant access
              </button>
              <button
                name="requestId"
                value={r.id}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (form) (form.elements.namedItem("decision") as HTMLInputElement).value = "DENY";
                }}
                disabled={pending}
                className="inline-flex h-11 items-center rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          ) : null}
        </div>
      ))}
      <input type="hidden" name="decision" defaultValue="GRANT" />
      {state ? (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
