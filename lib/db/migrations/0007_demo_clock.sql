-- PHASE_3_BUILD.md Task 3.1.
--
-- The demo clock becomes a database fact rather than a process fact.
--
-- The reaper's query compares `due_at <= clock_now()` in SQL. The application
-- compares the same deadlines against `clockNow()` in TypeScript. If those two
-- read different sources they disagree the moment a judge presses "+7 days",
-- and the whole SLA demonstration becomes a coin toss. So both read
-- `demo_state.clock_offset_days`, and this function is the SQL half.

ALTER TABLE demo_state ADD COLUMN IF NOT EXISTS emergency_hazard text;
--> statement-breakpoint
INSERT INTO demo_state (id, clock_offset_days, emergency_mode)
  VALUES (1, 0, false)
  ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION clock_now() RETURNS timestamptz AS $$
  SELECT now() + (COALESCE((SELECT clock_offset_days FROM demo_state WHERE id = 1), 0) || ' days')::interval;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
COMMENT ON FUNCTION clock_now() IS
  'Milan time: wall clock plus demo_state.clock_offset_days. The SQL twin of clockNow() in lib/clock. Every deadline comparison uses this; nothing compares against now() directly.';
