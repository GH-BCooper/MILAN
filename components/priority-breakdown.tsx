"use client";

/**
 * The priority breakdown.
 *
 * CLAUDE.md invariant 10: every number on screen is clickable through to its
 * derivation. A score with no visible breakdown is a bug, so this component is
 * the thing that makes the score legitimate rather than decoration on top of it.
 *
 * It renders on the PUBLIC challenge page with no login. "No citizen is
 * deprioritised by a black box" is only true if the breakdown is where the
 * citizen can see it, and it is.
 *
 * Every raw value links to its source: people affected to the submission,
 * block vulnerability to the district page, corroborations to the list of
 * people who reported the same problem.
 */
import Link from "next/link";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ScoreResult, Term, TermKey } from "@/packages/scoring";

/**
 * One hue per term, ordered so the two heaviest terms are the two most distinct.
 * Colour is never the only signal here: the table below carries every number.
 */
const TERM_COLOUR: Record<TermKey, string> = {
  severity: "#1e3a8a",
  hazard: "#b45309",
  peopleAffected: "#0369a1",
  blockVulnerability: "#4338ca",
  corroborations: "#047857",
  recurrence: "#7c3aed",
  officialEndorsement: "#475569",
};

export interface PriorityBreakdownProps {
  score: ScoreResult;
  trackingId: string;
  districtCode: string | null;
  /** Compact drops the chart and keeps the table; used inside dense dashboards. */
  compact?: boolean;
}

export function PriorityBreakdown({
  score,
  trackingId,
  districtCode,
  compact = false,
}: PriorityBreakdownProps) {
  const data = score.terms.map((t) => ({
    key: t.key,
    name: t.label,
    contribution: Number((t.contribution * 100).toFixed(2)),
    term: t,
  }));

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Priority score</p>
          <p className="text-4xl font-bold tabular-nums">{score.total.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">out of 100</p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          scoring function v{score.version}
        </p>
      </div>

      {!compact ? (
        <div className="border-b border-border p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Each bar is that term&apos;s contribution to the total, in points out of 100.
          </p>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis
                  type="number"
                  domain={[0, Math.max(25, ...data.map((d) => d.contribution))]}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  formatter={(value: number) => [`${value.toFixed(2)} points`, "Contribution"]}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                />
                <Bar dataKey="contribution" radius={[0, 3, 3, 0]}>
                  {data.map((d) => (
                    <Cell key={d.key} fill={TERM_COLOUR[d.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {/* The table is the real explanation. The chart is a convenience; a
          screen reader and a 320px phone both get the whole thing here. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-sm">
          <caption className="sr-only">
            How the priority score for {trackingId} was calculated
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="p-3 font-medium">Term</th>
              <th scope="col" className="p-3 font-medium">What we know</th>
              <th scope="col" className="p-3 text-right font-medium">Normalised</th>
              <th scope="col" className="p-3 text-right font-medium">Weight</th>
              <th scope="col" className="p-3 text-right font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {score.terms.map((term) => (
              <tr key={term.key} className="border-b border-border last:border-0 align-top">
                <th scope="row" className="p-3 text-left font-medium">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: TERM_COLOUR[term.key] }}
                    />
                    {term.label}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {term.source}
                  </span>
                </th>
                <td className="p-3">
                  <RawValue term={term} trackingId={trackingId} districtCode={districtCode} />
                </td>
                <td className="p-3 text-right tabular-nums">{term.normalised.toFixed(4)}</td>
                <td className="p-3 text-right tabular-nums text-muted-foreground">
                  &times; {term.weight.toFixed(2)}
                </td>
                <td className="p-3 text-right font-medium tabular-nums">
                  {(term.contribution * 100).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/50 font-semibold">
              <th scope="row" className="p-3 text-left">
                Total
              </th>
              <td className="p-3 text-xs font-normal text-muted-foreground">
                Sum of the seven contributions
              </td>
              <td />
              <td className="p-3 text-right text-xs font-normal text-muted-foreground">1.00</td>
              <td className="p-3 text-right tabular-nums">{score.total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="border-t border-border p-4 text-sm text-muted-foreground">
        Every challenge is scored by the same published function. Nothing is hidden.{" "}
        <Link href="/stats#scoring" className="text-primary underline underline-offset-4">
          How the weights were chosen
        </Link>
      </p>
    </div>
  );
}

/** The raw value, linked to wherever it came from. Invariant 10, literally. */
function RawValue({
  term,
  trackingId,
  districtCode,
}: {
  term: Term;
  trackingId: string;
  districtCode: string | null;
}) {
  const linkClass = "text-primary underline underline-offset-4";

  switch (term.key) {
    case "peopleAffected":
    case "recurrence":
      return (
        <Link className={linkClass} href={`/c/${trackingId}#details`}>
          {term.rawValue}
        </Link>
      );
    case "blockVulnerability":
      return districtCode ? (
        <Link className={linkClass} href={`/gov/district/${districtCode}`}>
          {term.rawValue}
        </Link>
      ) : (
        <span>{term.rawValue}</span>
      );
    case "corroborations":
      return (
        <Link className={linkClass} href={`/c/${trackingId}#corroborations`}>
          {term.rawValue}
        </Link>
      );
    case "severity":
    case "hazard":
      return (
        <Link className={linkClass} href={`/c/${trackingId}#pipeline`}>
          {term.rawValue}
        </Link>
      );
    default:
      return <span>{term.rawValue}</span>;
  }
}

/** Parse a stored `priority_breakdown` back into a ScoreResult, or null. */
export function parseBreakdown(value: unknown): ScoreResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<ScoreResult>;
  if (typeof candidate.total !== "number" || !Array.isArray(candidate.terms)) return null;
  return {
    total: candidate.total,
    version: typeof candidate.version === "string" ? candidate.version : "unknown",
    terms: candidate.terms as Term[],
  };
}
