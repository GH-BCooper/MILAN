/**
 * `pnpm phase:report` — the Phase 2 distribution report.
 *
 * PHASE_2_BUILD.md Task 2.10 step 2: challenges by domain, by hazard, by
 * status, mean confidence per stage, fallback-level counts, and p50/p95 latency
 * per stage. Everything is read from the database rather than accumulated in a
 * script, so the numbers are the platform's own account of itself.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const sql = postgres(process.env.DIRECT_URL ?? "", { max: 1, prepare: false });

function table(title: string, rows: Array<Record<string, unknown>>) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (nothing)");
    return;
  }
  const headers = Object.keys(rows[0]);
  const widths = headers.map((h) =>
    Math.max(h.length, ...rows.map((r) => String(r[h] ?? "—").length)),
  );
  console.log("  " + headers.map((h, i) => h.toUpperCase().padEnd(widths[i])).join("  "));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log("  " + headers.map((h, i) => String(row[h] ?? "—").padEnd(widths[i])).join("  "));
  }
}

console.log("=".repeat(72));
console.log("MILAN — PHASE 2 DISTRIBUTION REPORT");
console.log("=".repeat(72));

table(
  "Challenges by status",
  await sql`select status, count(*)::int as n from challenges group by 1 order by 2 desc, 1`,
);

table(
  "Challenges by domain",
  await sql`
    select coalesce(domain::text, '(unclassified)') as domain, count(*)::int as n
    from challenges group by 1 order by 2 desc, 1`,
);

table(
  "Challenges by NDMA hazard",
  await sql`
    select coalesce(hazard::text, '(unclassified)') as hazard, count(*)::int as n,
           round(avg(hazard_strength), 2) as mean_strength
    from challenges group by 1 order by 2 desc, 1`,
);

table(
  "Severity and the human gate",
  await sql`
    select
      case
        when severity is null then '(unscored)'
        when severity >= 0.7 then '>= 0.70 — human gate'
        when severity >= 0.5 then '0.50 - 0.69'
        else '< 0.50'
      end as band,
      count(*)::int as n
    from challenges group by 1 order by 1 desc`,
);

table(
  "Mean confidence and fallback level per stage",
  await sql`
    select
      stage,
      count(*)::int as runs,
      round(avg(confidence), 3) as mean_confidence,
      count(*) filter (where fallback_level = 0)::int as gemini_l0,
      count(*) filter (where fallback_level = 1)::int as groq_l1,
      count(*) filter (where fallback_level = 2)::int as rules_l2,
      count(*) filter (where provider = 'cache')::int as from_cache
    from ai_runs group by 1 order by 1`,
);

table(
  "Latency per stage (live calls only — cache hits excluded)",
  await sql`
    select
      stage,
      count(*)::int as calls,
      percentile_cont(0.5) within group (order by latency_ms)::int as p50_ms,
      percentile_cont(0.95) within group (order by latency_ms)::int as p95_ms,
      max(latency_ms)::int as max_ms
    from ai_runs where provider <> 'cache' group by 1 order by 1`,
);

table(
  "Clustering",
  await sql`
    select 'merged into another report' as outcome, count(*)::int as n from challenges where status = 'MERGED'
    union all
    select 'systemic parents created', count(*)::int from challenges where is_parent
    union all
    select 'children under a parent', count(*)::int from challenges where parent_id is not null
    union all
    select 'corroborations recorded', count(*)::int from corroborations
    union all
    select 'zero-weight (flagged) corroborations', count(*)::int from corroborations where weight = 0`,
);

table(
  "Routing",
  await sql`
    select state, count(*)::int as n,
           count(*) filter (where notified_at is null)::int as unnotified,
           round(avg(match_score), 3) as mean_match
    from routes group by 1 order by 2 desc`,
);

table(
  "Priority score",
  await sql`
    select
      count(*) filter (where priority_score is not null)::int as scored,
      round(min(priority_score), 1) as min,
      round(avg(priority_score), 1) as mean,
      round(max(priority_score), 1) as max,
      count(distinct scoring_version)::int as versions
    from challenges`,
);

table(
  "Top 5 by priority",
  await sql`
    select tracking_id, round(priority_score, 1) as score, domain::text, hazard::text, status
    from challenges where priority_score is not null
    order by priority_score desc limit 5`,
);

table(
  "Human oversight",
  await sql`
    select 'training corrections recorded' as item, count(*)::int as n from training_corrections
    union all
    select 'grievances forwarded externally', count(*)::int from challenges where is_grievance
    union all
    select 'rejected as unsafe', count(*)::int from challenges where status = 'REJECTED_UNSAFE'
    union all
    select 'audit log entries', count(*)::int from audit_log
    union all
    select 'ledger entries', count(*)::int from ledger_entries`,
);

table(
  "Language coverage",
  await sql`
    select body_lang,
           count(*)::int as n,
           count(*) filter (where body_en is not null)::int as with_english
    from challenges group by 1 order by 2 desc`,
);

const [cache] = await sql`select count(*)::int as n, sum(hits)::int as hits from ai_cache`;
console.log(
  `\nAI cache: ${cache.n} entries, ${cache.hits ?? 0} hits. ` +
    `Every entry is a stage output that will not be paid for twice.`,
);

await sql.end();
