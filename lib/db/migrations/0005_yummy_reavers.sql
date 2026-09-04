CREATE TABLE "ai_cache" (
	"key" char(64) PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"fallback_level" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3),
	"latency_ms" integer,
	"output" jsonb NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid,
	"stage" text NOT NULL,
	"input_text" text,
	"input_hash" char(64),
	"proposed" jsonb,
	"corrected" jsonb,
	"reason" text,
	"corrected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_corrections" ADD CONSTRAINT "training_corrections_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_corrections" ADD CONSTRAINT "training_corrections_corrected_by_user_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_cache_stage_idx" ON "ai_cache" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "training_corrections_stage_idx" ON "training_corrections" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "training_corrections_challenge_idx" ON "training_corrections" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "capabilities_embedding_hnsw_idx" ON "capabilities" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "challenges_embedding_hnsw_idx" ON "challenges" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "challenges_parent_idx" ON "challenges" USING btree ("parent_id");