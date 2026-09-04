# PROGRESS.md — Milan

> Claude Code: this file is the handoff between phases. Read it at the start of every session.
> Append a new `## Phase <N>` section at the end of each phase using the template in
> `CLAUDE.md` §7. **Never overwrite or delete an earlier section.**

## Current state

**Phase 0 — setup only. No code has been written yet.**

- Repository: empty
- Database: not migrated
- Deployed: no
- Seed data: authored by the human team in `seed-data/` (verify the files exist before Task 1.1)

### Start here next phase
Execute `docs/PHASE_1_BUILD.md`, Task 1.1.

---

<!-- Phase 1 section goes below this line -->

## Phase 1 — completed 2026-09-04 17:05

### Status
A real person can open the app, describe a problem in Hindi or English through a six-step wizard,
attach a photo, drop a pin or pick a district, and get a tracking ID back in under a second. That
tracking ID resolves at `/c/<id>` with no login, showing their original words beside the English
working copy at the same size and weight, the lifecycle stepper, the credit chain and a
corroboration button. `/challenges` shows all 23 seeded reports on a map and in a filterable list,
`/stats` shows live counts with an impact counter that reads `CITIZEN_VERIFIED` and nothing else,
and `/track` resolves a tracking ID typed off a scrap of paper. Five roles register and are gated
in middleware and again server-side. The database holds every column Phases 2 and 3 will fill, the
state machine is the only writer of `challenges.status`, and the ledger physically refuses UPDATE
and DELETE.

**Not done: the deployment.** Task 1.1 step 9 requires a Vercel project, and that needs the human
to authorise the Vercel/GitHub CLI or import the repo in the dashboard. Everything is verified
against a local production build (`pnpm build && pnpm start`) instead. This is the single largest
open item and it should be closed before Phase 2 starts, because "it works on my machine at hour
130" is the failure mode Task 1.1 exists to prevent.

### Tasks completed
- [x] Task 1.0 — Preconditions — PARTIAL: toolchain and `.env.local` verified; all six seed CSVs
      were present but 0 bytes. Human authorised placeholder data (see Stubbed).
- [x] Task 1.1 — Scaffold — `pnpm build` clean, `tests/no-raw-date.test.ts` passes, pushed to
      GitHub. **Deploy not done** (no Vercel credentials).
- [x] Task 1.2 — Database schema — 31 tables (24 Milan + 7 Better Auth), 8 enums, 83 indexes,
      4 extensions, generated `search_tsv`. No table needed renaming.
- [x] Task 1.3 — State machine — `pnpm vitest run tests/stateMachine.test.ts` 6/6.
      **93 legal edges** across 28 states, 6 terminal.
- [x] Task 1.4 — Auth, roles, organisations — `scripts/verify-roles.mjs` 16/16 against a live
      server, including CITIZEN refused `/gov` and GOVERNMENT(GUM) refused Dhanbad.
- [x] Task 1.5 — Seed script — `pnpm seed` twice, identical counts; `--reset` verified.
- [x] Task 1.6 — Intake wizard — `scripts/verify-submit.mjs` 23/23, including EXIF proven stripped
      by downloading the stored object back. Tracking IDs `JH-2026-GUM-0004`, `JH-2026-LAT-0003`.
- [x] Task 1.7 — Public surfaces — `scripts/verify-routes.mjs` 19/19, every route 200.
- [x] Task 1.8 — CI and invariant harness — workflow committed and pushed; `pnpm vitest run` 8
      passed, 1 skipped. **CI run status not confirmed** (repo is private, no GitHub auth here).
- [x] Task 1.9 — Close the phase — backup taken, this file written.

### Files created or changed

**`app/`**
- `layout.tsx`, `page.tsx`, `globals.css` — root shell, landing page, design tokens
- `(auth)/` — `login`, `register`, `logout`, `actions.ts` (Zod-validated registration)
- `(citizen)/submit/` — `page.tsx`, `submit-wizard.tsx`, `wizard-state.ts`, `schema.ts`,
  `actions.ts`; `submit/success/[trackingId]/page.tsx`
