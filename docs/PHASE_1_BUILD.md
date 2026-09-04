# Phase 1 — BUILD (for Claude Code)

**Read `CLAUDE.md` and `PROGRESS.md` first.** Execute the tasks below in order. Run each task's
verification block and report the result before moving to the next task. Commit after each task as
`phase1/task<N>: <summary>`. Do not begin Phase 2.

**Phase 1 goal:** a deployed URL where a real person submits a real problem in Hindi or English with
a photo and a GPS point, gets a tracking ID in seconds, and can watch its status on a public page —
against 20–25 real pre-seeded Jharkhand challenges, 8–12 real HEIs and a real capability graph.
**No AI in this phase.** The AI columns exist and are null.

---

## Task 1.0 — Preconditions

Before writing any code, verify and report:

```bash
node -v && pnpm -v && git --version
ls -la seed-data/
```

`seed-data/` must contain `districts.csv`, `heis.csv`, `capabilities.csv`, `challenges.csv`,
`industry.csv`, and a voice note file. **If any are missing, stop and tell the human which ones.**
Do not generate placeholder seed data.

Confirm `.env.local` exists and contains `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Do not print secret values.

---

## Task 1.1 — Scaffold and deploy on day one

1. Scaffold Next.js 15 in the repo root: TypeScript, App Router, Tailwind v4, `src/`-less layout
   (use root `app/`), ESLint, pnpm.
2. Install: `drizzle-orm`, `drizzle-kit`, `postgres` (postgres.js), `zod`, `better-auth`,
   `@supabase/supabase-js`, `maplibre-gl`, `pmtiles`, `recharts`, `lucide-react`, `date-fns`,
   `nanoid`, `papaparse`, `vitest`, `@types/*`.
3. Initialise shadcn/ui and add: `button card input textarea select label badge table tabs dialog
   sheet toast progress separator skeleton alert avatar dropdown-menu tooltip`.
4. Create the directory skeleton exactly as in `CLAUDE.md` §4, with `.gitkeep` in empty folders.
5. Write `.env.example` mirroring `.env.local` with empty values. Ensure `.gitignore` covers
   `.env*.local`, `.next`, `node_modules`, `*.pmtiles`.
6. Configure `drizzle.config.ts` to use `DIRECT_URL` for migrations.
7. Create `lib/clock/index.ts`:
   ```ts
   // Every timestamp in Milan flows through here. The demo fast-forward in Phase 3
   // works by moving this offset, so nothing may call Date.now() directly.
   export function clockNow(): Date { ... reads CLOCK_OFFSET_DAYS + a demo_state row later ... }
   ```
   For Phase 1 it reads `process.env.CLOCK_OFFSET_DAYS`. Add an ESLint rule or a `tests/no-raw-date.test.ts`
   that greps `app/` and `lib/` for `Date.now()` / `new Date()` outside `lib/clock` and fails.
8. Build a minimal landing page at `/` (title, one line of positioning, links to `/submit`,
   `/challenges`, `/track`).
9. Push to GitHub. Import into Vercel. Add all environment variables in the Vercel dashboard.
   **Deploy.**

**Verification**
- `pnpm build` passes with zero type errors.
- The Vercel production URL loads `/` and shows the landing page.
- `tests/no-raw-date.test.ts` passes.
- Report the deployed URL.

---

## Task 1.2 — The database schema

Write `lib/db/schema.ts`. This is the most important file in the repository; the whole product is
downstream of it. Create **all** of the following now, including columns Phases 2 and 3 will fill,
so that later phases are additive.

### Enums
```
role                : CITIZEN | HEI_MEMBER | INDUSTRY | GOVERNMENT | ADMIN |
                      ASSISTED_SUBMITTER | INDEPENDENT_INNOVATOR | EXPERT_PANEL
challenge_status    : SUBMITTED TRIAGED CLASSIFIED CLUSTERED PRIORITISED VERIFIED ROUTED CLAIMED
                      PROPOSAL_APPROVED IN_RESEARCH SOLUTION_PUBLISHED INDUSTRY_INTEREST IMPLEMENTED
                      CITIZEN_VERIFIED CLOSED
                      REJECTED_UNSAFE FORWARDED_EXTERNAL NEEDS_MORE_INFO MERGED UNCLAIMED_ESCALATED
                      BOUNTY_LISTED AT_RISK FORKED PARKED WITHDRAWN
                      AGREEMENT_SIGNED PILOT DISPUTED   -- in the enum, no UI this cut
domain              : EDUCATION HEALTHCARE AGRICULTURE WATER SANITATION ENVIRONMENT LIVELIHOODS
                      ACCESSIBILITY URBAN_INFRA PUBLIC_SERVICE
hazard              : FLOOD DROUGHT LANDSLIDE HEATWAVE MINING_SUBSIDENCE EPIDEMIC FOREST_FIRE NONE
licence             : CC_BY | RESTRICTED
org_type            : HEI | INDUSTRY | GOVERNMENT
sla_kind            : CLAIM_WINDOW WIDEN OPEN_ALL BREACH GRAND_CHALLENGE PROPOSAL_DUE
                      SILENT_30 SILENT_45 IMPACT_UNCONFIRMED_30 ANNUAL_REVIEW
ledger_kind         : PROBLEM_TEXT MEDIA PROPOSAL REPORT STATE_CHANGE CREDIT_EDGE ACCESS OVERRIDE ANCHOR
```

### Tables

**Geography**
- `districts` — `code` PK, `name`, `name_hi`, `lat`, `lng`, `vulnerability_index` numeric(3,2)
- `blocks` — `code` PK, `district_code` FK, `name`, `name_hi`, `lat`, `lng`, `vulnerability_index`

**Identity** (Better Auth owns `user`/`session`/`account`/`verification`/`organization`/`member`/`invitation`;
generate them with the Better Auth CLI, then add:)
- `user_profiles` — `user_id` FK PK, `role`, `full_name`, `phone`, `preferred_lang`,
  `district_code`, `block_code`, `trust_score` numeric default 0.5, `verified_tier` int default 1,
  `org_id` nullable
- `organisations_meta` — `org_id` FK PK, `org_type`, `hei_code`, `district_code`, `lat`, `lng`, `website`

**The capability graph** (what S5 routes against in Phase 2)
- `capabilities` — `id`, `org_id` FK, `department`, `lab_name`, `specialisation_tags` text[],
  `faculty_name`, `faculty_designation`, `declared_capacity` int, `capacity_from` date,
  `capacity_to` date, `embedding` vector(768) nullable, `active` bool
  - GIN index on `specialisation_tags`, btree on `org_id`

**Challenges — the spine**
- `challenges`
  - `id` uuid PK, `tracking_id` text unique
  - `status` challenge_status default `SUBMITTED`
  - `body_original` text, `body_lang` text, `body_en` text nullable, `title` text
  - `framed_statement` text nullable, `success_criteria` text nullable, `framing_approved_by_citizen` bool default false
  - `reporter_id` FK nullable, `reporter_name` text, `assisted_by` FK nullable
  - `district_code`, `block_code`, `lat`, `lng`, `location_accuracy_m`
  - `people_affected` int, `recurrence` text, `urgency_self_report` int
  - `domain` nullable, `hazard` nullable, `hazard_strength` numeric(3,2) nullable
  - `severity` numeric(3,2) nullable, `priority_score` numeric(6,3) nullable,
    `priority_breakdown` jsonb nullable, `scoring_version` text nullable
  - `is_grievance` bool default false, `forwarded_ref` text nullable
  - `cluster_id` uuid nullable, `is_parent` bool default false, `parent_id` uuid nullable,
    `corroboration_count` int default 1
  - `official_endorsed` bool default false, `endorsed_by` FK nullable
  - `capital_works` bool default false, `solvability` text nullable
  - `embedding` vector(768) nullable
  - `search_tsv` tsvector generated from `coalesce(title,'') || ' ' || coalesce(body_en,'') || ' ' || body_original`
  - `impact_confirmed` bool default false
  - `created_at`, `updated_at`
  - Indexes: `tracking_id`, `status`, `district_code`, `block_code`, `domain`, `hazard`,
    GIN on `search_tsv`, GIN trgm on `title`. (The HNSW index on `embedding` is created in Phase 2.)
- `challenge_media` — `id`, `challenge_id` FK, `storage_key`, `content_hash`, `mime`, `bytes`,
  `exif_stripped` bool, `faces_blurred` bool, `consent_given` bool, `created_at`
- `corroborations` — `id`, `challenge_id` FK, `user_id` FK nullable, `lat`, `lng`,
  `distance_km` numeric, `weight` numeric, `device_fingerprint` text, `created_at`,
  unique(`challenge_id`, `user_id`) — the anti-brigading constraint
- `clusters` — `id`, `parent_challenge_id`, `block_code`, `kind` (`NEAR_DUP` | `BLOCK_SYSTEMIC`), `created_at`

**Routing and projects** (structure now, filled in Phase 2)
- `routes` — `id`, `challenge_id`, `org_id`, `capability_id`, `rank` int, `match_score` numeric,
  `reason_text` text, `reason_terms` jsonb, `notified_at`, `claim_window_ends_at`,
  `state` (`OFFERED` `CLAIMED` `DECLINED` `EXPIRED`), `created_at`
- `projects` — `id`, `challenge_id`, `org_id`, `lead_user_id`, `mentor_user_id`, `title`,
  `ip_track` (`OPEN` | `RESTRICTED`), `status`, `claimed_at`, `last_activity_at`,
  `forked_from` nullable
- `project_members` — `id`, `project_id`, `user_id`, `declared_role` text, `added_at`
- `milestones` — `id`, `project_id`, `title`, `due_at`, `completed_at`, `notes`

**Accountability** (structure now, engine in Phase 3)
- `sla_deadlines` — `id`, `challenge_id`, `project_id` nullable, `kind` sla_kind, `due_at`,
  `fired_at` nullable, `cancelled_at` nullable, `payload` jsonb, `created_at`
  - Index on `(due_at) WHERE fired_at IS NULL AND cancelled_at IS NULL` — the reaper's only query
- `ledger_entries` — `id`, `seq` bigserial, `challenge_id` nullable, `project_id` nullable,
  `kind` ledger_kind, `content_hash` char(64), `prev_hash` char(64), `entry_hash` char(64),
  `author_id`, `payload` jsonb, `created_at`
- `credit_edges` — `id`, `challenge_id`, `from_user_id` nullable, `to_user_id` nullable,
  `org_id` nullable, `relation` text (`ORIGINATOR` `CORROBORATOR` `TEAM_MEMBER` `MENTOR` `FUNDER` `IMPLEMENTER`),
  `declared_role` text, `created_at`
- `artifacts` — `id`, `project_id`, `kind`, `title`, `abstract`, `storage_key`, `content_hash`,
  `licence` licence, `published_at`
- `access_log` — `id`, `artifact_id`, `user_id`, `org_id`, `purpose` text, `created_at`
- `notifications` — `id`, `user_id`, `org_id`, `kind`, `title`, `body`, `action_url`, `read_at`, `created_at`
- `outbox` — `id`, `topic`, `payload` jsonb, `created_at`, `processed_at` — the transactional outbox
- `ai_runs` — `id`, `challenge_id`, `stage` (`P0` `S1`..`S5`), `provider`, `model`,
  `fallback_level` int, `confidence` numeric, `latency_ms` int, `input_hash`, `output` jsonb,
  `created_at`
- `audit_log` — `id`, `actor_id`, `action`, `target_type`, `target_id`, `reason` text, `meta` jsonb, `created_at`
- `demo_state` — single row: `clock_offset_days` int, `emergency_mode` bool, `updated_at`
- `industry_interests` — `id`, `challenge_id`, `org_id`, `user_id`, `message`, `state`, `created_at`

### Migration extras
In a hand-written migration alongside the generated one:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

**Verification**
- `pnpm drizzle-kit generate && pnpm drizzle-kit migrate` succeeds against the real database.
- `psql $DIRECT_URL -c "\dt"` lists every table above.
- Report the table count and any table you had to rename.

---

## Task 1.3 — The state machine

Create `lib/db/stateMachine.ts`. **Nothing else in the codebase may write `challenges.status`.**

1. An explicit `TRANSITIONS: Record<ChallengeStatus, ChallengeStatus[]>` map encoding the lifecycle
   in `CLAUDE.md` and the Phase 1 Learn file. Illegal edges throw `IllegalTransitionError`.
2. `TERMINAL_STATES = ['CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE','PARKED']`.
3. `export async function transition(tx, { challengeId, to, actorId, reason, meta })` which, **in one
   transaction**:
   - locks the challenge row (`SELECT ... FOR UPDATE`)
   - validates `from → to`
   - updates `status` and `updated_at = clockNow()`
   - appends a `STATE_CHANGE` ledger entry (Phase 1: write the row with `content_hash` computed;
     the chain linking is completed in Phase 3 Task 3.4 — leave `prev_hash` nullable for now and
     add a TODO comment referencing that task)
   - inserts an `outbox` row `{ topic: 'challenge.status_changed', payload }`
   - inserts/cancels `sla_deadlines` rows via a `deadlinesFor(to)` hook that returns `[]` in Phase 1
4. Unit test `tests/stateMachine.test.ts`: every legal edge succeeds, a representative illegal edge
   throws, terminal states accept no outgoing edge, and the transition is atomic (force an error
   after the update and assert nothing was written).

**Verification** — `pnpm vitest run tests/stateMachine.test.ts` passes. Report the number of legal
edges encoded.

---

## Task 1.4 — Auth, roles and organisations

1. Configure Better Auth (`lib/auth/`) with email+password, the **organisation plugin**, and a
   Drizzle adapter pointed at the same database. Generate its tables.
2. `lib/auth/guards.ts`: `requireUser()`, `requireRole(...roles)`, `requireDistrict(code)`,
   `requireOrgMember(orgId)` — each throws/redirects, each usable inside a server action.
3. `middleware.ts`: protect `/me/*`, `/hei/*`, `/industry/*`, `/gov/*`, `/admin/*` by role.
   Add a comment stating that middleware is UX and the server-side guard is the real check.
4. Minimal `/login`, `/register` and `/logout`. Registration collects role, name, phone, preferred
   language, district; HEI/industry registration additionally selects an existing organisation from
   the seeded list (no self-serve org creation this cut — real institutional onboarding is a
   declared stub).
5. A tiny `<RoleBadge/>` in the header so it is obvious on stage who is logged in.

**Verification** — register one user of each of the five UI roles; confirm a CITIZEN gets redirected
away from `/gov` and a GOVERNMENT user of district `GUM` cannot open a Dhanbad-scoped page. Report both.

---

## Task 1.5 — The seed script

Create `seed/index.ts`, runnable as `pnpm seed`. It reads only from `seed-data/*.csv` via papaparse.
It must be **idempotent** (`pnpm seed` twice leaves the same database) and support `pnpm seed --reset`
which truncates and re-seeds (used by the `/demo` console in Phase 3).

Order: districts → blocks → organisations (+`organisations_meta`) → users/members → capabilities →
challenges → corroborations → industry organisations.

Rules:
- Never invent a row. If a CSV column is empty, leave the column null and log a warning.
- Challenges seed at status `SUBMITTED` with all AI columns null — Phase 2 will run the pipeline
  over them. Exception: mark 3 of them `CLOSED`/`CITIZEN_VERIFIED` with backdated timestamps so the
  public `/stats` page is not empty on stage.
- Generate tracking IDs with the real `nextTrackingId(districtCode)` helper, not by hand.
- Seed the demo accounts listed in `PHASE_1_LEARN.md` §7.5 with the password read from
  `SEED_DEMO_PASSWORD` (default `milan2026` if unset) and print the list at the end.
- Copy `seed-data/voice-note.*` into Supabase Storage `media/` and attach it to the Sunita hero
  challenge as `challenge_media`.
- Print a summary table of row counts.

**Verification** — `pnpm seed` then `pnpm seed` again; report counts both times (they must match).
Report the demo account list.

---

## Task 1.6 — Intake: the six-step wizard

Route `/submit`. One client component per step, state in a single reducer, drafts persisted to
`localStorage` under `milan:draft:<uuid>` so a dropped connection does not lose a citizen's report.

Steps:
1. **What is the problem** — free text, ≥ 40 characters, with a language toggle (हिन्दी / English).
   Store the raw text in `body_original` and the chosen `body_lang`. Show a live character count and
   three example prompts written in citizen voice.
2. **Photo / evidence** — optional, up to 3 files, presigned upload straight to Supabase Storage,
   object key = SHA-256 of the file bytes. On upload: **strip EXIF** (including GPS) server-side and
   set `exif_stripped = true`. Show an explicit consent checkbox: *"I confirm I have permission to
   share this image and understand faces may be visible."* Persist `consent_given`.
   Face/plate blurring is out of scope this cut — insert a visible "Faces will be blurred before
   publication" notice and record it in `PROGRESS.md` as a declared stub.
3. **Where** — browser geolocation with a manual MapLibre pin fallback; reverse-resolve the point to
   `district_code` and `block_code` using the seeded district/block centroids (nearest-centroid is
   sufficient and must be commented as such). Always let the user correct the district/block by
   dropdown — geolocation in rural Jharkhand is not reliable and the demo must not depend on it.
4. **Who and how often** — people affected (bucketed: 1–10, 10–100, 100–1000, 1000+, stored as the
   bucket midpoint), recurrence (one-off / seasonal / yearly / constant), self-reported urgency 1–5.
5. **Framing** — Phase 1 renders this step with the citizen's own text as the proposed statement and
   an editable "what would success look like" field. **Wire the UI now; the AI rewrite lands in
   Phase 2 Task 2.7.** The approval checkbox writes `framing_approved_by_citizen`.
6. **Review and submit** — everything on one screen, original text shown verbatim, then submit.

Submission is a **server action**: Zod-validate → insert challenge in a transaction → generate
tracking ID → write the media rows → write an `ORIGINATOR` `credit_edges` row → write a
`PROBLEM_TEXT` ledger entry → `outbox` event → redirect to `/submit/success/[trackingId]`.

Anti-abuse (loophole rows 7 and 8): rate-limit by IP + user to 5 submissions/hour (a simple
`audit_log`-backed counter is fine), enforce the ≥ 40-character floor, and set `trust_score` on the
profile. Say in a code comment that verified identity tiers and the decaying trust score are the
production design; Phase 1 ships the floor and the rate limit.

`/submit/success/[trackingId]` shows the tracking ID **large**, a copy button, the public URL, and
what happens next as a five-step visual.

**Verification** — submit one Hindi and one English report end to end on the deployed URL, including
a photo, from a phone. Report both tracking IDs and confirm EXIF is stripped
(`exiftool` on the downloaded object shows no GPS).

---

## Task 1.7 — Public surfaces

1. **`/c/[trackingId]`** — the canonical challenge page, no login required. Shows: title, status
   with a horizontal lifecycle stepper, the **original text and the English working copy side by
   side at the same size and weight**, media, district/block, hazard and domain badges (null-safe —
   they are empty until Phase 2), corroboration count with a "this happens to me too" button, the
   credit chain (originator only in Phase 1), and a placeholder panel for the priority breakdown
   labelled *"scored in the AI pipeline"*.
2. **`/track`** — a single input, enter a tracking ID, go to the page. No login.
3. **`/challenges`** — map + list explorer. MapLibre with the Protomaps PMTiles basemap, one marker
   per challenge coloured by status, filters for district, domain, hazard, status. The list is a
   server component; the map is a client component fed by it.
4. **`/stats`** — public transparency: total challenges, by district, by domain, by status, median
   time-to-route (null this phase), and the **impact counter** which reads only
   `count(*) where status = 'CITIZEN_VERIFIED'`. Add a visible caption: *"Impact counts only
   citizen-confirmed outcomes."*
5. **`/me`** — the citizen's reports and their permanent credit record.
6. Stub-but-present pages returning an honest "arrives in Phase 3" panel: `/ledger`, `/bounties`.

Design notes: mobile-first, 320px minimum, government-appropriate restraint (no gradients, no
glassmorphism), high contrast, Devanagari-safe font stack, every status badge has a text label not
just a colour.

**Verification** — every route above returns 200 on the deployed URL. Load `/challenges` on a phone
over mobile data and report the time to first marker.

---

## Task 1.8 — CI and the invariant harness

1. `.github/workflows/ci.yml`: install → typecheck → `pnpm build` → `pnpm vitest run`.
2. `tests/invariant.test.ts` — the query that Phase 3 will make meaningful:
   ```sql
   SELECT count(*) FROM challenges c
   WHERE c.status NOT IN (<terminal states>)
     AND NOT EXISTS (SELECT 1 FROM sla_deadlines d
                     WHERE d.challenge_id = c.id AND d.fired_at IS NULL AND d.cancelled_at IS NULL);
   ```
   In Phase 1 this returns a non-zero count. **Write the test with `test.skip` and a comment
   pointing at Phase 3 Task 3.2, where it is un-skipped and must return 0.** Do not fake it green.
3. `tests/no-raw-date.test.ts` from Task 1.1 stays in the suite.

**Verification** — CI green on GitHub. Report the run URL.

---

## Task 1.9 — Close the phase

1. Run `pnpm build`, `pnpm vitest run`, `pnpm seed` one final time against production.
2. Take a `pg_dump` to `backups/phase1.sql` and gitignore the folder, telling the human where it is.
3. Update `PROGRESS.md` using the template in `CLAUDE.md` §7. Under **Stubbed** you must list at
   minimum: AI pipeline (Phase 2), SLA engine (Phase 3), ledger chain linking (Phase 3),
   face/plate blurring, IVR and WhatsApp Business API, offline PWA sync, real institutional
   onboarding, e-signature and payment rails.
4. Print a short handoff: deployed URL, demo credentials, seed counts, and the exact first action
   for Phase 2.
5. **Stop. Do not start Phase 2.**

---

## Phase 1 acceptance checklist

- [ ] Deployed URL live since Task 1.1
- [ ] All tables migrated; extensions enabled
- [ ] `stateMachine.ts` is the only writer of `challenges.status`, with tests
- [ ] Five UI roles register and are correctly gated in middleware **and** server-side
- [ ] `pnpm seed` is idempotent; 24 districts, ≥ 8 HEIs, ~40 capabilities, 20–25 real challenges
- [ ] Submit works on a phone in Hindi and English, photo uploads, EXIF stripped, tracking ID in < 3 s
- [ ] Original text renders beside the English copy at equal weight
- [ ] `/c/[trackingId]`, `/track`, `/challenges`, `/stats`, `/me` all live
- [ ] Impact counter reads only `CITIZEN_VERIFIED`
- [ ] CI green; invariant test present and skipped with a pointer to Phase 3
- [ ] `PROGRESS.md` updated
