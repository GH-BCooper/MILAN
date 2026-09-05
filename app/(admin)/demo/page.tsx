import Link from "next/link";
import { sql } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { requireRole } from "@/lib/auth/guards";
import { clockNow, elapsedMs } from "@/lib/clock";
import { clockOffsetDays, syncClockOffset } from "@/lib/clock/server";
import { execRaw } from "@/lib/db/raw";
import { chainHead } from "@/lib/ledger/append";
import { deadlineHealth } from "@/lib/sla/reaper";
import { ClockPanel, ResetPanel, ScenarioPanel } from "./console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo console" };

/**
 * /demo — the judge console.
 *
 * This page is what makes the six-minute script survivable: the whole run can be
 * driven from here and the normal UI, with no terminal. ADMIN only, and the
 * role is rechecked here rather than trusted from middleware.
 *
 * The health strip exists so that if anything is red, the driver sees it before
 * the judges do.
 */
interface InboxRow extends Record<string, unknown> {
  topic: string;
  created_at: string;
  to_addr: string | null;
  text: string | null;
  kind: string | null;
  action_url: string | null;
  title: string | null;
  body: string | null;
}

function Health({
  label,
  value,
  ok,
  detail,
}: {
  label: string;
  value: string;
  ok: boolean | null;
  detail?: string;
}) {
  const tone = ok === null ? "border-border bg-muted" : ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50";
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-all font-mono text-sm font-bold">{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export default async function DemoConsole() {
  await requireRole("ADMIN");
  await syncClockOffset(true);

  const dbStart = elapsedMs();
  const [offset, deadlines, head] = await Promise.all([clockOffsetDays(), deadlineHealth(), chainHead()]);
  const dbLatency = elapsedMs() - dbStart;

  const [providers, invariant, lastReaper, inbox] = await Promise.all([
    execRaw<{ level: number; n: number; last: string | null }>(sql`
      SELECT fallback_level AS level, count(*)::int AS n, max(created_at)::text AS last
      FROM ai_runs WHERE created_at > clock_now() - interval '7 days'
      GROUP BY fallback_level ORDER BY fallback_level
    `),
    execRaw<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM challenges c
      WHERE c.status NOT IN ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE','PARKED')
        AND NOT EXISTS (SELECT 1 FROM sla_deadlines d WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL)
    `),
    execRaw<{ last: string | null }>(sql`SELECT max(fired_at)::text AS last FROM sla_deadlines`),
    execRaw<InboxRow>(sql`
      SELECT topic, created_at::text AS created_at,
             payload->>'to' AS to_addr, payload->>'text' AS text,
             payload->>'kind' AS kind, payload->>'actionUrl' AS action_url,
             payload->>'title' AS title, payload->>'body' AS body
      FROM outbox
      WHERE topic IN ('notify.sms.mock', 'notify.whatsapp.mock', 'notify.email')
      ORDER BY created_at DESC
      LIMIT 60
    `),
  ]);

  const orphans = Number(invariant[0]?.n ?? 0);
  const level0 = providers.find((p) => Number(p.level) === 0);
  const level2 = providers.find((p) => Number(p.level) === 2);

  const sms = inbox.filter((r) => r.topic === "notify.sms.mock");
  const whatsapp = inbox.filter((r) => r.topic === "notify.whatsapp.mock");
  const email = inbox.filter((r) => r.topic === "notify.email");

  function Inbox({ title, rows, empty }: { title: string; rows: InboxRow[]; empty: string }) {
    return (
      <div className="rounded-lg border border-border">
        <p className="border-b border-border bg-muted px-3 py-2 text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">· {rows.length}</span>
        </p>
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {rows.map((r, i) => (
              <li key={i} className="p-3">
                <p className="text-[11px] text-muted-foreground">
                  to {r.to_addr ?? "—"} · {r.created_at.slice(0, 16)} · {r.kind ?? ""}
                </p>
                <p className="mt-1 text-sm">{r.text ?? `${r.title ?? ""} — ${r.body ?? ""}`}</p>
                {r.action_url ? (
                  <Link href={r.action_url} className="mt-1 inline-block break-all text-xs text-primary underline underline-offset-4">
                    {r.action_url}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Demo console</h1>
          <p className="font-mono text-sm text-muted-foreground">
            Milan time {clockNow().toISOString().slice(0, 16).replace("T", " ")} UTC
            {offset !== 0 ? ` (offset +${offset}d)` : " (real time)"}
          </p>
        </div>

        {/* If anything is red, the driver sees it before the judges do. */}
        <section className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Health
            label="Invariant 1"
            value={orphans === 0 ? "GREEN" : `${orphans} ORPHANS`}
            ok={orphans === 0}
            detail="Non-terminal challenges with no open deadline"
          />
          <Health
            label="Open deadlines"
            value={String(deadlines.open)}
            ok={deadlines.overdue === 0 ? true : null}
            detail={`${deadlines.overdue} already overdue, ${deadlines.fired} fired`}
          />
          <Health
            label="Last reaper run"
            value={lastReaper[0]?.last?.slice(11, 16) ?? "never"}
            ok={Boolean(lastReaper[0]?.last)}
            detail={lastReaper[0]?.last?.slice(0, 10) ?? "no deadline has fired yet"}
          />
          <Health
            label="Ledger head"
            value={head.entryHash ? `${head.entryHash.slice(0, 10)}…` : "—"}
            ok={Boolean(head.entryHash)}
            detail={`${head.count} entries · seq ${head.seq}`}
          />
          <Health
            label="AI providers"
            value={level0 ? `L0 ${level0.n}` : level2 ? `L2 ${level2.n}` : "no runs"}
            ok={providers.length > 0}
            detail={providers.map((p) => `L${p.level}:${p.n}`).join(" ") || "nothing in 7 days"}
          />
          <Health
            label="Database latency"
            value={`${dbLatency} ms`}
            ok={dbLatency < 1500}
            detail={dbLatency < 1500 ? "healthy" : "slow — check the function region"}
          />
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <ClockPanel />
            <ScenarioPanel />
            <ResetPanel />
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">Simulated inboxes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every message the platform has sent, newest first, with the recipient and the action
                link. SMS and WhatsApp are mock gateways — a real one needs a DLT-registered sender ID
                and template approval — so the message that would have been sent is written verbatim to
                the outbox and shown here. Sunita&rsquo;s confirmation SMS is visible on stage without a phone.
              </p>
            </div>
            <Inbox title="SMS" rows={sms} empty="No SMS yet. Mark the hero challenge implemented to send one." />
            <Inbox title="WhatsApp" rows={whatsapp} empty="No WhatsApp messages yet." />
            <Inbox title="Email" rows={email} empty="No email queued yet." />
          </div>
        </div>

        <section className="mt-8 rounded-lg border border-border bg-muted p-4 text-sm">
          <p className="font-semibold">Where to go next</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["/", "Landing"],
              ["/submit", "Submit a problem"],
              ["/gov/gate", "Human gate"],
              ["/gov", "District dashboard"],
              ["/bounties", "Bounty board"],
              ["/ledger", "Ledger + verify"],
              ["/stats", "Public statistics"],
              ["/industry/csr", "CSR export"],
              ["/admin/ai-runs", "AI run receipts"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold">
                {label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
