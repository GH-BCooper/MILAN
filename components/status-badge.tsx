import { Badge } from "@/components/ui/badge";
import type { ChallengeStatus } from "@/lib/db/schema";

/**
 * A status badge always carries its text label. Colour is a second signal, never
 * the only one: this is a government product, it is read on cheap screens in
 * daylight, and a colour-blind official must be able to run a district from it.
 */
export const STATUS_LABEL: Record<ChallengeStatus, string> = {
  SUBMITTED: "Submitted",
  TRIAGED: "Triaged",
  CLASSIFIED: "Classified",
  CLUSTERED: "Clustered",
  PRIORITISED: "Prioritised",
  VERIFIED: "Verified",
  ROUTED: "Routed to institutions",
  CLAIMED: "Claimed by a team",
  PROPOSAL_APPROVED: "Proposal approved",
  IN_RESEARCH: "In research",
  SOLUTION_PUBLISHED: "Solution published",
  INDUSTRY_INTEREST: "Industry interested",
  IMPLEMENTED: "Implementation claimed",
  CITIZEN_VERIFIED: "Confirmed by citizens",
  CLOSED: "Closed",
  REJECTED_UNSAFE: "Rejected as unsafe",
  FORWARDED_EXTERNAL: "Forwarded to CPGRAMS",
  NEEDS_MORE_INFO: "Needs more information",
  MERGED: "Merged into another report",
  UNCLAIMED_ESCALATED: "Unclaimed — escalated",
  BOUNTY_LISTED: "Listed as a bounty",
  AT_RISK: "At risk",
  FORKED: "Forked to another team",
  PARKED: "Parked for annual review",
  WITHDRAWN: "Withdrawn",
  AGREEMENT_SIGNED: "Agreement signed",
  PILOT: "Pilot running",
  DISPUTED: "Disputed",
};

const TONE: Record<ChallengeStatus, string> = {
  SUBMITTED: "bg-slate-500/15 text-slate-200 border-slate-400/40",
  TRIAGED: "bg-slate-500/15 text-slate-200 border-slate-400/40",
  CLASSIFIED: "bg-slate-500/15 text-slate-200 border-slate-400/40",
  CLUSTERED: "bg-slate-500/15 text-slate-200 border-slate-400/40",
  PRIORITISED: "bg-sky-500/15 text-sky-200 border-sky-400/40",
  VERIFIED: "bg-sky-500/15 text-sky-200 border-sky-400/40",
  ROUTED: "bg-indigo-500/15 text-indigo-200 border-indigo-400/40",
  CLAIMED: "bg-indigo-500/15 text-indigo-200 border-indigo-400/40",
  PROPOSAL_APPROVED: "bg-indigo-500/15 text-indigo-200 border-indigo-400/40",
  IN_RESEARCH: "bg-indigo-500/15 text-indigo-200 border-indigo-400/40",
  SOLUTION_PUBLISHED: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  INDUSTRY_INTEREST: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  // Deliberately not green. An implementer's claim is not a confirmation.
  IMPLEMENTED: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  CITIZEN_VERIFIED: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  CLOSED: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  REJECTED_UNSAFE: "bg-red-500/15 text-red-200 border-red-400/40",
  FORWARDED_EXTERNAL: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  NEEDS_MORE_INFO: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  MERGED: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  UNCLAIMED_ESCALATED: "bg-orange-500/15 text-orange-200 border-orange-400/40",
  BOUNTY_LISTED: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  AT_RISK: "bg-orange-500/15 text-orange-200 border-orange-400/40",
  FORKED: "bg-violet-500/15 text-violet-200 border-violet-400/40",
  PARKED: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  WITHDRAWN: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  AGREEMENT_SIGNED: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  PILOT: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  DISPUTED: "bg-red-500/15 text-red-200 border-red-400/40",
};

export function StatusBadge({ status }: { status: ChallengeStatus }) {
  return (
    <Badge variant="outline" className={`font-medium backdrop-blur-md ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
