/**
 * The impact counter, defined once.
 *
 * CLAUDE.md invariant 7: it increments at `CITIZEN_VERIFIED` and nowhere else.
 * Not on publish, not on funding, not on an implementer's claim. Task 3.6 step 3
 * requires every dashboard, /stats and the CSR export to be audited for any
 * other definition — so there is now exactly one definition, in this file, and
 * every surface reads it. A second definition anywhere is the bug.
 *
 * The flag rather than the status: a challenge that was confirmed and has since
 * been CLOSED was still confirmed. `impact_confirmed` is written at the
 * CITIZEN_VERIFIED transition and never unwritten except by a dispute, so it is
 * the durable record of the moment the counter moved.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { execRaw } from "@/lib/db/raw";

export interface ImpactCounts {
  /** The citizen said yes. This is the number. */
  confirmed: number;
  /** The citizen said "partly". Counted separately, never rounded up. */
  partial: number;
  /** Someone claims an implementation and the citizen has not answered. Grey, everywhere. */
  claimedUnconfirmed: number;
  /** The citizen said nothing changed. */
  disputed: number;
  /** claimed − confirmed. The most credible number on the page. Never hidden. */
  confirmationGap: number;
}

const EMPTY: ImpactCounts = { confirmed: 0, partial: 0, claimedUnconfirmed: 0, disputed: 0, confirmationGap: 0 };

/**
 * `districtCode` scopes the counts to one district for /gov; null is statewide.
 */
export async function impactCounts(districtCode?: string | null): Promise<ImpactCounts> {
  const scope = districtCode ? sql`WHERE district_code = ${districtCode}` : sql``;
  const rows = await execRaw<{ confirmed: number; partial: number; claimed_unconfirmed: number; disputed: number }>(sql`
    SELECT
      -- INVARIANT 7. The one definition. Do not add a status to this filter.
      count(*) FILTER (WHERE impact_confirmed AND NOT impact_partial)::int AS confirmed,
      count(*) FILTER (WHERE impact_confirmed AND impact_partial)::int      AS partial,
      count(*) FILTER (WHERE status IN ('IMPLEMENTED','INDUSTRY_INTEREST','AGREEMENT_SIGNED','PILOT')
                         AND NOT impact_confirmed)::int                     AS claimed_unconfirmed,
      count(*) FILTER (WHERE impact_disputed)::int                          AS disputed
    FROM challenges
    ${scope}
  `);

  const r = rows[0];
  if (!r) return EMPTY;
  const confirmed = Number(r.confirmed);
  const claimedUnconfirmed = Number(r.claimed_unconfirmed);
  return {
    confirmed,
    partial: Number(r.partial),
    claimedUnconfirmed,
    disputed: Number(r.disputed),
    confirmationGap: claimedUnconfirmed,
  };
}
