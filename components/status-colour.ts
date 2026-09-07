import type { ChallengeStatus } from "@/lib/db/schema";

/**
 * Marker colours for the map. Colour is never the only signal — every marker
 * carries its status in its accessible label and the list beside the map spells
 * it out — but a map needs some way to show a hundred points at once.
 */
export const STATUS_COLOUR: Record<ChallengeStatus, string> = {
  SUBMITTED: "#8b96c8",
  TRIAGED: "#8b96c8",
  CLASSIFIED: "#8b96c8",
  CLUSTERED: "#8b96c8",
  PRIORITISED: "#38bdf8",
  VERIFIED: "#38bdf8",
  ROUTED: "#8b7bff",
  CLAIMED: "#8b7bff",
  PROPOSAL_APPROVED: "#8b7bff",
  IN_RESEARCH: "#8b7bff",
  SOLUTION_PUBLISHED: "#34d399",
  INDUSTRY_INTEREST: "#fbbf24",
  IMPLEMENTED: "#a1a1b5",
  CITIZEN_VERIFIED: "#10d9a0",
  CLOSED: "#a1a1b5",
  REJECTED_UNSAFE: "#ff4d6d",
  FORWARDED_EXTERNAL: "#a1a1b5",
  NEEDS_MORE_INFO: "#fbbf24",
  MERGED: "#a1a1b5",
  UNCLAIMED_ESCALATED: "#fb923c",
  BOUNTY_LISTED: "#fbbf24",
  AT_RISK: "#fb923c",
  FORKED: "#c084fc",
  PARKED: "#a1a1b5",
  WITHDRAWN: "#a1a1b5",
  AGREEMENT_SIGNED: "#fbbf24",
  PILOT: "#fbbf24",
  DISPUTED: "#ff4d6d",
};
