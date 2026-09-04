import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";

import { CorroborateButton } from "@/components/corroborate-button";
import { PipelineTrace } from "@/components/pipeline-trace";
import { PriorityBreakdown, parseBreakdown } from "@/components/priority-breakdown";
import { LifecycleStepper } from "@/components/lifecycle-stepper";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { currentUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { blocks, challengeMedia, challenges, creditEdges, districts } from "@/lib/db/schema";
import { publicUrlFor } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  return { title: decodeURIComponent(trackingId) };
}

/** en-IN, and never the user's locale — a date must read the same on every screen. */
function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ trackingId: string }>;
}) {
  const { trackingId } = await params;
  const decoded = decodeURIComponent(trackingId).toUpperCase();
  const user = await currentUser();

  const [row] = await db
    .select({
      challenge: challenges,
      districtName: districts.name,
      districtNameHi: districts.nameHi,
      blockName: blocks.name,
    })
    .from(challenges)
    .leftJoin(districts, eq(districts.code, challenges.districtCode))
    .leftJoin(blocks, eq(blocks.code, challenges.blockCode))
    .where(eq(challenges.trackingId, decoded))
    .limit(1);

  if (!row) notFound();
  const c = row.challenge;
  const breakdown = parseBreakdown(c.priorityBreakdown);

  const [media, credits] = await Promise.all([
    db.select().from(challengeMedia).where(eq(challengeMedia.challengeId, c.id)),
    db
      .select()
      .from(creditEdges)
      .where(eq(creditEdges.challengeId, c.id))
      .orderBy(asc(creditEdges.createdAt)),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="font-mono text-sm font-semibold tracking-tight text-muted-foreground">
          {c.trackingId}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{c.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} />
          {c.domain ? (
            <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
              {c.domain.replaceAll("_", " ")}
            </span>
          ) : null}
          {c.hazard && c.hazard !== "NONE" ? (
            <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              Hazard: {c.hazard.replaceAll("_", " ")}
            </span>
          ) : null}
          {c.isGrievance ? (
            <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
              Forwarded as a grievance
            </span>
          ) : null}
        </div>

        <section className="mt-6 rounded-lg border border-border p-4" aria-label="Progress">
          <LifecycleStepper status={c.status} />
        </section>

        {/* Invariant 6. The citizen's own words and the English working copy sit
            side by side at the same size and the same weight. Never a toggle,
            never a smaller font, never behind a "show original". */}
        <section className="mt-8" aria-labelledby="report-heading">
          <h2 id="report-heading" className="text-lg font-semibold">
            The report
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <article className="rounded-lg border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                As it was reported {c.bodyLang === "hi" ? "(हिन्दी)" : "(English)"}
              </h3>
              <p lang={c.bodyLang} className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
                {c.bodyOriginal}
              </p>
            </article>

            <article className="rounded-lg border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                English working copy
              </h3>
              {c.bodyEn ? (
                <p lang="en" className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
                  {c.bodyEn}
                </p>
              ) : (
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                  Not translated yet. The original above is the record; a translation is added by
                  the AI pipeline and never replaces it.
                </p>
              )}
            </article>
          </div>
        </section>

        {c.successCriteria ? (
          <section className="mt-8" aria-labelledby="success-heading">
            <h2 id="success-heading" className="text-lg font-semibold">
              What success would look like
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-base">{c.successCriteria}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {c.framingApprovedByCitizen
                ? "Approved by the person who reported it."
                : "Not yet approved by the reporter."}
            </p>
          </section>
        ) : null}

        {media.length > 0 ? (
          <section className="mt-8" aria-labelledby="evidence-heading">
            <h2 id="evidence-heading" className="text-lg font-semibold">
              Evidence
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {media.map((m) => (
                <li key={m.id} className="rounded-lg border border-border p-2">
                  {m.mime.startsWith("image/") ? (
                    // A citizen's photo of unknown dimensions from Supabase Storage.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={publicUrlFor(m.storageKey) ?? ""}
                      alt="Evidence submitted with this report"
                      className="aspect-4/3 w-full rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <audio controls className="w-full" src={publicUrlFor(m.storageKey) ?? undefined}>
                      Your browser cannot play this recording.
                    </audio>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Location data removed.{" "}
                    {m.facesBlurred ? "Faces blurred." : "Faces not yet blurred."}
                  </p>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">
                    sha256 {m.contentHash.slice(0, 16)}…
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Details">
          <dl className="rounded-lg border border-border p-4">
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-sm text-muted-foreground">District</dt>
              <dd className="text-sm font-medium">
                {row.districtName ?? "Not given"}
                {row.districtNameHi ? (
                  <span lang="hi" className="ms-1 font-normal text-muted-foreground">
                    {row.districtNameHi}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-sm text-muted-foreground">Block</dt>
              <dd className="text-sm font-medium">{row.blockName ?? "Not given"}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-sm text-muted-foreground">Reported</dt>
              <dd className="text-sm font-medium">{formatDate(c.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-sm text-muted-foreground">How often</dt>
              <dd className="text-sm font-medium">{c.recurrence ?? "Not given"}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-sm text-muted-foreground">People affected</dt>
              <dd className="text-sm font-medium">
                {c.peopleAffected ? `about ${c.peopleAffected.toLocaleString("en-IN")}` : "Not given"}
              </dd>
            </div>
          </dl>

          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Reported by this many people</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{c.corroborationCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Duplicates are not discarded. When two people report the same thing, the reports are
              joined and both are credited.
            </p>
            <div className="mt-3">
              <CorroborateButton trackingId={c.trackingId} signedIn={Boolean(user)} />
            </div>
          </div>
        </section>

        {/* Invariant 10: every number is clickable through to its derivation.
            The breakdown is on the PUBLIC page with no login, because "no
            citizen is deprioritised by a black box" is only true if the
            arithmetic is where the citizen can read it. */}
        <section className="mt-8" id="score" aria-labelledby="score-heading">
          <h2 id="score-heading" className="text-lg font-semibold">
            Priority score
          </h2>
          {breakdown ? (
            <div className="mt-3">
              <PriorityBreakdown
                score={breakdown}
                trackingId={c.trackingId}
                districtCode={c.districtCode}
              />
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-border bg-muted p-4">
              <p className="text-sm font-medium">Not scored yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Severity, people affected, corroborations, hazard linkage, block vulnerability,
                recurrence and official endorsement. Every term, its weight and its value are shown
                here once the pipeline has run, and the total is clickable through to the
                arithmetic.
              </p>
            </div>
          )}
        </section>

        <section className="mt-8" aria-labelledby="credit-heading">
          <h2 id="credit-heading" className="text-lg font-semibold">
            Credit chain
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We do not stop people from sharing work. We make it impossible to erase who did it.
          </p>
          <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
            {credits.map((edge) => (
              <li key={edge.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                  {edge.relation}
                </span>
                <span className="text-sm font-medium">
                  {edge.declaredRole ?? "Anonymous reporter"}
                </span>
                <span className="ms-auto text-xs text-muted-foreground">
                  {formatDate(edge.createdAt)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Team members, mentors, funders and implementers join this chain as the work moves.
          </p>
        </section>

        <p className="mt-10 text-sm">
          <Link className="text-primary underline underline-offset-4" href="/challenges">
            ← All challenges
          </Link>
        </p>
      </main>
    </>
  );
}
