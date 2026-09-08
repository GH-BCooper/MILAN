-- 0014 — Smart Education re-theme (PS 26043, Dept. of Higher & Technical Education).
--
-- The platform was built framing every challenge as a disaster-risk item with
-- an NDMA hazard linkage. The actual problem statement is a multi-domain
-- societal-challenges portal: citizens report problems across education,
-- health, agriculture, water, sanitation, environment, energy, livelihoods,
-- accessibility, urban infrastructure and public services, and universities
-- plus industry solve them. The hazard model has no place in that PS, so it
-- goes away entirely rather than being left as a dead column judges would ask
-- about:
--
--   * challenges.hazard / challenges.hazard_strength + its index + the hazard
--     enum type itself (S2 no longer classifies a hazard; S4 scores six terms).
--   * districts.disaster_vulnerability (the per-hazard JSONB map).
--   * demo_state.emergency_mode / demo_state.emergency_hazard (Emergency Mode,
--     the hazard-pinned SLA compression feature, is deleted with it).
--   * domain gains ENERGY, which the PS lists and the old enum lacked.
--
-- The domain change uses the rename-and-recast pattern rather than ALTER TYPE
-- ... ADD VALUE, because ADD VALUE cannot run inside a transaction block and
-- drizzle-kit migrate wraps each file in one.
DROP INDEX IF EXISTS "challenges_hazard_idx";--> statement-breakpoint
ALTER TABLE "challenges" DROP COLUMN IF EXISTS "hazard_strength";--> statement-breakpoint
ALTER TABLE "challenges" DROP COLUMN IF EXISTS "hazard";--> statement-breakpoint
ALTER TABLE "districts" DROP COLUMN IF EXISTS "disaster_vulnerability";--> statement-breakpoint
ALTER TABLE "demo_state" DROP COLUMN IF EXISTS "emergency_mode";--> statement-breakpoint
ALTER TABLE "demo_state" DROP COLUMN IF EXISTS "emergency_hazard";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."hazard";--> statement-breakpoint
ALTER TYPE "public"."domain" RENAME TO "domain_old";--> statement-breakpoint
CREATE TYPE "public"."domain" AS ENUM('EDUCATION', 'HEALTHCARE', 'AGRICULTURE', 'WATER', 'SANITATION', 'ENVIRONMENT', 'ENERGY', 'LIVELIHOODS', 'ACCESSIBILITY', 'URBAN_INFRA', 'PUBLIC_SERVICE');--> statement-breakpoint
ALTER TABLE "challenges" ALTER COLUMN "domain" TYPE "public"."domain" USING "domain"::text::"public"."domain";--> statement-breakpoint
DROP TYPE "public"."domain_old";
