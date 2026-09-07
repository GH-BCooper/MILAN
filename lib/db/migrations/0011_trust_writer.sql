-- Phase 4: the trust score gets a writer (lib/credit/trust-writers.ts).
--
-- Loophole row 7 declared the decaying trust score "columns and no writer".
-- This migration adds the one column the writer needs beyond what exists:
-- a marker for when trust was last decayed, so the nightly job decays exactly
-- the elapsed days whether it runs twice in one night or not at all for a week.
-- Same reasoning as clock_offset_days living on this table.

ALTER TABLE "demo_state" ADD COLUMN "trust_decayed_at" timestamp with time zone;
--> statement-breakpoint
COMMENT ON COLUMN user_profiles.trust_score IS
  'Reporter trust, 0.00-1.00, baseline 0.50. Earned only at CITIZEN_VERIFIED events (report +0.10, corroboration +0.05, merge credit +0.03), lost sharply on REJECTED_UNSAFE (-0.20), decayed toward baseline nightly (0.97^days). Written ONLY by lib/credit/trust-writers.ts. Loophole row 7.';
