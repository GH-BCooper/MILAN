CREATE TABLE IF NOT EXISTS "challenge_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"parent_comment_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- NOTE: this generate also re-emitted `demo_state.trust_decayed_at` because the
-- 0011 snapshot predated that column. The statement is removed here on purpose:
-- 0011_trust_writer.sql already applies it, and a second, non-idempotent ADD
-- COLUMN would fail every database that already migrated.
DO $$ BEGIN
  ALTER TABLE "challenge_comments" ADD CONSTRAINT "challenge_comments_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "challenge_comments" ADD CONSTRAINT "challenge_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "challenge_comments" ADD CONSTRAINT "challenge_comments_parent_comment_id_challenge_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."challenge_comments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challenge_comments_challenge_idx" ON "challenge_comments" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challenge_comments_user_idx" ON "challenge_comments" USING btree ("user_id");