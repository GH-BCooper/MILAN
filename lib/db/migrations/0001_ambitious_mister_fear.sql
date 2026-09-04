CREATE TYPE "public"."challenge_status" AS ENUM('SUBMITTED', 'TRIAGED', 'CLASSIFIED', 'CLUSTERED', 'PRIORITISED', 'VERIFIED', 'ROUTED', 'CLAIMED', 'PROPOSAL_APPROVED', 'IN_RESEARCH', 'SOLUTION_PUBLISHED', 'INDUSTRY_INTEREST', 'IMPLEMENTED', 'CITIZEN_VERIFIED', 'CLOSED', 'REJECTED_UNSAFE', 'FORWARDED_EXTERNAL', 'NEEDS_MORE_INFO', 'MERGED', 'UNCLAIMED_ESCALATED', 'BOUNTY_LISTED', 'AT_RISK', 'FORKED', 'PARKED', 'WITHDRAWN', 'AGREEMENT_SIGNED', 'PILOT', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."domain" AS ENUM('EDUCATION', 'HEALTHCARE', 'AGRICULTURE', 'WATER', 'SANITATION', 'ENVIRONMENT', 'LIVELIHOODS', 'ACCESSIBILITY', 'URBAN_INFRA', 'PUBLIC_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."hazard" AS ENUM('FLOOD', 'DROUGHT', 'LANDSLIDE', 'HEATWAVE', 'MINING_SUBSIDENCE', 'EPIDEMIC', 'FOREST_FIRE', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('PROBLEM_TEXT', 'MEDIA', 'PROPOSAL', 'REPORT', 'STATE_CHANGE', 'CREDIT_EDGE', 'ACCESS', 'OVERRIDE', 'ANCHOR');--> statement-breakpoint
CREATE TYPE "public"."licence" AS ENUM('CC_BY', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('HEI', 'INDUSTRY', 'GOVERNMENT');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CITIZEN', 'HEI_MEMBER', 'INDUSTRY', 'GOVERNMENT', 'ADMIN', 'ASSISTED_SUBMITTER', 'INDEPENDENT_INNOVATOR', 'EXPERT_PANEL');--> statement-breakpoint
CREATE TYPE "public"."sla_kind" AS ENUM('CLAIM_WINDOW', 'WIDEN', 'OPEN_ALL', 'BREACH', 'GRAND_CHALLENGE', 'PROPOSAL_DUE', 'SILENT_30', 'SILENT_45', 'IMPACT_UNCONFIRMED_30', 'ANNUAL_REVIEW');--> statement-breakpoint
CREATE TABLE "access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"user_id" text,
	"org_id" text,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid,
	"stage" text NOT NULL,
	"provider" text,
	"model" text,
	"fallback_level" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3),
	"latency_ms" integer,
	"input_hash" char(64),
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"abstract" text,
	"storage_key" text,
	"content_hash" char(64),
	"licence" "licence" DEFAULT 'CC_BY' NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"reason" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"code" text PRIMARY KEY NOT NULL,
	"district_code" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"vulnerability_index" numeric(3, 2)
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"department" text NOT NULL,
	"lab_name" text,
	"specialisation_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"faculty_name" text,
	"faculty_designation" text,
	"declared_capacity" integer DEFAULT 0 NOT NULL,
	"capacity_from" date,
	"capacity_to" date,
	"embedding" vector(768),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash" char(64) NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"exif_stripped" boolean DEFAULT false NOT NULL,
	"faces_blurred" boolean DEFAULT false NOT NULL,
	"consent_given" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_id" text NOT NULL,
	"status" "challenge_status" DEFAULT 'SUBMITTED' NOT NULL,
	"body_original" text NOT NULL,
	"body_lang" text DEFAULT 'en' NOT NULL,
	"body_en" text,
	"title" text NOT NULL,
	"framed_statement" text,
	"success_criteria" text,
	"framing_approved_by_citizen" boolean DEFAULT false NOT NULL,
	"reporter_id" text,
	"reporter_name" text,
	"assisted_by" text,
	"district_code" text,
	"block_code" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"location_accuracy_m" integer,
	"people_affected" integer,
	"recurrence" text,
	"urgency_self_report" integer,
	"domain" "domain",
	"hazard" "hazard",
	"hazard_strength" numeric(3, 2),
	"severity" numeric(3, 2),
	"priority_score" numeric(6, 3),
	"priority_breakdown" jsonb,
	"scoring_version" text,
	"is_grievance" boolean DEFAULT false NOT NULL,
	"forwarded_ref" text,
	"cluster_id" uuid,
	"is_parent" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"corroboration_count" integer DEFAULT 1 NOT NULL,
	"official_endorsed" boolean DEFAULT false NOT NULL,
	"endorsed_by" text,
	"capital_works" boolean DEFAULT false NOT NULL,
	"solvability" text,
	"embedding" vector(768),
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body_en, '') || ' ' || body_original)) STORED,
	"impact_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_tracking_id_unique" UNIQUE("tracking_id")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_challenge_id" uuid NOT NULL,
	"block_code" text,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corroborations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"user_id" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"distance_km" numeric(8, 3),
	"weight" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"device_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"org_id" text,
	"relation" text NOT NULL,
	"declared_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"clock_offset_days" integer DEFAULT 0 NOT NULL,
	"emergency_mode" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"vulnerability_index" numeric(3, 2)
);
--> statement-breakpoint
CREATE TABLE "industry_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"message" text,
	"state" text DEFAULT 'EXPRESSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"challenge_id" uuid,
	"project_id" uuid,
	"kind" "ledger_kind" NOT NULL,
	"content_hash" char(64) NOT NULL,
	"prev_hash" char(64),
	"entry_hash" char(64),
	"author_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"org_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"action_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations_meta" (
	"org_id" text PRIMARY KEY NOT NULL,
	"org_type" "org_type" NOT NULL,
	"hei_code" text,
	"district_code" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"website" text
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"declared_role" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"lead_user_id" text,
	"mentor_user_id" text,
	"title" text NOT NULL,
	"ip_track" text DEFAULT 'OPEN' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"forked_from" uuid
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"capability_id" uuid,
	"rank" integer NOT NULL,
	"match_score" numeric(6, 3),
	"reason_text" text,
	"reason_terms" jsonb,
	"notified_at" timestamp with time zone,
	"claim_window_ends_at" timestamp with time zone,
	"state" text DEFAULT 'OFFERED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" "sla_kind" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" "role" DEFAULT 'CITIZEN' NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"preferred_lang" text DEFAULT 'en' NOT NULL,
	"district_code" text,
	"block_code" text,
	"trust_score" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"verified_tier" integer DEFAULT 1 NOT NULL,
	"org_id" text
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_district_code_districts_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."districts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_media" ADD CONSTRAINT "challenge_media_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_assisted_by_user_id_fk" FOREIGN KEY ("assisted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_district_code_districts_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."districts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_block_code_blocks_code_fk" FOREIGN KEY ("block_code") REFERENCES "public"."blocks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_endorsed_by_user_id_fk" FOREIGN KEY ("endorsed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_parent_challenge_id_challenges_id_fk" FOREIGN KEY ("parent_challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_block_code_blocks_code_fk" FOREIGN KEY ("block_code") REFERENCES "public"."blocks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corroborations" ADD CONSTRAINT "corroborations_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corroborations" ADD CONSTRAINT "corroborations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_edges" ADD CONSTRAINT "credit_edges_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_edges" ADD CONSTRAINT "credit_edges_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_edges" ADD CONSTRAINT "credit_edges_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_edges" ADD CONSTRAINT "credit_edges_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_interests" ADD CONSTRAINT "industry_interests_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_interests" ADD CONSTRAINT "industry_interests_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_interests" ADD CONSTRAINT "industry_interests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations_meta" ADD CONSTRAINT "organisations_meta_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations_meta" ADD CONSTRAINT "organisations_meta_district_code_districts_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."districts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_mentor_user_id_user_id_fk" FOREIGN KEY ("mentor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_deadlines" ADD CONSTRAINT "sla_deadlines_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_deadlines" ADD CONSTRAINT "sla_deadlines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_district_code_districts_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."districts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_block_code_blocks_code_fk" FOREIGN KEY ("block_code") REFERENCES "public"."blocks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_artifact_idx" ON "access_log" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "ai_runs_challenge_idx" ON "ai_runs" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "ai_runs_stage_idx" ON "ai_runs" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "ai_runs_input_hash_idx" ON "ai_runs" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "blocks_district_idx" ON "blocks" USING btree ("district_code");--> statement-breakpoint
CREATE INDEX "capabilities_org_idx" ON "capabilities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "capabilities_tags_idx" ON "capabilities" USING gin ("specialisation_tags");--> statement-breakpoint
CREATE INDEX "capabilities_active_idx" ON "capabilities" USING btree ("active");--> statement-breakpoint
CREATE INDEX "challenge_media_challenge_idx" ON "challenge_media" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "challenges_tracking_idx" ON "challenges" USING btree ("tracking_id");--> statement-breakpoint
CREATE INDEX "challenges_status_idx" ON "challenges" USING btree ("status");--> statement-breakpoint
CREATE INDEX "challenges_district_idx" ON "challenges" USING btree ("district_code");--> statement-breakpoint
CREATE INDEX "challenges_block_idx" ON "challenges" USING btree ("block_code");--> statement-breakpoint
CREATE INDEX "challenges_domain_idx" ON "challenges" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "challenges_hazard_idx" ON "challenges" USING btree ("hazard");--> statement-breakpoint
CREATE INDEX "challenges_cluster_idx" ON "challenges" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "challenges_search_idx" ON "challenges" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "challenges_title_trgm_idx" ON "challenges" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clusters_block_idx" ON "clusters" USING btree ("block_code");--> statement-breakpoint
CREATE UNIQUE INDEX "corroborations_challenge_user_uniq" ON "corroborations" USING btree ("challenge_id","user_id");--> statement-breakpoint
CREATE INDEX "corroborations_challenge_idx" ON "corroborations" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "credit_edges_challenge_idx" ON "credit_edges" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "credit_edges_to_user_idx" ON "credit_edges" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "industry_interests_challenge_idx" ON "industry_interests" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "industry_interests_org_idx" ON "industry_interests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_seq_idx" ON "ledger_entries" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "ledger_entries_challenge_idx" ON "ledger_entries" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_kind_idx" ON "ledger_entries" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organisations_meta_type_idx" ON "organisations_meta" USING btree ("org_type");--> statement-breakpoint
CREATE INDEX "organisations_meta_district_idx" ON "organisations_meta" USING btree ("district_code");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("created_at") WHERE processed_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_uniq" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "projects_challenge_idx" ON "projects" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "routes_challenge_idx" ON "routes" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "routes_org_idx" ON "routes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "routes_state_idx" ON "routes" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sla_deadlines_open_due_idx" ON "sla_deadlines" USING btree ("due_at") WHERE fired_at IS NULL AND cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX "sla_deadlines_challenge_idx" ON "sla_deadlines" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "user_profiles_role_idx" ON "user_profiles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "user_profiles_district_idx" ON "user_profiles" USING btree ("district_code");