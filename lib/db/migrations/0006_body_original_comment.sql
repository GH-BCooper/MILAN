-- PHASE_2_BUILD.md Task 2.7 step 3.
--
-- Invariant 6, written where a DBA reading the schema will see it rather than
-- only in TypeScript. The AI proposes wording in P1 and the citizen approves or
-- rejects it; `framed_statement` holds the result of that. `body_original` is
-- what the person actually wrote and it is never overwritten, never translated
-- in place, and never hidden behind a "show original" toggle.

COMMENT ON COLUMN challenges.body_original IS
  'The citizen''s own words, exactly as submitted. NEVER overwritten, never replaced by a translation, and always rendered beside body_en at the same size and weight. CLAUDE.md invariant 6.';
--> statement-breakpoint
COMMENT ON COLUMN challenges.body_en IS
  'English working copy, produced by P0 translation. An addition to body_original, never a replacement for it. Null means not translated yet, which the challenge page says out loud.';
--> statement-breakpoint
COMMENT ON COLUMN challenges.framed_statement IS
  'A research-ready restatement proposed by P1 and APPROVED BY THE CITIZEN. Only written when framing_approved_by_citizen is true; if they decline, their own wording is used and the page says so.';
--> statement-breakpoint
COMMENT ON COLUMN challenges.priority_breakdown IS
  'The full terms array from packages/scoring, stored rather than recomputed, so a score a citizen saw last month can still be explained after the weights change. scoring_version records which weights produced it.';
