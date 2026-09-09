/**
 * The seeded personas used by the demo, QA scripts and the sign-in helper.
 *
 * Keep this list free of secrets: it is imported by a client component for the
 * demo-only account picker. The shared password stays server-side and is only
 * passed to that picker when DEMO_MODE=true.
 */
export const DEFAULT_DEMO_PASSWORD = "milan2026";

export const DEMO_ACCOUNTS = [
  {
    email: "sunita@demo.milan.in",
    name: "Sunita Devi",
    role: "CITIZEN",
    roleLabel: "Citizen",
    districtCode: "GUM",
    orgSlug: null,
    phone: "+919999900001",
    home: "/me",
    description: "Reports the cracked embankment and confirms the fix.",
  },
  {
    email: "hod.civil@bitsindri.demo.milan.in",
    name: "Head of Civil Engineering, BIT Sindri",
    role: "HEI_MEMBER",
    roleLabel: "University",
    districtCode: "DHN",
    orgSlug: "bit-sindri",
    phone: "+919999900002",
    home: "/hei",
    description: "Claims routed challenges for BIT Sindri Civil Engineering.",
  },
  {
    email: "dc.gumla@jh.gov.demo.milan.in",
    name: "Deputy Commissioner, Gumla",
    role: "GOVERNMENT",
    roleLabel: "Government",
    districtCode: "GUM",
    orgSlug: null,
    phone: "+919999900003",
    home: "/gov",
    description: "Reviews government work within the Gumla district scope.",
  },
  {
    email: "csr@tatasteelfoundation.demo.milan.in",
    name: "CSR Lead, Tata Steel Foundation",
    role: "INDUSTRY",
    roleLabel: "Industry",
    districtCode: "ESB",
    orgSlug: "tata-steel-foundation",
    phone: "+919999900004",
    home: "/industry/discover",
    description: "Discovers solutions and expresses CSR interest.",
  },
  {
    email: "admin@milan.demo.milan.in",
    name: "Milan Administrator",
    role: "ADMIN",
    roleLabel: "Administrator",
    districtCode: null,
    orgSlug: null,
    phone: "+919999900005",
    home: "/admin/triage",
    description: "Runs triage, routing and the demo console.",
  },
] as const;

export type DemoAccount = (typeof DEMO_ACCOUNTS)[number];

/**
 * Demo personas bypass registration-time OTP and affiliation review. This is
 * the single definition used by the seed and its verification script so an
 * idempotent re-seed also repairs an older, partially verified account.
 */
export function demoVerification(account: DemoAccount) {
  const hasApprovedAffiliation = account.role === "HEI_MEMBER" || account.role === "INDUSTRY";

  return {
    emailVerified: true,
    phoneVerified: true,
    verifiedTier: account.role === "CITIZEN" ? 2 : 3,
    orgVerificationStatus: hasApprovedAffiliation ? ("APPROVED" as const) : ("NOT_APPLICABLE" as const),
  };
}
