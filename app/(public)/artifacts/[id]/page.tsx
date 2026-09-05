import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { currentUser } from "@/lib/auth/guards";
import { mayDownload } from "@/lib/artifacts/publish";
import { execRaw } from "@/lib/db/raw";
import { latestAnchor } from "@/lib/ledger/anchor";
import { RequestAccessForm } from "./request-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Artifact" };

/**
 * The artifact page.
 *
 * Title, problem and abstract are public whatever the licence — that is enforced
 * here by simply not gating them, and stated on the page so nobody has to take
 * it on trust.
 *
 * The prior-art panel is the on-screen answer to loophole row 11: "a firm
 * patents the student's work". A defensive publication with a timestamp and a
 * content hash does not stop a patent being filed; it makes the work prior art,
 * which is what stops the patent being granted over it. The panel says exactly
 * that, and says which parts are attested by a third party and which are not.
 */
interface Row extends Record<string, unknown> {
  id: string;
  title: string;
  abstract: string | null;
  kind: string;
  licence: string;
  content_hash: string | null;
  storage_key: string | null;
  published_at: string | null;
  project_id: string;
  project_title: string;
  org_name: string;
  tracking_id: string;
  challenge_title: string;
  ledger_seq: number | null;
  ledger_at: string | null;
}

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();

  const rows = await execRaw<Row>(sql`
    SELECT a.id, a.title, a.abstract, a.kind, a.licence::text AS licence,
           a.content_hash, a.storage_key, a.published_at::text AS published_at,
           p.id AS project_id, p.title AS project_title, o.name AS org_name,
           c.tracking_id, c.title AS challenge_title,
           (SELECT e.seq FROM ledger_entries e
             WHERE e.kind = 'REPORT' AND e.payload->>'artifactId' = a.id::text
             ORDER BY e.seq LIMIT 1) AS ledger_seq,
           (SELECT e.created_at::text FROM ledger_entries e
             WHERE e.kind = 'REPORT' AND e.payload->>'artifactId' = a.id::text
             ORDER BY e.seq LIMIT 1) AS ledger_at
    FROM artifacts a
    JOIN projects p ON p.id = a.project_id
    JOIN organization o ON o.id = p.org_id
    JOIN challenges c ON c.id = p.challenge_id
    WHERE a.id = ${id}
    LIMIT 1
  `);
  if (rows.length === 0) notFound();
  const a = rows[0];

  const [access, anchor, dedup, log] = await Promise.all([
    mayDownload(a.id, user?.id ?? null),
    latestAnchor(),
    // Same bytes, published more than once. Shown rather than hidden: it is the
    // content-hash keying doing its job.
    a.content_hash
      ? execRaw<{ n: number }>(sql`SELECT count(*)::int AS n FROM artifacts WHERE content_hash = ${a.content_hash}`)
      : Promise.resolve([{ n: 1 }]),
    execRaw<{ full_name: string | null; org_name: string | null; purpose: string | null; created_at: string }>(sql`
      SELECT p.full_name, o.name AS org_name, l.purpose, l.created_at::text AS created_at
      FROM access_log l
      LEFT JOIN user_profiles p ON p.user_id = l.user_id
      LEFT JOIN organization o ON o.id = l.org_id
      WHERE l.artifact_id = ${id}
      ORDER BY l.created_at DESC
      LIMIT 50
    `),
  ]);

  const restricted = a.licence === "RESTRICTED";
  const copies = Number((dedup as Array<{ n: number }>)[0]?.n ?? 1);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {a.kind.toLowerCase()} · {restricted ? "Restricted" : "CC-BY"}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{a.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {a.org_name} · answering{" "}
          <Link href={`/c/${a.tracking_id}`} className="text-primary underline underline-offset-4">
            {a.tracking_id} — {a.challenge_title}
          </Link>
        </p>

        {/* Always public. Not gated, whatever the licence. */}
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Abstract</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{a.abstract}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The title, the problem and this abstract are public regardless of licence. A restricted
            licence restricts the file, never the knowledge that this work exists.
          </p>
        </section>

        {/* The prior-art panel — the answer to "a firm patents the student's work". */}
        <section className="mt-6 rounded-lg border border-border bg-muted p-4">
          <h2 className="text-sm font-semibold">Prior art</h2>
          <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Published</dt>
              <dd>{a.published_at?.slice(0, 19).replace(" ", " at ") ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Ledger entry</dt>
              <dd>
                {a.ledger_seq ? (
                  <Link href={`/ledger?c=${a.tracking_id}`} className="text-primary underline underline-offset-4">
                    #{a.ledger_seq}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold">Content hash (SHA-256 of the file&rsquo;s bytes)</dt>
              <dd className="break-all font-mono">{a.content_hash ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold">Anchor</dt>
              <dd>
                {anchor
                  ? `Chain head anchored at entry ${anchor.seq} on ${anchor.at.toISOString().slice(0, 10)}. ` +
                    ((anchor.payload as { receipt?: { status?: string; provider?: string } }).receipt?.status === "unavailable"
                      ? "No third-party timestamp on that anchor — the local provider is in use, and we say so rather than implying one."
                      : `Submitted to ${(anchor.payload as { receipt?: { provider?: string } }).receipt?.provider}.`)
                  : "No anchor has been written yet. The nightly job writes one."}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            This is a defensive publication. It does not stop anyone filing a patent over this work — no
            system can. What it does is put the work, its exact bytes and its date on a public,
            append-only record, which makes it prior art. A patent cannot be validly granted over
            published prior art, and this page is what a patent examiner or a court would be shown.
          </p>
        </section>

        {copies > 1 ? (
          <p className="mt-4 rounded-md border border-border p-3 text-xs text-muted-foreground">
            These exact bytes appear under {copies} artifact records. Storage is keyed by the SHA-256 of
            the file, so identical files are one object with one key — the duplicate publication is
            recorded, the bytes are stored once. That is the dedup working.
          </p>
        ) : null}

        {/* The file. */}
        <section className="mt-6">
          <h2 className="text-lg font-semibold">The file</h2>
          {!a.storage_key ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No file was attached to this artifact — the abstract above is the publication.
            </p>
          ) : access.allowed ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">{access.reason}</p>
              <a
                href={`/api/artifacts/download?id=${a.id}`}
                className="mt-2 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Download
              </a>
              {restricted ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  This download will be logged with your name, your organisation, the purpose you stated
                  and the time — visible to the project team and to the citizen who reported the problem.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">{access.reason}</p>
              {user ? (
                <RequestAccessForm artifactId={a.id} />
              ) : (
                <Link href={`/login?next=/artifacts/${a.id}`} className="mt-2 inline-block text-sm text-primary underline underline-offset-4">
                  Sign in to request access
                </Link>
              )}
            </>
          )}
        </section>

        {/* The access log, public on the artifact it belongs to. */}
        {restricted ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Who has read this</h2>
            <p className="mb-2 mt-1 text-xs text-muted-foreground">
              Every download of a restricted artifact writes a row here and an ACCESS entry in the
              ledger. There is no anonymous read.
            </p>
            {log.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
                Nobody has downloaded this yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {log.map((l, i) => (
                  <li key={i} className="p-3 text-sm">
                    <span className="font-medium">{l.full_name ?? "Unnamed account"}</span>
                    {l.org_name ? <span className="text-muted-foreground"> · {l.org_name}</span> : null}
                    <span className="ms-2 text-xs text-muted-foreground">{l.created_at.slice(0, 16)}</span>
                    {l.purpose ? <p className="mt-1 text-xs text-muted-foreground">{l.purpose}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
