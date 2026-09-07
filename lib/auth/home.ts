import type { Role } from "@/lib/db/schema";

/** Where each role lands on its own — after login, after both OTPs are
 *  verified, or when it clicks its own name in the header. One place so
 *  components/site-header.tsx, app/(auth)/verify-account/page.tsx and
 *  app/(auth)/post-login/page.tsx agree with each other. */
export const HOME_FOR: Record<Role, string> = {
  CITIZEN: "/me",
  HEI_MEMBER: "/hei",
  INDUSTRY: "/industry/discover",
  GOVERNMENT: "/gov",
  ADMIN: "/admin/triage",
  ASSISTED_SUBMITTER: "/me",
  INDEPENDENT_INNOVATOR: "/me",
  EXPERT_PANEL: "/gov",
};
