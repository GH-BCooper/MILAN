ALTER TYPE "public"."sla_kind" ADD VALUE 'STAGE_TIMEOUT';--> statement-breakpoint
ALTER TYPE "public"."sla_kind" ADD VALUE 'GATE_TIMEOUT';--> statement-breakpoint
ALTER TYPE "public"."sla_kind" ADD VALUE 'CLOSURE_DUE';--> statement-breakpoint
ALTER TYPE "public"."sla_kind" ADD VALUE 'DISPUTE_REVIEW';--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"requester_id" text NOT NULL,
	"org_id" text,
	"purpose" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impact_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"user_id" text,
	"answer" text NOT NULL,
	"note" text,
	"photo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "impact_partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "impact_disputed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "citizen_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "citizen_verification_note" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "sla_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "escalation_stage" text;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "open_to_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "grand_challenge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "fork_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "at_risk_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_state" ADD COLUMN IF NOT EXISTS "emergency_hazard" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_confirmations" ADD CONSTRAINT "impact_confirmations_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_confirmations" ADD CONSTRAINT "impact_confirmations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_artifact_idx" ON "access_requests" USING btree ("artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_uniq" ON "access_requests" USING btree ("artifact_id","requester_id");--> statement-breakpoint
CREATE INDEX "impact_confirmations_challenge_idx" ON "impact_confirmations" USING btree ("challenge_id");