- `(citizen)/me/page.tsx` — the citizen's reports and permanent credit record
- `(public)/c/[trackingId]/` — canonical challenge page and the corroboration action
- `(public)/challenges/` — map + server-rendered list with URL filters
- `(public)/track/`, `(public)/stats/`, `(public)/ledger/`, `(public)/bounties/`
- `(gov)/gov/`, `(gov)/gov/district/[code]/`, `(hei)/hei/`, `(industry)/industry/discover/`,
  `(admin)/admin/triage/` — role homes, each with a server-side guard
- `api/auth/[...all]/route.ts`, `api/intake/route.ts`, `api/intake/media/route.ts`

**`lib/`**
- `clock/index.ts` — the only sanctioned wall-clock read
- `db/schema.ts` — the spine; `db/auth-schema.ts` — Better Auth's tables
- `db/index.ts` — pooled connection; `db/raw.ts` — serialised raw queries
- `db/stateMachine.ts` — the only writer of `challenges.status`
- `db/trackingId.ts`, `db/rateLimit.ts`
- `auth/index.ts`, `auth/guards.ts`, `auth/client.ts`
- `media/upload.ts` (EXIF stripping), `media/storage.ts`
- `geo/nearest.ts` — nearest-centroid district/block resolution

**`components/`** — `site-header`, `role-badge`, `role-shell`, `status-badge`, `status-colour`,
`lifecycle-stepper`, `milan-map`, `copy-button`, `corroborate-button`, plus 19 shadcn/ui primitives

**`seed/index.mts`**, **`seed-data/*.csv`**, **`seed-data/README.md`**

**`tests/`** — `no-raw-date.test.ts`, `stateMachine.test.ts`, `invariant.test.ts`

**`scripts/`** — `verify-roles.mjs`, `verify-submit.mjs`, `verify-routes.mjs`, `verify-schema.mjs`,
`backup.mjs`, `pg-url.mjs`

**Root** — `middleware.ts`, `drizzle.config.ts`, `vitest.config.ts`, `eslint.config.mjs`,
`components.json`, `.github/workflows/ci.yml`

### Database
- **Tables added (24 Milan):** districts, blocks, user_profiles, organisations_meta, capabilities,
  challenges, challenge_media, corroborations, clusters, routes, projects, project_members,
  milestones, sla_deadlines, ledger_entries, credit_edges, artifacts, access_log, notifications,
  outbox, ai_runs, audit_log, demo_state, industry_interests.
  **Plus 7 Better Auth:** user, session, account, verification, organization, member, invitation.
- **Migrations applied:** `0000_milan_extensions` (vector, pg_trgm, pgcrypto, unaccent),
  `0001_ambitious_mister_fear` (schema), `0002_ledger_append_only` (trigger),
  `0003_low_agent_brand` (Better Auth indexes and constraints), `0004_heavy_sway`
  (`account.issuer`).
- **Seed counts:** districts=24, blocks=14, organisations=16 (10 HEI + 6 industry), users=5,
  capabilities=40, challenges=23, corroborations=89, credit_edges=23, ledger_entries=23,
  challenge_media=0.

### Environment variables consumed this phase
- `DATABASE_URL` — the app cannot start without it; `lib/db` throws at import.
- `DIRECT_URL` — migrations, the seed and every verification script fail without it.
- `DATABASE_POOL_MAX` (new, optional, default 8) — set to 1 and the server deadlocks. See
  Known issues.
- `BETTER_AUTH_SECRET` — `lib/auth` throws at import; every page 500s.
- `BETTER_AUTH_URL` — wrong value means sign-in cookies are rejected as cross-origin.
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — photo upload silently degrades to
  "could not be stored"; the challenge is still created.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — reserved; not read yet in Phase 1.
- `SEED_DEMO_PASSWORD` (default `milan2026`) — the demo account password.
- `CLOCK_OFFSET_DAYS` — the Phase 3 fast-forward. Unset means real time.
- `NEXT_PUBLIC_PMTILES_URL` (new, optional) — **unset today**, so the map draws markers on a blank
  canvas and says so.

