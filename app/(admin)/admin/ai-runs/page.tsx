/**
 * /admin/ai-runs — the receipt.
 *
 * Every tick a judge watches on the pipeline trace corresponds to one row in
 * this table. When someone asks whether the animation is real, this is the page
 * that answers: provider, model, fallback level, confidence, latency and the
 * hash of the input, for every call the platform has ever made.
 *
 * It also shows p50 and p95 latency per stage, because "under eight seconds"
 * is a claim we make on stage and this is where we check it.
 */
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { aiRuns, challenges } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI runs" };

const PAGE_SIZE = 100;

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function AiRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; provider?: string; level?: string }>;
}) {
  const user = await requireRole("ADMIN");
  const filters = await searchParams;

  const where = and(
    filters.stage ? eq(aiRuns.stage, filters.stage) : undefined,
    filters.provider ? eq(aiRuns.provider, filters.provider) : undefined,
    filters.level !== undefined && filters.level !== ""
      ? eq(aiRuns.fallbackLevel, Number(filters.level))
      : undefined,
  );

  const [rows, latency, providers, stages] = await Promise.all([
    db
      .select({
        id: aiRuns.id,
        stage: aiRuns.stage,
        provider: aiRuns.provider,
        model: aiRuns.model,
        fallbackLevel: aiRuns.fallbackLevel,
        confidence: aiRuns.confidence,
        latencyMs: aiRuns.latencyMs,
        inputHash: aiRuns.inputHash,
        createdAt: aiRuns.createdAt,
        trackingId: challenges.trackingId,
      })
      .from(aiRuns)
      .leftJoin(challenges, eq(challenges.id, aiRuns.challengeId))
      .where(where)
      .orderBy(desc(aiRuns.createdAt))
      .limit(PAGE_SIZE),

    // p50 and p95 per stage. Cache hits are excluded from the percentiles:
    // a 0ms cached answer is real, but averaging it in would flatter the
    // number we quote on stage, and the point of this page is not to flatter.
    db
      .select({
        stage: aiRuns.stage,
        n: sql<number>`count(*)::int`,
        p50: sql<number>`percentile_cont(0.5) within group (order by ${aiRuns.latencyMs})::int`,
        p95: sql<number>`percentile_cont(0.95) within group (order by ${aiRuns.latencyMs})::int`,
        fallbacks: sql<number>`count(*) filter (where ${aiRuns.fallbackLevel} = 2)::int`,
      })
      .from(aiRuns)
      .where(sql`${aiRuns.provider} <> 'cache'`)
      .groupBy(aiRuns.stage)
      .orderBy(aiRuns.stage),

    db
      .select({ provider: aiRuns.provider, n: sql<number>`count(*)::int` })
      .from(aiRuns)
      .groupBy(aiRuns.provider),

    db.select({ stage: aiRuns.stage }).from(aiRuns).groupBy(aiRuns.stage).orderBy(aiRuns.stage),
  ]);

  const total = providers.reduce((sum, p) => sum + Number(p.n), 0);

  return (
    <RoleShell
      title="AI runs"
      subtitle={`Signed in as ${user.fullName}. Every model call Milan has made, ${total.toLocaleString("en-IN")} in total.`}
    >
      <p className="rounded-lg border border-border bg-muted p-4 text-sm">
        Every stage that ticks over on a pipeline trace writes one row here, including the calls
        that failed and fell through to the next provider, and including cache hits. If the
        animation on the trace looked too smooth to be real, this is the table that settles it.
      </p>

      <section className="mt-6" aria-labelledby="latency-heading">
        <h2 id="latency-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Latency by stage (live calls only, cache hits excluded)
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-2 font-medium">Stage</th>
                <th scope="col" className="p-2 text-right font-medium">Calls</th>
                <th scope="col" className="p-2 text-right font-medium">p50</th>
                <th scope="col" className="p-2 text-right font-medium">p95</th>
                <th scope="col" className="p-2 text-right font-medium">Fell to rules</th>
              </tr>
            </thead>
            <tbody>
              {latency.map((row) => (
                <tr key={row.stage} className="border-b border-border last:border-0">
                  <th scope="row" className="p-2 text-left font-mono font-normal">{row.stage}</th>
                  <td className="p-2 text-right tabular-nums">{row.n}</td>
                  <td className="p-2 text-right tabular-nums">{row.p50 ?? "—"} ms</td>
                  <td className="p-2 text-right tabular-nums">{row.p95 ?? "—"} ms</td>
                  <td className="p-2 text-right tabular-nums">{row.fallbacks}</td>
                </tr>
              ))}
              {latency.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-sm text-muted-foreground">
                    No runs recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="filter-heading">
        <h2 id="filter-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Filter
        </h2>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <FilterLink label="All" href="/admin/ai-runs" active={!filters.stage && !filters.provider && !filters.level} />
          {stages.map((s) => (
            <FilterLink
              key={s.stage}
              label={s.stage}
              href={`/admin/ai-runs?stage=${encodeURIComponent(s.stage)}`}
              active={filters.stage === s.stage}
            />
          ))}
          {providers.map((p) => (
            <FilterLink
              key={p.provider ?? "none"}
              label={`${p.provider ?? "unknown"} (${p.n})`}
              href={`/admin/ai-runs?provider=${encodeURIComponent(p.provider ?? "")}`}
              active={filters.provider === p.provider}
            />
          ))}
          <FilterLink label="fallback level 2" href="/admin/ai-runs?level=2" active={filters.level === "2"} />
        </div>
      </section>

      <section className="mt-6" aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="sr-only">
          Runs
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[62rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-2 font-medium">When</th>
                <th scope="col" className="p-2 font-medium">Challenge</th>
                <th scope="col" className="p-2 font-medium">Stage</th>
                <th scope="col" className="p-2 font-medium">Provider</th>
                <th scope="col" className="p-2 font-medium">Model</th>
                <th scope="col" className="p-2 text-right font-medium">Level</th>
                <th scope="col" className="p-2 text-right font-medium">Confidence</th>
                <th scope="col" className="p-2 text-right font-medium">Latency</th>
                <th scope="col" className="p-2 font-medium">Input hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap p-2 text-xs tabular-nums text-muted-foreground">
                    {formatTime(row.createdAt)}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {row.trackingId ? (
                      <Link className="text-primary underline underline-offset-4" href={`/c/${row.trackingId}`}>
                        {row.trackingId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">{row.stage}</td>
                  <td className="p-2">{row.provider}</td>
                  <td className="p-2 font-mono text-xs">{row.model ?? "—"}</td>
                  <td className="p-2 text-right">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        row.fallbackLevel === 2
                          ? "bg-amber-100 text-amber-900"
                          : row.fallbackLevel === 1
                            ? "bg-sky-100 text-sky-900"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.fallbackLevel}
                    </span>
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {row.confidence === null ? "—" : Number(row.confidence).toFixed(2)}
                  </td>
                  <td className="p-2 text-right tabular-nums">{row.latencyMs ?? 0} ms</td>
                  <td className="p-2 font-mono text-[10px] text-muted-foreground">
                    {row.inputHash?.slice(0, 12) ?? "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-sm text-muted-foreground">
                    No runs match that filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the most recent {Math.min(PAGE_SIZE, rows.length)} runs. Level 0 is Gemini, 1 is
          Groq, 2 is the deterministic rule tier that needs no network.
        </p>
      </section>
    </RoleShell>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-medium ${
        active ? "border-primary bg-accent text-accent-foreground" : "border-border"
      }`}
    >
      {label}
    </Link>
  );
}
