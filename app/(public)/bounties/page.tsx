import Link from "next/link";
import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { execRaw } from "@/lib/db/raw";

export const metadata = { title: "Bounties" };
export const dynamic = "force-dynamic";

/**
 * Bounties are the last stop before a challenge is parked: nobody claimed it in
 * the routing window, it was escalated, and it is now open to anyone. The list
 * is genuinely empty in Phase 1 because nothing has been routed yet.
 */
export default async function BountiesPage() {
  const [row] = await execRaw<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM challenges WHERE status = 'BOUNTY_LISTED'`,
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Bounties</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Problems that no department claimed inside the routing window, opened to anybody who wants
          to take them on.
        </p>

        <p className="mt-6 text-3xl font-bold tabular-nums">{Number(row?.n ?? 0)}</p>
        <p className="text-sm text-muted-foreground">currently listed</p>

        <div className="mt-6 rounded-lg border border-dashed border-border bg-muted p-6">
          <p className="text-sm font-semibold">Arrives in Phase 3</p>
          <p className="mt-2 text-sm text-muted-foreground">
            A challenge reaches this page only after routing has offered it, the claim window has
            expired, the offer has been widened, and the SLA ladder has escalated it. None of that
            machinery runs yet, so this list is empty rather than seeded with examples.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Until then,{" "}
            <Link className="text-primary underline underline-offset-4" href="/challenges">
              browse every challenge
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  );
}
