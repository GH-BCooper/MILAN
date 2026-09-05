/**
 * /admin/triage — the low-confidence human queue.
 *
 * When the model is unsure, nothing happens automatically. The item lands here
 * with the citizen's own words, the AI's proposal and the confidence that put
 * it here, and a human accepts or overrides with a mandatory written reason.
 *
 * This is the ethical core made operational: the AI never takes a consequential
 * action alone, and every human decision becomes labelled data that the
 * embedding kNN prior reads on the next classification.
 */
import Link from "next/link";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { trainingCorrections } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import { TriageCard } from "./triage-card";
import { triageQueue } from "./queue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Triage" };

export default async function AdminTriage() {
  const user = await requireRole("ADMIN");

  const [queue, corrections, recent] = await Promise.all([
    triageQueue(),
    db.select({ n: sql<number>`count(*)::int` }).from(trainingCorrections),
    db
      .select({
        id: trainingCorrections.id,
        stage: trainingCorrections.stage,
        reason: trainingCorrections.reason,
        createdAt: trainingCorrections.createdAt,
        proposed: trainingCorrections.proposed,
        corrected: trainingCorrections.corrected,
      })
      .from(trainingCorrections)
      .orderBy(desc(trainingCorrections.createdAt))
      .limit(8),
  ]);

  return (
    <RoleShell
      title="Triage"
      subtitle={`Signed in as ${user.fullName}. ${queue.length} item${queue.length === 1 ? "" : "s"} waiting on a human.`}
    >
      <p className="rounded-lg border border-border bg-muted p-4 text-sm">
        Nothing on this page was decided by the model. Each item came back below its stage&apos;s
        confidence floor, so the platform stopped and asked. Your decision is recorded with its
        reason and becomes labelled data — {corrections[0]?.n ?? 0} correction
        {(corrections[0]?.n ?? 0) === 1 ? "" : "s"} so far. See{" "}
        <Link className="text-primary underline underline-offset-4" href="/admin/ai-runs">
          the AI run log
        </Link>{" "}
        for what every stage actually did.
      </p>

      {queue.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium">Nothing waiting.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every classification since the last run cleared its confidence floor. An empty queue is
            a good sign, not a broken page — the count in the header is live.
          </p>
        </div>
      ) : (
        <ol className="mt-6 space-y-4">
          {queue.map((item) => (
            <li key={`${item.challengeId}-${item.stage}`}>
              <TriageCard
                challengeId={item.challengeId}
                trackingId={item.trackingId}
                title={item.title}
                bodyOriginal={item.bodyOriginal}
                bodyLang={item.bodyLang}
                bodyEn={item.bodyEn}
                status={item.status}
                where={[item.blockName, item.districtName].filter(Boolean).join(", ") || "Location not given"}
                stage={item.stage}
                provider={item.provider}
                model={item.model}
                fallbackLevel={item.fallbackLevel}
                confidence={item.confidence}
                floor={item.floor}
                inputHash={item.inputHash}
                proposal={item.proposal as Record<string, unknown> | null}
              />
            </li>
          ))}
        </ol>
      )}

      {recent.length > 0 ? (
        <section className="mt-10" aria-labelledby="corrections-heading">
          <h2 id="corrections-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent human decisions — the training set
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {recent.map((row) => (
              <li key={row.id} className="p-3">
                <p className="font-mono text-xs text-muted-foreground">{row.stage}</p>
                <p className="mt-0.5 text-sm">{row.reason}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(row.proposed)} → {JSON.stringify(row.corrected)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </RoleShell>
  );
}
