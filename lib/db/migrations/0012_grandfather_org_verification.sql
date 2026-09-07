-- Data-only migration, no schema change.
--
-- 0011 added `org_verification_status` (default 'NOT_APPLICABLE') and
-- `requireRole()` in lib/auth/guards.ts now redirects any HEI_MEMBER/INDUSTRY
-- account whose status is not 'APPROVED' to /verify-account/pending. Every
-- HEI/Industry row that already existed before this migration was seeded or
-- registered under the old rules, with no proof-of-affiliation flow to have
-- passed — grandfathering them to APPROVED preserves the documented demo
-- credentials (e.g. hod.civil@bitsindri.demo.milan.in,
-- csr@tatasteelfoundation.demo.milan.in) rather than silently locking them out.
-- Only accounts registered from this point forward start at PENDING.

UPDATE "user_profiles"
SET "org_verification_status" = 'APPROVED'
WHERE "role" IN ('HEI_MEMBER', 'INDUSTRY')
  AND "org_verification_status" = 'NOT_APPLICABLE';
