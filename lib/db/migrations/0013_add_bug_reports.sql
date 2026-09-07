CREATE TYPE "public"."bug_report_type" AS ENUM('UI_VISUAL', 'CRASH_ERROR', 'INCORRECT_DATA', 'PERFORMANCE', 'OTHER');--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" text,
	"type" "bug_report_type" NOT NULL,
	"issue" text NOT NULL,
	"photo_key" text,
	"page_url" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_reports_status_idx" ON "bug_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bug_reports_created_idx" ON "bug_reports" USING btree ("created_at");