### Decisions taken
- **Working copy moved to WSL ext4 (`~/milan`)** — builds went from 10+ minutes to ~35s, and the
  apostrophe in `SIH'26` broke Next's metadata loader (it inlines the file path into a
  single-quoted JS string). Costs us: the Windows `D:` copy is stale and only syncs through git.
- **Next pinned to 15.5.4** — `create-next-app@latest` now emits Next 16, which CLAUDE.md §3
  forbids. `app/layout.tsx` and `eslint.config.mjs` are hand-written because the generated ones
  used Next-16-only APIs. Costs us: a manual bump when we intentionally move to 16.
- **shadcn `sonner` instead of `toast`** — shadcn no longer ships `toast`. No cost.
- **Ledger append-only trigger shipped in Phase 1, as a one-way seal** — DELETE always refused,
  content columns immutable, `prev_hash`/`entry_hash` writable exactly once from NULL. A blanket
  `NO UPDATE` would have made Phase 3 Task 3.4's chain linking impossible. TRUNCATE is left open
  because it is `pnpm seed --reset`, the demo restore path. Costs us: Phase 3 must write the chain
  link as a single UPDATE per row, never a re-run.
- **`ADMIN` is not a wildcard in `requireRole`** — an admin who needs a gov screen is given the
  GOVERNMENT role too. Implicit superuser access is how audit trails get holes. Costs us: one
  extra row per admin who needs cross-role access.
- **Photos upload through the server, not by presigned direct upload** (contradicts the build
  file). EXIF stripping must happen where the citizen cannot skip it. Costs us: bandwidth through
  the function, and a slower upload on a poor connection.
- **`/api/intake` and `/api/intake/media` exist** and call the same server action as the wizard.
  They are the seam the IVR/WhatsApp stubs plug into, and what the verification harness drives.
- **`db.execute` is wrapped in `execRaw`** (`lib/db/raw.ts`) — a serialising queue. The pool is the
  real fix; this is the seat belt on the code most likely to fan out.
- **Backups are taken by `scripts/backup.mjs`, not `pg_dump`** — Supabase is running PostgreSQL
  **17.6**, and `pg_dump` refuses to dump a server newer than itself. Note that CLAUDE.md §3 says
  "PostgreSQL 16"; the deck should say 17.
- **Stats is one SQL statement with a `bucket` discriminator** rather than six queries, both for
  latency and because concurrent raw queries were the deadlock.

### Stubbed / deferred (must appear on the "declared stubs" slide)
- **The AI pipeline (S1–S5)** — Phase 2. Every AI column exists and is null. `/c/<id>` shows
  "scored in the AI pipeline" instead of a fake number, and `/stats` shows an "unclassified" row.
- **The SLA engine and the reaper** — Phase 3. `deadlinesFor()` returns an empty list;
  `sla_deadlines` has zero rows; `tests/invariant.test.ts` reports 22 orphaned challenges and its
  assertion is skipped with a pointer to Phase 3 Task 3.2.
- **Ledger chain linking** — Phase 3 Task 3.4. Entries carry `content_hash`; `prev_hash` and
  `entry_hash` are null. `/ledger` says exactly this rather than drawing a chain that is not there.
- **⚠️ SEED DATA IS PLACEHOLDER** — generated by Claude on 2026-09-04 at the human's request,
  pending the real Jharkhand dataset. Real: the 24 district names/codes/centroids, 10 real HEIs
  with real websites, 6 real firms. **Invented: every vulnerability index, every faculty name,
  every lab name and tag, and all 23 citizen reports including the Hindi.**
  See `seed-data/README.md`. **Remind the human to replace this at the end of every phase.**
- **The voice note is missing** — `seed-data/voice-note.mp3` is 0 bytes, so the Sunita hero
  challenge has no audio and `challenge_media` is empty. The seed prints a warning every run.
- **Face and number-plate blurring** — not implemented. The wizard tells the citizen so in plain
  words and `challenge_media.faces_blurred` records `false`.
- **The Hindi has not been checked by a native speaker** — `PHASE_1_LEARN.md` §7.3.
- **No PMTiles basemap** — `NEXT_PUBLIC_PMTILES_URL` is unset, so the map renders markers on a
  blank canvas with a visible note. Needs a Jharkhand Protomaps extract.
