CREATE TYPE "public"."org_verification_status" AS ENUM('NOT_APPLICABLE', 'PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_verification_status" "org_verification_status" DEFAULT 'NOT_APPLICABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_proof_type" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_proof_meta" jsonb;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_proof_document_key" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_verification_reason" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_verification_decided_by" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "org_verification_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_org_verification_decided_by_user_id_fk" FOREIGN KEY ("org_verification_decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;