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

/**
 * Tone families. Each entry names a colour that renders with real contrast in
 * BOTH skins — dark text on a pale wash in light mode, pale text in dark mode.
 * The earlier map used `text-*-200` unconditionally, which is invisible on the
 * light ground the block officer actually uses.
 */
type Tone = "neutral" | "sky" | "indigo" | "emerald" | "amber" | "orange" | "violet" | "red";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-slate-500/12 text-slate-700 border-slate-400/40 dark:bg-slate-500/15 dark:text-slate-200",
  sky: "bg-sky-500/12 text-sky-800 border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-200",
  indigo: "bg-indigo-500/12 text-indigo-800 border-indigo-400/40 dark:bg-indigo-500/15 dark:text-indigo-200",
  emerald: "bg-emerald-500/12 text-emerald-800 border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  amber: "bg-amber-500/15 text-amber-800 border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  orange: "bg-orange-500/15 text-orange-800 border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-200",
  violet: "bg-violet-500/12 text-violet-800 border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200",
  red: "bg-red-500/12 text-red-800 border-red-400/40 dark:bg-red-500/15 dark:text-red-200",
};

const TONE: Record<ChallengeStatus, Tone> = {
  SUBMITTED: "neutral",
  TRIAGED: "neutral",
  CLASSIFIED: "neutral",
  CLUSTERED: "neutral",
  PRIORITISED: "sky",
  VERIFIED: "sky",
  ROUTED: "indigo",
  CLAIMED: "indigo",
  PROPOSAL_APPROVED: "indigo",
  IN_RESEARCH: "indigo",
  SOLUTION_PUBLISHED: "emerald",
  INDUSTRY_INTEREST: "amber",
  // Deliberately not green. An implementer's claim is not a confirmation.
  IMPLEMENTED: "neutral",
  CITIZEN_VERIFIED: "emerald",
  CLOSED: "neutral",
  REJECTED_UNSAFE: "red",
  FORWARDED_EXTERNAL: "neutral",
  NEEDS_MORE_INFO: "amber",
  MERGED: "neutral",
  UNCLAIMED_ESCALATED: "orange",
  BOUNTY_LISTED: "amber",
  AT_RISK: "orange",
  FORKED: "violet",
  PARKED: "neutral",
  WITHDRAWN: "neutral",
  AGREEMENT_SIGNED: "amber",
  PILOT: "amber",
  DISPUTED: "red",
};

export function StatusBadge({ status }: { status: ChallengeStatus }) {
  return (
    <Badge variant="outline" className={`font-medium backdrop-blur-md ${TONE_CLASS[TONE[status]]}`}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
