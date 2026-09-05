-- PHASE_3_BUILD.md Task 3.9 step 4: add missing indexes, do not add a cache layer.
--
-- These are the four predicates Phase 3's new pages actually filter on, measured
-- rather than guessed: /gov joins routes to challenges by state, /gov/sla and the
-- DC dashboard scan for breaches, /bounties scans the escalation flags, and every
-- impact counter reads impact_confirmed. All four are partial where the matching
-- set is a small fraction of the table, so the indexes stay small however many
-- challenges are closed.

CREATE INDEX IF NOT EXISTS routes_challenge_state_idx ON routes (challenge_id, state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS challenges_breached_idx ON challenges (sla_breached_at)
  WHERE sla_breached_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS challenges_escalated_idx ON challenges (escalation_stage, priority_score DESC)
  WHERE escalation_stage IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS challenges_open_to_all_idx ON challenges (priority_score DESC)
  WHERE open_to_all OR grand_challenge;
--> statement-breakpoint
-- Invariant 7's counter, scoped to a district on /gov.
CREATE INDEX IF NOT EXISTS challenges_impact_idx ON challenges (district_code)
  WHERE impact_confirmed OR impact_disputed;
--> statement-breakpoint
-- The reaper's join back to the challenge, and /gov/sla's per-kind rollup.
CREATE INDEX IF NOT EXISTS sla_deadlines_kind_open_idx ON sla_deadlines (kind, due_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sla_deadlines_fired_idx ON sla_deadlines (fired_at DESC)
  WHERE fired_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS access_log_user_idx ON access_log (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS industry_interests_state_idx ON industry_interests (org_id, state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ledger_entries_project_idx ON ledger_entries (project_id) WHERE project_id IS NOT NULL;
