/**
 * The impact counter and the confirmation gap, rendered the same way everywhere.
 *
 * Two rules from CLAUDE.md, both visible rather than documented:
 *   - invariant 7: the counter is the number of citizen confirmations, full stop;
 *   - unconfirmed claims render visibly grey, everywhere, with the words
 *     "claimed, not confirmed" and a tooltip saying why.
 *
 * The gap is not hidden and it is not framed as a shortfall. It is the most
 * credible thing on the page: a platform that shows you what it has NOT proved
 * is a platform you can believe about what it has.
 */
import Link from "next/link";

import type { ImpactCounts } from "@/lib/impact/counter";

export function ImpactCounter({ counts, scopeLabel }: { counts: ImpactCounts; scopeLabel?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-3xl font-bold tabular-nums text-emerald-900">{counts.confirmed}</p>
        <p className="mt-1 text-sm font-semibold text-emerald-900">Confirmed by the citizen</p>
        <p className="mt-1 text-xs text-emerald-800">
          The person who reported the problem says it is fixed. This is the only thing that moves this
          number{scopeLabel ? ` in ${scopeLabel}` : ""}.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-3xl font-bold tabular-nums text-amber-900">{counts.partial}</p>
        <p className="mt-1 text-sm font-semibold text-amber-900">Partly fixed</p>
        <p className="mt-1 text-xs text-amber-800">
          The citizen answered &ldquo;partly&rdquo;. Counted separately and never rounded up into the
          number on the left.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-3xl font-bold tabular-nums text-muted-foreground">{counts.claimedUnconfirmed}</p>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">Claimed, not confirmed</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Someone says they fixed it and the citizen has not answered yet. Grey here, grey on every
          dashboard, and grey in the CSR export.
        </p>
      </div>
    </div>
  );
}

/** The gap, as a number and a bar. Rendered on /gov, /stats and the CSR export. */
export function ConfirmationGap({ counts, href = "/stats" }: { counts: ImpactCounts; href?: string }) {
  const claimed = counts.confirmed + counts.partial + counts.claimedUnconfirmed;
  const pct = claimed === 0 ? 0 : Math.round(((counts.confirmed + counts.partial) / claimed) * 100);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">The confirmation gap</h3>
        <Link href={href} className="text-xs text-primary underline underline-offset-4">
          how this is counted
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {claimed} implementation{claimed === 1 ? "" : "s"} claimed. {counts.confirmed + counts.partial} confirmed
        by the person who reported the problem. {counts.claimedUnconfirmed} still unconfirmed
        {counts.disputed > 0 ? `, ${counts.disputed} disputed` : ""}.
      </p>

      <div className="mt-3 h-6 w-full overflow-hidden rounded border border-border bg-muted">
        <div className="flex h-full">
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${claimed === 0 ? 0 : (counts.confirmed / claimed) * 100}%` }}
            title={`${counts.confirmed} confirmed`}
          />
          <div
            className="h-full bg-amber-500"
            style={{ width: `${claimed === 0 ? 0 : (counts.partial / claimed) * 100}%` }}
            title={`${counts.partial} partly fixed`}
          />
          <div
            className="h-full bg-neutral-400"
            style={{ width: `${claimed === 0 ? 0 : (counts.claimedUnconfirmed / claimed) * 100}%` }}
            title={`${counts.claimedUnconfirmed} claimed, not confirmed`}
          />
        </div>
      </div>
      <p className="mt-2 text-xs tabular-nums text-muted-foreground">
        {pct}% of claimed implementations have been confirmed by a citizen. We show this rather than
        hide it, because a number nobody checks is not an outcome.
      </p>
    </div>
  );
}

/** The inline marker used beside any unconfirmed claim, anywhere in the product. */
export function UnconfirmedTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 ${className}`}
      title="An implementer says this is done. The citizen who reported the problem has not confirmed it, so it does not count towards confirmed impact anywhere in Milan, including the CSR export."
    >
      claimed, not confirmed
    </span>
  );
}
