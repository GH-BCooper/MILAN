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
  SUBMITTED: "bg-slate-100 text-slate-900 border-slate-300",
  TRIAGED: "bg-slate-100 text-slate-900 border-slate-300",
  CLASSIFIED: "bg-slate-100 text-slate-900 border-slate-300",
  CLUSTERED: "bg-slate-100 text-slate-900 border-slate-300",
  PRIORITISED: "bg-sky-100 text-sky-900 border-sky-300",
  VERIFIED: "bg-sky-100 text-sky-900 border-sky-300",
  ROUTED: "bg-indigo-100 text-indigo-900 border-indigo-300",
  CLAIMED: "bg-indigo-100 text-indigo-900 border-indigo-300",
  PROPOSAL_APPROVED: "bg-indigo-100 text-indigo-900 border-indigo-300",
  IN_RESEARCH: "bg-indigo-100 text-indigo-900 border-indigo-300",
  SOLUTION_PUBLISHED: "bg-emerald-100 text-emerald-900 border-emerald-300",
  INDUSTRY_INTEREST: "bg-amber-100 text-amber-900 border-amber-300",
  // Deliberately not green. An implementer's claim is not a confirmation.
  IMPLEMENTED: "bg-neutral-200 text-neutral-800 border-neutral-400",
  CITIZEN_VERIFIED: "bg-emerald-200 text-emerald-950 border-emerald-500",
  CLOSED: "bg-neutral-200 text-neutral-800 border-neutral-400",
  REJECTED_UNSAFE: "bg-red-100 text-red-900 border-red-300",
  FORWARDED_EXTERNAL: "bg-neutral-200 text-neutral-800 border-neutral-400",
  NEEDS_MORE_INFO: "bg-amber-100 text-amber-900 border-amber-300",
  MERGED: "bg-neutral-200 text-neutral-800 border-neutral-400",
  UNCLAIMED_ESCALATED: "bg-orange-100 text-orange-900 border-orange-300",
  BOUNTY_LISTED: "bg-amber-100 text-amber-900 border-amber-300",
  AT_RISK: "bg-orange-100 text-orange-900 border-orange-300",
  FORKED: "bg-violet-100 text-violet-900 border-violet-300",
  PARKED: "bg-neutral-200 text-neutral-800 border-neutral-400",
  WITHDRAWN: "bg-neutral-200 text-neutral-800 border-neutral-400",
  AGREEMENT_SIGNED: "bg-amber-100 text-amber-900 border-amber-300",
  PILOT: "bg-amber-100 text-amber-900 border-amber-300",
  DISPUTED: "bg-red-100 text-red-900 border-red-300",
};

export function StatusBadge({ status }: { status: ChallengeStatus }) {
  return (
    <Badge variant="outline" className={`font-medium ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
