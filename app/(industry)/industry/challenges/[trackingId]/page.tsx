import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";

import { RoleShell } from "@/components/role-shell";
import { UnconfirmedTag } from "@/components/impact-counter";
import { STATUS_LABEL } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { execRaw } from "@/lib/db/raw";
import type { ChallengeStatus } from "@/lib/db/schema";
import { InterestForm } from "./interest-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Challenge" };

interface Row extends Record<string, unknown> {
  id: string;
  tracking_id: string;
  title: string;
  body_original: string;
  body_lang: string;
  body_en: string | null;
  framed_statement: string | null;
  success_criteria: string | null;
  status: ChallengeStatus;
  district_name: string | null;
  domain: string | null;
  hazard: string | null;
  priority_score: string | null;
  people_affected: number | null;
  corroboration_count: number;
  impact_confirmed: boolean;
  impact_partial: boolean;
  org_name: string | null;
  artifacts: Array<{ id: string; title: string; abstract: string; licence: string; hash: string | null }> | null;
  interests: Array<{ id: string; org: string; state: string; message: string; at: string }> | null;
}

export default async function IndustryChallengePage({ params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  const user = await requireRole("INDUSTRY", "ADMIN");

  const rows = await execRaw<Row>(sql`
    SELECT c.id, c.tracking_id, c.title, c.body_original, c.body_lang, c.body_en,
           c.framed_statement, c.success_criteria, c.status, d.name AS district_name,
           c.domain::text AS domain, c.hazard::text AS hazard, c.priority_score::text AS priority_score,
           c.people_affected, c.corroboration_count, c.impact_confirmed, c.impact_partial,
           o.name AS org_name,
           (SELECT json_agg(json_build_object('id', a.id, 'title', a.title, 'abstract', a.abstract,
                                              'licence', a.licence::text, 'hash', a.content_hash)
                            ORDER BY a.published_at DESC)
              FROM artifacts a WHERE a.project_id = p.id) AS artifacts,
           (SELECT json_agg(json_build_object('id', i.id, 'org', io.name, 'state', i.state,
                                              'message', i.message, 'at', i.created_at::text)
                            ORDER BY i.created_at DESC)
              FROM industry_interests i JOIN organization io ON io.id = i.org_id
             WHERE i.challenge_id = c.id) AS interests
    FROM challenges c
    LEFT JOIN districts d ON d.code = c.district_code
    LEFT JOIN projects p ON p.challenge_id = c.id
    LEFT JOIN organization o ON o.id = p.org_id
    WHERE c.tracking_id = ${decodeURIComponent(trackingId)}
    LIMIT 1
  `);
  if (rows.length === 0) notFound();
  const c = rows[0];

  const mine = (c.interests ?? []).filter((i) => i.org && i.org.length > 0);

  return (
    <RoleShell
      title={c.title}
      subtitle={`${c.tracking_id} · ${c.district_name ?? "unlocated"} · ${STATUS_LABEL[c.status]}${c.org_name ? ` · claimed by ${c.org_name}` : ""}`}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-muted px-2 py-1">{(c.domain ?? "unclassified").replace(/_/g, " ").toLowerCase()}</span>
          {c.hazard && c.hazard !== "NONE" ? (
            <span className="rounded bg-amber-100 px-2 py-1 text-amber-900">NDMA hazard: {c.hazard.replace(/_/g, " ").toLowerCase()}</span>
          ) : null}
          <span className="rounded bg-muted px-2 py-1">{c.corroboration_count} reporters</span>
          {c.people_affected ? <span className="rounded bg-muted px-2 py-1">~{c.people_affected} people affected</span> : null}
          <span className="rounded bg-muted px-2 py-1 tabular-nums">priority {c.priority_score ? Number(c.priority_score).toFixed(3) : "—"}</span>
          {["IMPLEMENTED", "INDUSTRY_INTEREST", "AGREEMENT_SIGNED", "PILOT"].includes(c.status) && !c.impact_confirmed ? <UnconfirmedTag /> : null}
        </div>

        {/* Invariant 6, on an industry screen too. */}
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              The citizen&rsquo;s own words ({c.body_lang})
            </p>
            <p className="mt-2 text-sm">{c.body_original}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">English working copy</p>
            <p className="mt-2 text-sm">{c.body_en ?? <span className="text-muted-foreground">Not translated yet.</span>}</p>
          </div>
        </section>

        {c.framed_statement ? (
          <section className="rounded-lg border border-border bg-muted p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              The research question, as the citizen approved it
            </p>
            <p className="mt-2 text-sm">{c.framed_statement}</p>
            {c.success_criteria ? <p className="mt-2 text-sm text-muted-foreground">Success looks like: {c.success_criteria}</p> : null}
          </section>
        ) : null}

        <section>
          <h2 className="text-lg font-semibold">Published work</h2>
          {!c.artifacts || c.artifacts.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              Nothing has been published on this challenge yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {c.artifacts.map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/artifacts/${a.id}`} className="text-sm font-semibold underline-offset-4 hover:underline">
                      {a.title}
                    </Link>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${a.licence === "CC_BY" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                      {a.licence === "CC_BY" ? "CC-BY" : "restricted"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.abstract}</p>
                  {a.licence === "RESTRICTED" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      You are seeing the public metadata. The file needs a request with a stated purpose,
                      and every download is logged.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold">Express interest</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            If the team accepts, {user.fullName}&rsquo;s organisation joins the public credit chain as the
            funding partner — permanently, beside the citizen who reported it and the students who
            solved it. None of the three can remove either of the others.
          </p>
          <InterestForm trackingId={c.tracking_id} />
        </section>

        {mine.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold">Expressions of interest on this challenge</h2>
            <ul className="mt-2 space-y-2">
              {mine.map((i) => (
                <li key={i.id} className="rounded-lg border border-border p-3 text-sm">
                  <Link href={`/industry/interests/${i.id}`} className="font-semibold underline-offset-4 hover:underline">
                    {i.org}
                  </Link>
                  <span className="ms-2 rounded bg-muted px-2 py-0.5 text-[11px]">{i.state.toLowerCase()}</span>
                  <p className="mt-1 text-muted-foreground">{i.message}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </RoleShell>
  );
}
