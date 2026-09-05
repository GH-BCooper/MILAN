import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";

import { alias } from "drizzle-orm/pg-core";

import { CitationBlock } from "@/components/citation-block";
import { CorroborateButton } from "@/components/corroborate-button";
import { UnconfirmedTag } from "@/components/impact-counter";
import { CreditChain } from "@/components/credit-chain";
import { bibtex, citationString, type CitationInput } from "@/lib/credit/citation";
import { PipelineTrace } from "@/components/pipeline-trace";
import { PriorityBreakdown } from "@/components/priority-breakdown";
import { parseBreakdown } from "@/packages/scoring";
import { LifecycleStepper } from "@/components/lifecycle-stepper";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { currentUser } from "@/lib/auth/guards";
import { framingProvenance } from "@/lib/ai/stages/p1_framing";
import { handoffContract } from "@/lib/ai/triage";
import { db } from "@/lib/db";
import {
  blocks,
  capabilities,
  challengeMedia,
  challenges,
  creditEdges,
  districts,
  organization,
  routes,
  userProfiles,
} from "@/lib/db/schema";

/**
 * A credit edge points at a person and, separately, at an organisation. Both are
 * joined here under their own aliases so the chain can render "Prof. R. Kumar ·
 * BIT Sindri" without a second round trip per node.
 */
