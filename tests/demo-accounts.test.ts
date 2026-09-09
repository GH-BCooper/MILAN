import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, demoVerification } from "@/lib/demo/accounts";

const EXPECTED_ROLES = ["CITIZEN", "HEI_MEMBER", "GOVERNMENT", "INDUSTRY", "ADMIN"];

describe("seeded demo accounts", () => {
  it("defines one credential for every demo role", () => {
    expect(DEMO_ACCOUNTS).toHaveLength(EXPECTED_ROLES.length);
    expect(DEMO_ACCOUNTS.map((account) => account.role).sort()).toEqual([...EXPECTED_ROLES].sort());
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.email)).size).toBe(DEMO_ACCOUNTS.length);
  });

  it("uses non-real mock numbers and marks both contact channels verified", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.phone).toMatch(/^\+91999990000[1-5]$/);
      expect(demoVerification(account)).toMatchObject({ emailVerified: true, phoneVerified: true });
    }
  });

  it("pre-approves affiliation only for the organisation-backed roles", () => {
    for (const account of DEMO_ACCOUNTS) {
      const expected = account.role === "HEI_MEMBER" || account.role === "INDUSTRY" ? "APPROVED" : "NOT_APPLICABLE";
      expect(demoVerification(account).orgVerificationStatus).toBe(expected);
      expect(Boolean(account.orgSlug)).toBe(expected === "APPROVED");
    }
  });
});
