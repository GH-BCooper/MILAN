import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { execRaw } from "@/lib/db/raw";

export const metadata = { title: "Credit ledger" };
export const dynamic = "force-dynamic";

/**
 * The public ledger. Phase 1 shows the honest state of it: entries exist and
 * carry their content hash, but the chain is not linked yet. We say that
 * plainly rather than drawing a chain that is not there.
 */
export default async function LedgerPage() {
  const [counts] = await execRaw<{ total: number; linked: number; kinds: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE prev_hash IS NOT NULL)::int AS linked,
           count(DISTINCT kind)::int AS kinds
    FROM ledger_entries
  `);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Credit ledger</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We do not stop people from sharing work. We make it impossible to erase who did it.
        </p>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <dt className="text-sm text-muted-foreground">Entries recorded</dt>
            <dd className="mt-1 text-3xl font-bold tabular-nums">{Number(counts?.total ?? 0)}</dd>
          </div>
          <div className="rounded-lg border border-border p-4">
            <dt className="text-sm text-muted-foreground">Entry types in use</dt>
            <dd className="mt-1 text-3xl font-bold tabular-nums">{Number(counts?.kinds ?? 0)}</dd>
          </div>
          <div className="rounded-lg border border-border p-4">
            <dt className="text-sm text-muted-foreground">Chain-linked</dt>
            <dd className="mt-1 text-3xl font-bold tabular-nums">{Number(counts?.linked ?? 0)}</dd>
          </div>
        </dl>

        <div className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6">
          <p className="text-sm font-semibold">The public ledger browser arrives in Phase 3</p>
          <div className="mt-2 space-y-2 text-sm text-muted-foreground">
            <p>
              What already works today: the table refuses UPDATE and DELETE at the database level,
              not by convention, and every entry carries a SHA-256 of its content. Nothing written
              here can be altered or erased.
            </p>
            <p>
              What is not built yet: linking each entry to the one before it with prev_hash, the
              per-entry verification page, and the daily public timestamp anchor. That is Phase 3
              Task 3.4.
            </p>
            <p>
              We would rather tell you the chain is unlinked than draw you a chain that is not
              there.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
