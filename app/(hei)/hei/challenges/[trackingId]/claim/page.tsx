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
import { capabilitiesFor, offerFor } from "@/lib/hei/queries";
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

  const [offer, caps] = await Promise.all([
    offerFor(user.orgId, trackingId),
    capabilitiesFor(user.orgId),
  ]);

  if (!offer) {
    return (
      <RoleShell title={trackingId} subtitle="Not available to claim.">
        <div className="rounded-lg border border-border p-6">
          <p className="text-sm font-medium">
            This challenge is not currently offered to your institution.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Either another institution has already claimed it, the claim window has closed, or it
            is still waiting for a District Collector to release it. Nothing is lost — the public
            page shows exactly where it stands.
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

  const breakdown = parseBreakdown(offer.priorityBreakdown);
  const withCapacity = caps.filter((c) => c.active);
  const serverNow = clockNow().toISOString();

  return (
    <RoleShell
      title={offer.title}
      subtitle={`${trackingId} · ${offer.districtName ?? "district not given"} · routed to you at rank ${offer.rank} of 3`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={offer.status as ChallengeStatus} />
        {offer.domain ? (
          <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium">
            {offer.domain.replaceAll("_", " ")}
          </span>
        ) : null}
        {offer.hazard && offer.hazard !== "NONE" ? (
          <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            {offer.hazard.replaceAll("_", " ")}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {offer.corroborationCount} report{offer.corroborationCount === 1 ? "" : "s"}
        </span>
        {offer.claimWindowEndsAt ? (
          <span className="ms-auto text-sm">
            Closes in <ClaimCountdown endsAt={offer.claimWindowEndsAt.toISOString()}
                        serverNow={serverNow} />
          </span>
        ) : null}
      </div>

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Why you</h2>
        <p className="mt-1 text-sm">{offer.reasonText}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {offer.department}
          {offer.labName ? ` · ${offer.labName}` : ""}
          {offer.matchScore !== null ? ` · match score ${offer.matchScore.toFixed(3)}` : ""} · this
          sentence was written from the three scoring terms and nothing else.
        </p>
      </section>

      {/* Invariant 6. The citizen's own words at the same size as our copy,
          on an internal screen as much as a public one. */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <article className="rounded-lg border border-border p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
            As it was reported {offer.bodyLang !== "en" ? `(${offer.bodyLang})` : ""}
          </h2>
          <p lang={offer.bodyLang} className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
            {offer.bodyOriginal}
          </p>
        </article>
        <article className="rounded-lg border border-border p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
            {offer.framedStatement ? "The research problem" : "English working copy"}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
            {offer.framedStatement ?? offer.bodyEn ?? "Not translated yet."}
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
          Claiming closes the offer to the other two institutions and starts the clock. Everything
          below is written to the permanent credit record.
        </p>
        <div className="mt-4">
          <ClaimForm
            trackingId={trackingId}
            challengeTitle={offer.title}
            reporterName={null}
            capabilities={withCapacity.map((c) => ({
              id: c.id,
              label: [c.department, c.labName].filter(Boolean).join(" · "),
              declaredCapacity: c.declaredCapacity,
            }))}
            defaultCapabilityId={offer.capabilityId ?? withCapacity[0]?.id ?? ""}
            defaultMentorName={user.fullName}
            defaultMentorEmail={user.email}
          />
        </div>
      </section>
    </RoleShell>
  );
}
