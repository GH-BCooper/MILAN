ALTER TABLE "districts" ADD COLUMN "division" text;--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN "population" integer;--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN "internet_penetration" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN "tribal_population_pct" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "districts" ADD COLUMN "disaster_vulnerability" jsonb;