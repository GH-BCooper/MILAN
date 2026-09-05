import Link from "next/link";
import { sql } from "drizzle-orm";

import { LedgerEntryRow, type EntryView } from "@/components/ledger-entry-row";
import { SiteHeader } from "@/components/site-header";
import { VerifyChainButton } from "@/components/verify-chain-button";
import { execRaw } from "@/lib/db/raw";

export const metadata = { title: "Provenance ledger" };
export const dynamic = "force-dynamic";

/**
 * The public ledger.
 *
 * "We do not stop people from sharing work. We make it impossible to erase who
 * did it." This is the page that has to be true for that sentence to be true, so
 * it is public, it shows the hashes, and it lets anybody recompute them.
 *
 * The plain-language paragraph below is deliberate. A page that shows hashes and
 * lets the reader assume they mean more than they do would be worse than no page
 * at all, so it says what the chain proves and what it does not.
 */
interface Row extends Record<string, unknown> {
  seq: number;
  kind: string;
  tracking_id: string | null;
  author: string | null;
  content_hash: string;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
  payload: unknown;
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = (Array.isArray(params.kind) ? params.kind[0] : params.kind) || undefined;
  const challenge = (Array.isArray(params.c) ? params.c[0] : params.c) || undefined;

  const rows = await execRaw<Row>(sql`
    SELECT e.seq, e.kind::text AS kind, c.tracking_id, p.full_name AS author,
           e.content_hash, e.prev_hash, e.entry_hash, e.created_at::text AS created_at, e.payload
    FROM ledger_entries e
    LEFT JOIN challenges c ON c.id = e.challenge_id
    LEFT JOIN user_profiles p ON p.user_id = e.author_id
    WHERE TRUE
      ${kind ? sql`AND e.kind::text = ${kind}` : sql``}
      ${challenge ? sql`AND c.tracking_id = ${challenge}` : sql``}
    ORDER BY e.seq DESC
    LIMIT 200
  `);

  const stats = await execRaw<{ n: number; kinds: number; head: string | null; first: string | null }>(sql`
    SELECT count(*)::int AS n,
           count(DISTINCT kind)::int AS kinds,
           (SELECT entry_hash FROM ledger_entries ORDER BY seq DESC LIMIT 1) AS head,
           (SELECT created_at::text FROM ledger_entries ORDER BY seq LIMIT 1) AS first
    FROM ledger_entries
  `);
  const s = stats[0];

  const entries: EntryView[] = rows.map((r) => ({
    seq: Number(r.seq),
    kind: r.kind,
    trackingId: r.tracking_id,
    author: r.author,
    contentHash: r.content_hash,
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
    createdAt: new Date(r.created_at.replace(" ", "T").replace(/\+00$/, "Z")).toISOString(),
    payload: r.payload,
  }));

  const KINDS = ["PROBLEM_TEXT", "MEDIA", "PROPOSAL", "REPORT", "STATE_CHANGE", "CREDIT_EDGE", "ACCESS", "OVERRIDE", "ANCHOR"];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Provenance ledger</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Every consequential thing that happens in Milan writes one row here, linked to the row before
          it by a SHA-256 hash. {s?.n ?? 0} entries, the oldest from{" "}
          {s?.first?.slice(0, 10) ?? "—"}.
        </p>

        <div className="mt-4">
          <VerifyChainButton />
        </div>

        {/* What it proves, and what it does not. In plain words. */}
        <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm">
          <h2 className="font-semibold">What this chain proves, and what it does not</h2>
          <p className="mt-2 text-muted-foreground">
            Each entry carries the hash of the one before it, so changing anything about an old
            entry — a name, a timestamp, a decision — changes its hash, which breaks every hash after
            it. Pressing <span className="font-medium text-foreground">Verify chain</span> recomputes
            all of them and names the first entry that disagrees. The database also physically refuses
            <code className="mx-1 rounded bg-background px-1">UPDATE</code> and
            <code className="mx-1 rounded bg-background px-1">DELETE</code> on this table, so a
            correction cannot be quietly made even by us.
          </p>
          <p className="mt-2 text-muted-foreground">
            What it does <span className="font-medium text-foreground">not</span> prove: that what
            someone wrote was true, and — unless an <span className="font-medium text-foreground">ANCHOR</span>{" "}
            entry for that range has been timestamped by a third party — exactly when it was written.
            It proves the record is the record, nothing more. We use a hash chain rather than a
            blockchain because a hash chain plus a public timestamp gives the same non-repudiation at
            zero cost and zero latency, and we would rather say that out loud than sell you a
            distributed ledger you do not need.
          </p>
        </section>

        <nav className="mt-6 flex flex-wrap gap-2 text-xs">
          <Link href="/ledger" className={`rounded-md border px-3 py-1.5 ${!kind ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
            All kinds
          </Link>
          {KINDS.map((k) => (
            <Link
              key={k}
              href={`/ledger?kind=${k}`}
              className={`rounded-md border px-3 py-1.5 ${kind === k ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}
            >
              {k.replace(/_/g, " ").toLowerCase()}
            </Link>
          ))}
        </nav>

        {challenge ? (
          <p className="mt-3 text-sm">
            Filtered to <span className="font-mono">{challenge}</span>.{" "}
            <Link href="/ledger" className="text-primary underline underline-offset-4">
              show everything
            </Link>
          </p>
        ) : null}

        {entries.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
            No entries match that filter. The ledger itself is not empty — {s?.n ?? 0} entries across{" "}
            {s?.kinds ?? 0} kinds.
          </p>
        ) : (
          <ul className="mt-4 rounded-lg border border-border">
            <li className="flex flex-wrap gap-x-3 border-b border-border bg-muted px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="w-14">Seq</span>
              <span>Kind</span>
              <span className="flex-1">Challenge · author</span>
              <span>Hash</span>
              <span>When</span>
            </li>
            {entries.map((e) => (
              <LedgerEntryRow key={e.seq} entry={e} />
            ))}
          </ul>
        )}

        <p className="mt-4 break-all text-xs text-muted-foreground">
          Head hash: <span className="font-mono">{s?.head ?? "—"}</span>
        </p>
      </main>
    </>
  );
}
