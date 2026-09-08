ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "division" text;--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "population" integer;--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "internet_penetration" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "tribal_population_pct" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "disaster_vulnerability" jsonb;