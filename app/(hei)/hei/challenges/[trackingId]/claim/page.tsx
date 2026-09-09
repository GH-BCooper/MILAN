/**
 * /hei/challenges/[trackingId]/claim — reached straight from the notification.
 *
 * The URL carries the tracking ID rather than a UUID (PHASE_2_BUILD.md writes
 * it as `[id]`): it is the identifier a person can read out over a phone, it is
 * what the email says, and a professor forwarding the link to a colleague sends
 * something legible rather than a UUID.
 *
 * "Push, never browse" only means anything if this page is complete on its own.
 * A professor who lands here has never seen the inbox and should not need to:
 * the problem, the citizen's own words, the routing reason, the whole priority
 * breakdown and the claim form are all here.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClaimCountdown } from "@/components/claim-countdown";
import { PriorityBreakdown } from "@/components/priority-breakdown";
import { parseBreakdown } from "@/packages/scoring";
import { RoleShell } from "@/components/role-shell";
import { StatusBadge } from "@/components/status-badge";
import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { isOpenClaimable } from "@/lib/db/stateMachine";
import { capabilitiesFor, challengeForClaim, offerFor } from "@/lib/hei/queries";
import type { ChallengeStatus } from "@/lib/db/schema";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  return { title: `Claim ${decodeURIComponent(trackingId).toUpperCase()}` };
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ trackingId: string }>;
}) {
  const { trackingId: raw } = await params;
  const trackingId = decodeURIComponent(raw).toUpperCase();

  const user = await requireRole("HEI_MEMBER");
  if (!user.orgId) notFound();

  const [offer, challenge, caps] = await Promise.all([
    offerFor(user.orgId, trackingId),
    challengeForClaim(trackingId),
    capabilitiesFor(user.orgId),
  ]);

  // Open claiming: no routed offer is fine when the challenge itself is
  // claimable — safety triage cleared it, or it is untriaged with severity
  // above the 0.30 bar. The panel below is only for work that genuinely
  // cannot be taken: too mild to claim before triage, or already claimed.
  const openlyClaimable =
    challenge !== null &&
    isOpenClaimable(challenge.status as ChallengeStatus, challenge.severity);

  if (!offer && !openlyClaimable) {
    return (
      <RoleShell title={trackingId} subtitle="Not available to claim.">
        <div className="milan-glass rounded-xl p-6">
          <p className="text-sm font-medium">
            This challenge cannot be claimed right now.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Either another institution has already claimed it, the claim window has closed, or it
            is still being checked and its severity is 0.30 or below — problems become claimable
            the moment triage clears them, or as soon as a severity above 0.30 is recorded.
            Nothing is lost — the public page shows exactly where it stands.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/c/${trackingId}`}
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              See the public page
            </Link>
            <Link
              href="/hei/inbox"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Your inbox
            </Link>
          </div>
        </div>
      </RoleShell>
    );
  }

  // One view for both paths: a routed offer carries its rank, reason and window;
  // an open claim carries the challenge on its own.
  const view = offer ?? {
    ...challenge!,
    rank: 0,
    matchScore: null,
    reasonText: null as string | null,
    claimWindowEndsAt: null,
    department: null as string | null,
    labName: null as string | null,
    capabilityId: null as string | null,
  };

  const breakdown = parseBreakdown(view.priorityBreakdown);
  const withCapacity = caps.filter((c) => c.active);
  const serverNow = clockNow().toISOString();

  return (
    <RoleShell
      title={view.title}
      subtitle={
        offer
          ? `${trackingId} · ${view.districtName ?? "district not given"} · routed to you at rank ${offer.rank} of 3`
          : `${trackingId} · ${view.districtName ?? "district not given"} · open claim — your institution was not routed an offer, and that no longer matters`
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={view.status as ChallengeStatus} />
        {view.domain ? (
          <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
            {view.domain.replaceAll("_", " ")}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {view.corroborationCount} report{view.corroborationCount === 1 ? "" : "s"}
        </span>
        {view.claimWindowEndsAt ? (
          <span className="ms-auto text-sm">
            Closes in <ClaimCountdown endsAt={view.claimWindowEndsAt.toISOString()}
                        serverNow={serverNow} />
          </span>
        ) : null}
      </div>

      {offer ? (
        <section className="mt-6 milan-glass rounded-xl p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Why you</h2>
          <p className="mt-1 text-sm">{offer.reasonText}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {offer.department}
            {offer.labName ? ` · ${offer.labName}` : ""}
            {offer.matchScore !== null ? ` · match score ${offer.matchScore.toFixed(3)}` : ""} · this
            sentence was written from the three scoring terms and nothing else.
          </p>
        </section>
      ) : (
        <section className="mt-6 milan-glass rounded-xl p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Open claim</h2>
          <p className="mt-1 text-sm">
            Any institution can take any problem once safety triage has cleared it — or while
            it is still untriaged when its severity is above 0.30. Not just the three the
            router shortlisted. The first team with declared capacity and a university email
            takes it; claiming closes every open offer on it.
          </p>
        </section>
      )}

      {/* Invariant 6. The citizen's own words at the same size as our copy,
          on an internal screen as much as a public one. */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <article className="milan-glass rounded-xl p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
            As it was reported {view.bodyLang !== "en" ? `(${view.bodyLang})` : ""}
          </h2>
          <p lang={view.bodyLang} className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
            {view.bodyOriginal}
          </p>
        </article>
        <article className="milan-glass rounded-xl p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
            {view.framedStatement ? "The research problem" : "English working copy"}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
            {view.framedStatement ?? view.bodyEn ?? "Not translated yet."}
          </p>
        </article>
      </section>

      {breakdown ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Why this problem is ranked where it is</h2>
          <div className="mt-2">
            <PriorityBreakdown score={breakdown} trackingId={trackingId} districtCode={null} />
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Claim it</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {offer
            ? "Claiming closes the offer to the other institutions and starts the clock. Everything below is written to the permanent credit record."
            : "Claiming closes every open offer on this problem and starts the clock. Everything below is written to the permanent credit record."}
        </p>
        <div className="mt-4">
          <ClaimForm
            trackingId={trackingId}
            challengeTitle={view.title}
            reporterName={null}
            capabilities={withCapacity.map((c) => ({
              id: c.id,
              label: [c.department, c.labName].filter(Boolean).join(" · "),
              declaredCapacity: c.declaredCapacity,
            }))}
            defaultCapabilityId={view.capabilityId ?? withCapacity[0]?.id ?? ""}
            defaultMentorName={user.fullName}
            defaultMentorEmail={user.email}
          />
        </div>
      </section>
    </RoleShell>
  );
}