const creditProfile = alias(userProfiles, "credit_profile");
const creditOrg = alias(organization, "credit_org");
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
  const provenance = framingProvenance({
    framedStatement: c.framedStatement,
    approved: c.framingApprovedByCitizen,
  });

  const host = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const [media, credits, offers] = await Promise.all([
    db.select().from(challengeMedia).where(eq(challengeMedia.challengeId, c.id)),
    // The credit chain, with the names resolved. Team members are credited by
    // NAME on the public chain, never by email — the email links an account and
    // sends the notification, and it stays in project_members and the ledger.
    db
      .select({
        id: creditEdges.id,
        relation: creditEdges.relation,
        declaredRole: creditEdges.declaredRole,
        createdAt: creditEdges.createdAt,
        toUserId: creditEdges.toUserId,
        toName: creditProfile.fullName,
        orgName: creditOrg.name,
      })
      .from(creditEdges)
      .leftJoin(creditProfile, eq(creditProfile.userId, creditEdges.toUserId))
      .leftJoin(creditOrg, eq(creditOrg.id, creditEdges.orgId))
      .where(eq(creditEdges.challengeId, c.id))
      .orderBy(asc(creditEdges.createdAt)),
    db
      .select({
        id: routes.id,
        rank: routes.rank,
        matchScore: routes.matchScore,
        reasonText: routes.reasonText,
        notifiedAt: routes.notifiedAt,
        claimWindowEndsAt: routes.claimWindowEndsAt,
        orgName: organization.name,
        department: capabilities.department,
        labName: capabilities.labName,
      })
      .from(routes)
      .innerJoin(organization, eq(organization.id, routes.orgId))
      .leftJoin(capabilities, eq(capabilities.id, routes.capabilityId))
      .where(eq(routes.challengeId, c.id))
      .orderBy(asc(routes.rank)),
  ]);

  /**
   * The citation. The team name is the organisation on the first TEAM_MEMBER or
   * MENTOR edge — a department, not an individual, because that is how a
   * final-year project is cited. Before anyone claims it there is no team, and
   * the citation is the citizen alone, which is correct rather than incomplete.
   */
  const teamOrg =
    credits.find((e) => e.relation === "TEAM_MEMBER" && e.orgName)?.orgName ??
    credits.find((e) => e.relation === "MENTOR" && e.orgName)?.orgName ??
    null;

  const citationInput: CitationInput = {
    trackingId: c.trackingId,
    originatorName: c.reporterName,
    teamName: teamOrg,
    title: c.title,
    place: row.blockName ?? row.districtName ?? null,
    year: c.createdAt.getUTCFullYear(),
    host,
  };

  // The gate is held when routes exist but none has been notified: S5 wrote the
  // shortlist and deliberately sent nothing.
  const gateHeld = offers.length > 0 && offers.every((o) => o.notifiedAt === null);

  // A recording gets its own three-panel section; photographs stay in Evidence.
  const audio = media.filter((m) => m.mime.startsWith("audio/"));
  const photos = media.filter((m) => !m.mime.startsWith("audio/"));

  // The grievance handoff contract, rebuilt from the challenge rather than
  // stored, so what is shown is always what would be sent today.
  const contract =
    c.isGrievance && c.forwardedRef
      ? handoffContract({
          target: c.forwardedRef.startsWith("JHS") ? "JharSewa" : "CPGRAMS",
          reference: c.forwardedRef,
          trackingId: c.trackingId,
          title: c.title,
          bodyOriginal: c.bodyOriginal,
          bodyLang: c.bodyLang,
          bodyEn: c.bodyEn,
          districtCode: c.districtCode,
          blockCode: c.blockCode,
          reporterName: c.reporterName,
          rationale: "Classified as a grievance by S1 and forwarded to the scheme owner.",
          createdAt: c.createdAt,
        })
      : null;

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
          {/* Invariant 7, rendered where a reader might otherwise assume a fix.
              An implementer's claim is grey until the citizen answers. */}
          {["IMPLEMENTED", "INDUSTRY_INTEREST", "AGREEMENT_SIGNED", "PILOT"].includes(c.status) && !c.impactConfirmed ? (
            <UnconfirmedTag />
          ) : null}
          {c.impactConfirmed && c.impactPartial ? (
            <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
              the citizen says partly fixed
            </span>
          ) : null}
          {c.impactConfirmed && !c.impactPartial ? (
            <span className="rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900">
              confirmed fixed by the citizen
            </span>
          ) : null}
          {c.impactDisputed ? (
            <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-900">
              disputed — the citizen says nothing changed
            </span>
          ) : null}
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

        {/* Task 2.7. The provenance of the wording is never left implicit: a
            reader always knows whether they are looking at the citizen's own
            sentence or at one an AI proposed and the citizen approved. */}
        {c.framedStatement || c.successCriteria ? (
          <section className="mt-8" aria-labelledby="framing-heading">
            <h2 id="framing-heading" className="text-lg font-semibold">
              The problem, as a research team receives it
            </h2>
            <p className="mt-1 text-sm">
              <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                {provenance.label}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{provenance.detail}</p>

            {c.framedStatement ? (
              <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">
                {c.framedStatement}
              </p>
            ) : null}

            {c.successCriteria ? (
              <>
                <h3 className="mt-5 text-sm font-semibold">What success would look like</h3>
                <p className="mt-1 whitespace-pre-wrap text-base">{c.successCriteria}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only the person who reported this can confirm it was solved. Nobody else can mark
                  it done.
                </p>
              </>
            ) : null}
          </section>
        ) : null}

        {/* Task 2.8, the three-panel voice result: the recording, the words as
            they were spoken, and the English working copy. The original is the
            same size and weight as the translation and it is never behind a
            toggle — a person who reports in Hindi is not a second-class
            reporter of their own problem. */}
        {audio.length > 0 ? (
          <section className="mt-8" aria-labelledby="voice-heading">
            <h2 id="voice-heading" className="text-lg font-semibold">
              Reported by voice
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Recorded on a phone. Milan transcribed it and translated it; both are shown, and the
              recording itself is here so anyone can check the transcript against it.
            </p>
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  The recording
                </h3>
                {audio.map((m) => (
                  <div key={m.id} className="mt-2">
                    <audio controls className="w-full" src={publicUrlFor(m.storageKey) ?? undefined}>
                      Your browser cannot play this recording.
                    </audio>
                    <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                      sha256 {m.contentHash.slice(0, 16)}…
                    </p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What was said {c.bodyLang === "hi" ? "(हिन्दी)" : `(${c.bodyLang})`}
                </h3>
                <p lang={c.bodyLang} className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
                  {c.bodyOriginal}
                </p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  English working copy
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
                  {c.bodyEn ?? (
                    <span className="text-muted-foreground">
                      Not translated yet. The words above are the record.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {photos.length > 0 ? (
          <section className="mt-8" aria-labelledby="evidence-heading">
            <h2 id="evidence-heading" className="text-lg font-semibold">
              Evidence
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {photos.map((m) => (
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

        <section id="details" className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Details">
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

          <div id="corroborations" className="rounded-lg border border-border p-4">
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

        {offers.length > 0 ? (
          <section className="mt-8" id="routing" aria-labelledby="routing-heading">
            <h2 id="routing-heading" className="text-lg font-semibold">
              Where it was sent
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A professor never has to go looking. Each department below was matched by a published
              scoring function and sent a direct link, with a written reason and a clock.
            </p>
            {gateHeld ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Severity is at or above 0.70, so nothing has been sent yet. A District Collector
                confirms or overrides this shortlist first, and any override is recorded with a
                written reason.
              </p>
            ) : null}
            <ol className="mt-3 space-y-2">
              {offers.map((offer) => (
                <li key={offer.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      <span className="me-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        #{offer.rank}
                      </span>
                      {offer.orgName}
                      {offer.department ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {offer.department}
                          {offer.labName ? ` · ${offer.labName}` : ""}
                        </span>
                      ) : null}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      match {offer.matchScore ? Number(offer.matchScore).toFixed(3) : "—"}
                    </p>
                  </div>
                  {offer.reasonText ? <p className="mt-1 text-sm">{offer.reasonText}</p> : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {offer.notifiedAt
                      ? `Notified ${formatDate(offer.notifiedAt)}.`
                      : "Not notified yet — waiting for a district officer to confirm."}
                    {offer.claimWindowEndsAt
                      ? ` Claim window closes ${formatDate(offer.claimWindowEndsAt)}.`
                      : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* The live answer to "why not just use CPGRAMS". We are not competing
            with it; when something is a grievance we hand it over, and we show
            the citizen exactly what we handed over. */}
        {c.isGrievance && c.forwardedRef ? (
          <section className="mt-8" id="forwarded" aria-labelledby="forwarded-heading">
            <h2 id="forwarded-heading" className="text-lg font-semibold">
              This was a grievance, so we forwarded it
            </h2>
            <p className="mt-1 text-sm">
              This problem already has a known fix and an accountable officer, so it belongs to the
              grievance system rather than to a research team. Milan sent it on rather than sitting
              on it.
            </p>
            <p className="mt-3 rounded-md border border-border bg-muted p-3 font-mono text-sm">
              Reference: {c.forwardedRef}
            </p>
            {contract ? (
              <details className="mt-3 rounded-lg border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Exactly what we sent, and where
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">{contract.note}</p>
                <p className="mt-2 font-mono text-xs">
                  {contract.method} {contract.endpoint}
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs">
                  {JSON.stringify(contract.payload, null, 2)}
                </pre>
              </details>
            ) : null}
          </section>
        ) : null}

        {/* The trace is replayable from here. Every tick corresponds to a row in
            ai_runs; /admin/ai-runs is the receipt if anyone doubts it. */}
        <div id="pipeline">
          <PipelineTrace
            trackingId={c.trackingId}
            districtCode={c.districtCode}
            replay
            heading="How Milan handled this report"
          />
        </div>

        <section className="mt-8" aria-labelledby="credit-heading" id="credit">
          <h2 id="credit-heading" className="text-lg font-semibold">
            Credit chain
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            We do not stop people from sharing work. We make it impossible to erase who did it. Every
            edge below is also a row in the{" "}
            <Link href={`/ledger?c=${c.trackingId}`} className="text-primary underline underline-offset-4">
              append-only ledger
            </Link>
            , which the database physically refuses to update or delete.
          </p>
          <CreditChain
            trackingId={c.trackingId}
            nodes={credits.map((edge) => ({
              id: edge.id,
              relation: edge.relation,
              name:
                edge.toName ??
                (edge.relation === "ORIGINATOR" ? c.reporterName ?? "Anonymous reporter" : edge.orgName ?? "Anonymous"),
              declaredRole: edge.declaredRole,
              orgName: edge.orgName,
              userId: edge.toUserId,
              at: edge.createdAt,
            }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Team members, mentors, funders and implementers join this chain as the work moves. A report
            merged into this one appears as a corroborator rather than disappearing.
          </p>

          <div className="mt-4">
            <CitationBlock
              citation={citationString(citationInput)}
              bibtex={bibtex(citationInput)}
            />
          </div>
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
