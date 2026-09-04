import type { ChallengeStatus } from "@/lib/db/schema";

/**
 * Marker colours for the map. Colour is never the only signal — every marker
 * carries its status in its accessible label and the list beside the map spells
 * it out — but a map needs some way to show a hundred points at once.
 */
export const STATUS_COLOUR: Record<ChallengeStatus, string> = {
  SUBMITTED: "#64748b",
  TRIAGED: "#64748b",
  CLASSIFIED: "#64748b",
  CLUSTERED: "#64748b",
  PRIORITISED: "#0284c7",
  VERIFIED: "#0284c7",
  ROUTED: "#4f46e5",
  CLAIMED: "#4f46e5",
  PROPOSAL_APPROVED: "#4f46e5",
  IN_RESEARCH: "#4f46e5",
  SOLUTION_PUBLISHED: "#059669",
  INDUSTRY_INTEREST: "#d97706",
  IMPLEMENTED: "#78716c",
  CITIZEN_VERIFIED: "#047857",
  CLOSED: "#78716c",
  REJECTED_UNSAFE: "#b91c1c",
  FORWARDED_EXTERNAL: "#78716c",
  NEEDS_MORE_INFO: "#d97706",
  MERGED: "#78716c",
  UNCLAIMED_ESCALATED: "#ea580c",
  BOUNTY_LISTED: "#d97706",
  AT_RISK: "#ea580c",
  FORKED: "#7c3aed",
  PARKED: "#78716c",
  WITHDRAWN: "#78716c",
  AGREEMENT_SIGNED: "#d97706",
  PILOT: "#d97706",
  DISPUTED: "#b91c1c",
};
