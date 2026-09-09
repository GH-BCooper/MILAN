/**
 * Verify the seeded sign-in credentials and every account gate directly against
 * the database. Run after `pnpm seed`:
 *
 *   pnpm verify:demo-accounts
 */
import { config } from "dotenv";
import postgres from "postgres";

import { verifyPassword } from "better-auth/crypto";
import { DEFAULT_DEMO_PASSWORD, DEMO_ACCOUNTS, demoVerification } from "@/lib/demo/accounts";

config({ path: ".env.local" });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required.");

const password = process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
const failures: string[] = [];

interface AccountRow {
  email: string;
  name: string;
  email_verified: boolean;
  role: string;
  phone: string | null;
  phone_verified: boolean;
  verified_tier: number;
  district_code: string | null;
  org_verification_status: string;
  org_slug: string | null;
  credential_count: number;
  password_hash: string | null;
  membership_count: number;
}

function check(ok: boolean, email: string, field: string, actual: unknown, expected: unknown) {
  if (!ok) failures.push(`${email}: ${field} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
}

try {
  console.log("\nDemo account credentials and verification gates\n" + "-".repeat(72));

  for (const account of DEMO_ACCOUNTS) {
    const [row] = await sql<AccountRow[]>`
      SELECT
        u.email,
        u.name,
        u.email_verified,
        p.role::text,
        p.phone,
        p.phone_verified,
        p.verified_tier,
        p.district_code,
        p.org_verification_status::text,
        o.slug AS org_slug,
        (
          SELECT count(*)::int
          FROM account a
          WHERE a.user_id = u.id AND a.provider_id = 'credential'
        ) AS credential_count,
        (
          SELECT a.password
          FROM account a
          WHERE a.user_id = u.id AND a.provider_id = 'credential'
          ORDER BY a.created_at
          LIMIT 1
        ) AS password_hash,
        (
          SELECT count(*)::int
          FROM member m
          WHERE m.user_id = u.id AND m.organization_id = p.org_id
        ) AS membership_count
      FROM "user" u
      JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN organization o ON o.id = p.org_id
      WHERE u.email = ${account.email}
      LIMIT 1
    `;

    if (!row) {
      failures.push(`${account.email}: account is missing`);
      console.log(`FAIL  ${account.roleLabel.padEnd(14)} ${account.email} — missing`);
      continue;
    }

    const expected = demoVerification(account);
    check(row.name === account.name, account.email, "name", row.name, account.name);
    check(row.role === account.role, account.email, "role", row.role, account.role);
    check(row.email_verified === expected.emailVerified, account.email, "email_verified", row.email_verified, true);
    check(row.phone === account.phone, account.email, "phone", row.phone, account.phone);
    check(row.phone_verified === expected.phoneVerified, account.email, "phone_verified", row.phone_verified, true);
    check(row.verified_tier === expected.verifiedTier, account.email, "verified_tier", row.verified_tier, expected.verifiedTier);
    check(row.district_code === account.districtCode, account.email, "district_code", row.district_code, account.districtCode);
    check(
      row.org_verification_status === expected.orgVerificationStatus,
      account.email,
      "org_verification_status",
      row.org_verification_status,
      expected.orgVerificationStatus,
    );
    check(row.org_slug === account.orgSlug, account.email, "organization", row.org_slug, account.orgSlug);
    check(row.credential_count === 1, account.email, "credential rows", row.credential_count, 1);
    check(
      account.orgSlug === null || row.membership_count === 1,
      account.email,
      "organization membership rows",
      row.membership_count,
      account.orgSlug === null ? "not applicable" : 1,
    );

    const validPassword = row.password_hash ? await verifyPassword({ hash: row.password_hash, password }) : false;
    check(validPassword, account.email, "password", "does not match configured demo password", "valid credential");

    const accountFailed = failures.some((failure) => failure.startsWith(`${account.email}:`));
    console.log(
      `${accountFailed ? "FAIL" : "PASS"}  ${account.roleLabel.padEnd(14)} ${account.email} — email, phone, identity${account.orgSlug ? ", affiliation" : ""}`,
    );
  }
} finally {
  await sql.end();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} demo-account check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`\nPASS  ${DEMO_ACCOUNTS.length}/${DEMO_ACCOUNTS.length} demo credentials are usable and fully verified.`);