- **IVR and WhatsApp Business API intake** — not built. `/api/intake` is the seam.
- **Offline PWA sync** — not built. `localStorage` drafts are the Phase 1 substitute.
- **Real institutional onboarding** — no self-serve organisation creation. HEI and industry
  registrants pick from the seeded list.
- **E-signature and payment rails** — not built; `AGREEMENT_SIGNED` and `PILOT` are in the enum
  with no UI.
- **Verified identity tiers and a decaying trust score** — the columns exist (`verified_tier`,
  `trust_score`) and nothing writes them. Phase 1 ships the 40-character floor and a
  5-submissions-per-hour rate limit instead.
- **Auth rate limiting is per-instance memory** — on Vercel each function instance keeps its own
  counter, so it slows an attacker rather than stopping one.
- **Nearest-centroid geocoding, not point-in-polygon** — wrong near district boundaries. The
  citizen's dropdown always wins, and `lib/geo/nearest.ts` documents it.

### Known issues
- **Not deployed.** — *blocking for Phase 2* — needs Vercel auth from the human. Everything is
  verified against a local production build.
- **CI green status unconfirmed** — *high* — the repo is private and `gh` is not authenticated
  here. The workflow is pushed; **the human must add repository secrets** (`DATABASE_URL`,
  `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`) or build and test steps skip themselves.
- **`DATABASE_POOL_MAX=1` deadlocks the server** — *high, mitigated* — drizzle's postgres-js driver
  issues every statement through `unsafe()`, which is not pipelined, so two concurrent queries on
  one connection hang forever and take the instance with them. Default is 8. Do not "optimise" it
  back to 1; the comment in `lib/db/index.ts` explains why.
- **`requireDistrict` renders a 500, not a 403** — *low* — the guard correctly refuses, but there
  is no `error.tsx` under `/gov` to present it. Fix when `/gov` is built out in Phase 3.
- **The `DIRECT_URL` password contains an unencoded `@`** — *low* — postgres.js copes, libpq tools
  (`psql`, `pg_dump`) do not. `scripts/pg-url.mjs` normalises it; percent-encoding it in
  `.env.local` would remove the need.
- **`/challenges` is the slowest route at ~400ms locally** — *low* — it loads up to 500 rows and
  the MapLibre bundle. Not measured on a phone over mobile data yet.
- **Not tested on a physical phone** — *medium* — the layout is verified at 320px and the file
  input uses `capture="environment"`, but the real camera flow needs a handset.

### Verification evidence
```
pnpm build          ✓ Compiled successfully in 7.1s, 22 routes, no warnings
pnpm typecheck      ✓ clean
pnpm lint           ✓ clean
pnpm vitest run     ✓ 3 files, 8 passed, 1 skipped
                      [invariant] 22 non-terminal challenges have no open SLA deadline
                      (expected until Phase 3 Task 3.2)

scripts/verify-schema.mjs   31 tables, 8 Milan enums, 83 indexes, 4 extensions,
                            search_tsv generated, ledger_entries_append_only trigger present
scripts/verify-roles.mjs    16/16
scripts/verify-submit.mjs   23/23, EXIF proven stripped on the downloaded object
scripts/verify-routes.mjs   19/19, every public route 200, slowest 416ms

pnpm seed (twice)   identical counts both runs
pnpm seed --reset   truncates and re-seeds cleanly

Ledger append-only, against the real database:
  UPDATE content_hash            refused
  DELETE                         refused
  prev_hash from NULL            allowed  (what Phase 3 Task 3.4 needs)
  re-writing a sealed prev_hash  refused

backups/phase1.sql  285 rows across 13 tables (gitignored)
```

### Start here next phase
**Before any Phase 2 code:** get the Vercel deployment live (Task 1.1 step 9) and add the CI
repository secrets, then re-run all four verification scripts against the deployed URL with
`VERIFY_BASE_URL=https://<the-url>`. Then replace `seed-data/*.csv` with the real Jharkhand
dataset, record `voice-note.mp3`, and run `pnpm seed --reset`.

Then execute `docs/PHASE_2_BUILD.md`, Task 2.1.
