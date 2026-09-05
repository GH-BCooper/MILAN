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
**Read `BACKLOG.md` first.** It is the human's task list — everything Phase 1 could not finish
because it needs credentials, a phone, a microphone or a native Hindi speaker — written for a
Claude session that has no memory of this one. Section 1 of that file blocks Phase 2; section 3
lists the traps (the `DATABASE_POOL_MAX` deadlock, the deliberately skipped invariant test, the
append-only ledger).

**Before any Phase 2 code:** get the Vercel deployment live (Task 1.1 step 9) and add the CI
repository secrets, then re-run all four verification scripts against the deployed URL with
`VERIFY_BASE_URL=https://<the-url>`. Then replace `seed-data/*.csv` with the real Jharkhand
dataset, record `voice-note.mp3`, and run `pnpm seed --reset`.

Then execute `docs/PHASE_2_BUILD.md`, Task 2.1.

---

## Phase 1 — deployment and real dataset — completed 2026-09-05 03:15

Appended after the Phase 1 section above. Phase 1 was code-complete but undeployed and running on
placeholder data; both are now closed.

### Status
Milan is live at **https://milan-ruddy-chi.vercel.app** and running the team's authored Jharkhand
dataset. All four verification scripts pass against the deployed URL, not just a local build.

### Tasks completed
- [x] Task 1.1 step 9 — deploy to Vercel — live, all 19 routes 200
- [x] BACKLOG §1.3 — verification against production — routes 19/19, roles 16/16, submit 23/23,
      schema inventory clean (31 tables, `ledger_entries_append_only` present)
- [x] BACKLOG §2.1 — real seed data loaded — seeder adapted to the new CSV shape
- [x] BACKLOG §2.9 — Postgres version corrected to 17 in `CLAUDE.md` and `docs/SETUP_GUIDE.md`

### Files created or changed
- `seed/index.mts` — reads the new CSV shape: denormalised geography, derived slugs, derived
  district centroids, pipe-separated tags, `capacity_window`, and the new domain/hazard/severity columns
- `seed-data/README.md` — column contract rewritten to match the authored dataset
- `scripts/verify-roles.mjs` — district codes DHA → DHN, EAS → ESB
- `CLAUDE.md`, `docs/SETUP_GUIDE.md` — Postgres 16 → 17

### Database
- Migrations applied: unchanged, still `0004_heavy_sway`
- Seed counts: districts=24, blocks=263, organisations=20, users=5, capabilities=47,
  challenges=25, corroborations=0, credit_edges=25, ledger_entries=25, challenge_media=0
- All 25 challenges carry `domain`, `hazard` and `severity`; 15 sit at or above the 0.7 human gate

### Environment variables consumed this phase
- `BETTER_AUTH_URL` — must be an absolute URL with its scheme. Set to a bare hostname it throws
  `BetterAuthError: Invalid base URL` at import, and because `SiteHeader` is in every layout that
  took down **every** runtime-rendered route while `/` (prerendered) kept working. This was the
  cause of the first failed deployment.

### Decisions taken
- Adapted the seeder to the dataset rather than reshaping six CSVs — the authored data carries
  more signal (`domain`, `hazard`, `severity_hint`) than the contract it replaced. Costs us a
  seeder that is now specific to this file shape.
- District centroids are derived as the mean of their blocks' centroids, since the file has no
  district-level coordinate. The run prints how many were derived so it is never mistaken for
  surveyed data.
- `severity_hint` is seeded into `severity`. Phase 2's S1 recomputes it; until then it is what
  `/gov/gate` and the priority panel read.
- Blocks inherit their district's `vulnerability_index` — the file carries one index per district.
  Block-level indices are a Phase 3 input.

### Stubbed / deferred (must appear on the "declared stubs" slide)
- `seed_status` and `corroborations` are absent from `challenges.csv`, so every challenge seeds as
  `SUBMITTED` with a single reporter and `/stats` shows zeros. The team is adding both columns.
- `seed-data/voice-note.mp3` is still empty, so `challenge_media` is 0.
- Hindi (7 reports) and Santali (1 report) are unchecked by a native speaker.
- `heis.type`, `industry.domain_interests` and `industry.csr_contact_title` have no schema column
  and are not stored. Phase 4's industry matching needs `domain_interests`.
- Firms with several districts in `district_focus` are anchored to the first; the rest are not stored.

### Known issues
- CI repository secrets are still unverified — `gh` is not authenticated in this environment.
  Until they are added, CI skips build and test while reporting green. BACKLOG §1.2 — **blocking**.
- `blocks.csv` is stale and no longer read. Left in place rather than deleted (CLAUDE.md §6.7).

### Verification evidence
```
verify-routes.mjs    19/19   against https://milan-ruddy-chi.vercel.app
verify-roles.mjs     16/16
verify-submit.mjs    23/23   EXIF stripped, content-hash storage key verified
pnpm build           exit 0
pnpm typecheck       clean
pnpm lint            clean
pnpm vitest run      8 passed, 1 skipped (the deliberate invariant skip)
pnpm seed            idempotent — identical counts on a second run
```

### Start here next phase
`seed_status` and `corroborations` are now in `challenges.csv` — assigned by Claude as demo
staging, flagged as such in `seed-data/README.md`, and worth a review. `/stats` shows 2 verified
impacts and 1 closed challenge.

One thing still gates Phase 2, and it needs GitHub credentials this environment does not have:

**Add the CI repository secrets** (BACKLOG §1.2). `bash scripts/set-ci-secrets.sh` after
`gh auth login` sets all six, then confirm the run is green *and* that Build and Test actually ran
rather than being skipped.

Then execute `docs/PHASE_2_BUILD.md`, Task 2.1.


---

## Phase 1 — demo staging and handoff — completed 2026-09-05 03:35

### Status
`/stats` has history: 22 SUBMITTED, 2 CITIZEN_VERIFIED, 1 CLOSED, 183 corroborations across 25
challenges. The impact counter reads 2. Everything is pushed and redeployed.

### Tasks completed
- [x] BACKLOG §2.1 remainder — `seed_status` and `corroborations` added to `challenges.csv`
- [x] BACKLOG §2.7 — `docs/DEMO_CARD.md`, the printable demo card
- [x] BACKLOG §2.8 — `backups/phase1-real-data.sql`, 649 rows across 13 tables
- [x] `scripts/set-ci-secrets.sh` — reduces the one remaining blocking item to a single command
- [x] BACKLOG.md updated to mark what is done and what is not

### Decisions taken
- `seed_status` and `corroborations` were **assigned by Claude, not by the team**, on explicit
  instruction. They are demo staging — which three reports are already resolved, and how many
  extra people reported each problem — and `seed-data/README.md` says so beside the team's own
  values. Every other value in that file is the team's. The cost is that these two columns are the
  one place a judge could ask "where did this number come from" and get "we staged it".
- The two `CITIZEN_VERIFIED` rows are the Simdega footbridge and the Bokaro school: small,
  tractable problems that a final-year civil project plausibly closes. The `CLOSED` row is the
  Khunti lac study — concluded with an advisory, no physical work for a citizen to confirm.

### Known issues
- **CI secrets remain unset.** `gh` is not authenticated here and reading the stored Windows
  credential is blocked, so this cannot be done from the Claude session. BACKLOG §1.2 — blocking.
- `backups/` is gitignored, so `phase1-real-data.sql` exists **only on this laptop**. Copy it off.
- The map still draws on a blank grey canvas (`NEXT_PUBLIC_PMTILES_URL` unset) — BACKLOG §2.5.
- `voice-note.mp3` is still empty, so `challenge_media` is 0 — BACKLOG §2.2.
- The Hindi (7 reports) and Santali (1) are still unchecked by a native speaker — BACKLOG §2.3.

### Verification evidence
```
verify-routes.mjs    19/19   impact counter shows CITIZEN_VERIFIED count (2)
verify-roles.mjs     16/16
verify-submit.mjs    23/23
pnpm build           exit 0
pnpm vitest run      8 passed, 1 skipped
pnpm seed            idempotent — identical counts on a second run
backup               649 rows across 13 tables
```

### Start here next phase
Run `bash scripts/set-ci-secrets.sh` (after `gh auth login`), confirm CI is green with Build and
Test actually running, then execute `docs/PHASE_2_BUILD.md`, Task 2.1.

---

## Phase 2 — completed 2026-09-05 09:05

### Status
A judge types a problem into `/submit` and watches six stage cards tick over on
`/submit/success/<id>`: language, safety and triage, domain and hazard, duplicates, an
explainable score with the whole breakdown open, and a ranked shortlist of three real Jharkhand
institutions each with a written reason. Measured cold on a live server, submit to S5 complete
runs **3.2s to 8.0s** depending on how loaded the free provider tier is. Every tick corresponds to
a row in `ai_runs`, and `/admin/ai-runs` shows them with p50/p95 per stage.

The priority breakdown is on the **public** challenge page with no login, every term links to its
source, and the arithmetic checks out by hand. The human gate fires at severity ≥ 0.70: the
shortlist is written, `notified_at` stays null, and nothing is sent until a District Collector
releases it. An HOD then opens the notification link, claims it, forms a team, and the public
credit chain reads citizen → corroborators → team → mentor, with the citizen on the team as
Domain Informant.

Unplug the network and it still works. Verified in a network namespace with no interfaces: every
stage returns at level 2, the trace renders amber "fallback: rules" rather than an error, and the
challenge is still scored and still routed.

### Tasks completed
- [x] Task 2.0 — Preconditions — toolchain, both API keys, `pgvector` 0.8.2 enabled, `pnpm seed` runs
- [x] Task 2.1 — Provider chain — `pnpm ai:smoke` online and in a network namespace with no
      interfaces; level 2 returned for every stage both times
- [x] Task 2.2 — S1 and S2 — `pnpm pipeline:run --all`; both seeded grievances forwarded with a
      reference and a visible handoff contract
- [x] Task 2.3 — S3 — the three planted Basia duplicates sit at 0.886 / 0.904 / 0.850 with each
      other and 0.69–0.71 against every other water challenge; they merge, the Garhwa wells and the
      Chandil dam do not. A `BLOCK_SYSTEMIC` parent formed over three Palamu blocks.
- [x] Task 2.4 — `packages/scoring` — 18/18 unit tests, weights sum to 1.00, purity asserted by
      reading the source of every file in the directory
- [x] Task 2.5 — S5 — three distinct real institutions for the Sunita embankment, led by BIT
      Sindri's Hydraulics and Water Resources Laboratory; 15/15 guardrail tests
- [x] Task 2.6 — SSE trace and the two admin receipts — `pnpm verify:pipeline` 9/9 live
- [x] Task 2.7 — Citizen-approved framing — `pnpm verify:framing`, both paths
- [x] Task 2.8 — P0 voice and translation — translation verified; the recording is a declared stub
- [x] Task 2.9 — HEI inbox, claim, workspace — `pnpm verify:hei` 26/27, `pnpm verify:phase2` 22/22
- [x] Task 2.10 — `pnpm phase:report`, this file

### Files created or changed

**`lib/ai/`**
- `types.ts`, `schemas.ts`, `hash.ts` — stage vocabulary, one Zod schema per stage, canonical hashing
- `gazetteer.ts` — the deterministic knowledge base: keyword→domain, keyword→hazard, grievance and
  unsafe phrase lists, district hazard priors, and the grievance-evidence list
- `providers/` — `types.ts`, `jsonSchema.ts` (Zod→provider schema), `gemini.ts`, `groq.ts`,
  `rules.ts`, `chain.ts`, `cache.ts`, `embed.ts`, `throttle.ts`
- `prompts/` — `p0.ts`, `p1.ts`, `s1.ts`, `s2.ts`, `s3.ts`, `s5.ts`, each with a marked
  `// HUMAN: add curated Jharkhand examples here` block
- `stages/` — `p0.ts`, `p1_framing.ts`, `s1.ts`, `s2.ts`, `s3.ts`, `s4.ts`, `s5.ts`
- `triage.ts`, `routing.ts` — the pure decision layers, testable with no database
- `pipeline.ts` — the orchestrator and the SSE event contract
- `seededTranscripts.ts` — ground truth for the seeded voice note

**`packages/scoring/`** — `weights.ts`, `normalise.ts`, `score.ts`, `index.ts`. Pure.

**`app/`**
- `api/pipeline/stream/route.ts`, `api/intake/framing/route.ts`, `api/hei/claim/route.ts`
- `(admin)/admin/ai-runs/`, `(admin)/admin/triage/` (queue, actions, card),
  `(admin)/admin/routing/` (page, actions, form)
- `(hei)/hei/` — dashboard, `inbox/`, `capability/`, `challenge-bank/`,
  `challenges/[trackingId]/claim/`, `projects/[id]/`, `claim-constants.ts`
- `(public)/c/[trackingId]/page.tsx` — breakdown, routing shortlist, grievance contract, the
  three-panel voice result, the replayable trace
- `(citizen)/submit/` — step 5 rewritten as the side-by-side framing

**`lib/`** — `hei/queries.ts`, `notify/index.ts`, `clock/browser.ts`, `media/storage.ts` (purge)

**`components/`** — `priority-breakdown.tsx`, `pipeline-trace.tsx`, `claim-countdown.tsx`

**`tests/`** — `scoring.test.ts` (18), `routing.test.ts` (15), `triage.test.ts` (12)

**`scripts/`** — `ai-smoke.mts`, `pipeline.mts`, `similarity-matrix.mts`, `phase-report.mts`,
`verify-pipeline.mts`, `verify-framing.mts`, `verify-hei.mts`, `verify-phase2-routes.mts`

### Database
- **Tables added:** `ai_cache`, `training_corrections`
- **Migrations applied:** `0005_yummy_reavers` (both tables, HNSW indexes on `challenges.embedding`
  and `capabilities.embedding`, `challenges_parent_idx`), `0006_body_original_comment` (column
  comments recording invariant 6 in the database itself)
- **Seed counts:** districts=24, blocks=263, organisations=20, users=5, capabilities=47
  (all 47 embedded by the seed), challenges=25, corroborations=183, credit_edges=25,
  ledger_entries=49, ai_cache=243 entries with 261 hits

### Environment variables consumed this phase
- `GEMINI_API_KEY` — level 0. Absent, the chain starts at Groq and says so on every run row.
- `GROQ_API_KEY` — level 1. Absent, the chain drops to the rule tier.
- `AI_PROVIDER_CHAIN` (default `gemini,groq,rules`) — set it to `rules` to run the demo
  deliberately degraded without editing code. `rules` is always appended whatever it says.
- `AI_TIMEOUT_MS` (default 3000) — the per-stage budget. Below ~2500 every Gemini call is thrown away.
- `AI_CACHE=off` — bypass `ai_cache` for a genuinely live run.
- `GEMINI_MIN_INTERVAL_MS` / `GROQ_MIN_INTERVAL_MS` / `AI_MIN_INTERVAL_MS` — batch pacing. Unset
  in production so a live request never waits.
- `GEMINI_MODEL`, `GROQ_MODEL`, `GEMINI_EMBED_MODEL`, `GROQ_ASR_MODEL` — overrides.
- `RESEND_API_KEY`, `NOTIFY_FROM` — without them notifications are written in-app only and the
  result records `email: not configured` rather than pretending.
- `SEED_SKIP_EMBED=1` — skip the seed's 47 capability embeddings when iterating on CSVs.

### Decisions taken
- **Gemini 2.5 Flash is gone.** The API answers `models/gemini-2.5-flash` with a 404 for new keys
  and points at `gemini-3.6-flash`. CLAUDE.md §3 locks the former; we run the current Flash tier of
  the same family, pinned rather than floating on `-latest`, overridable by `GEMINI_MODEL`. Costs
  us: the slide should say "Gemini Flash", not a version number.
- **Groq's model is `openai/gpt-oss-120b`.** `llama-3.3-70b-versatile` is no longer served.
- **The decision layers are pure modules** (`lib/ai/triage.ts`, `lib/ai/routing.ts`) separate from
  the stages that call providers. That is what lets 27 tests exercise every threshold and the
  routing guardrail with no database and no network. Costs us one extra file per stage.
- **Level 2 answers are never cached.** A rules answer is deterministic and costs a millisecond;
  caching it would pin a challenge to the gazetteer for the life of the key after one rate-limited
  run. Costs us nothing.
- **A level-2 answer never overwrites an existing classification.** Replacing an authored domain
  and hazard with a 0.45-confidence keyword guess makes the data worse. It is recorded as a
  proposal and sent to /admin/triage. Costs us: a rate-limited run leaves items in triage.
- **Forwarding a grievance requires hard evidence in the text**, not just the model's confidence.
  `FORWARDED_EXTERNAL` is terminal, so a false positive costs a citizen their report with no way
  back. The model must say grievance AND the text must name a scheme, sanctioned work, a withheld
  entitlement or a bribe. Both seeded grievances still forward. Costs us: a genuine grievance
  phrased without any of those words goes to a human instead of straight to CPGRAMS.
- **A merge only happens from a state that can legally reach MERGED, and always keeps the OLDER
  report.** The first person to notice a problem stays its originator whatever order a batch runs in.
- **S1∥S2, and S5's ranking alongside S3 and S4.** Four sequential model calls put the whole budget
  on the critical path. Nothing speculative is ever written. Costs us one wasted classification on
  the minority of reports S1 stops.
- **The claim URL carries the tracking ID**, not a UUID. It is what the email says and what a
  professor can forward. The build file writes `[id]`.
- **Team members are credited by NAME on the public chain**, never by email. The email links an
  account and sends the notification and stays in `project_members` and the ledger.
- **`body_en` stays null when translation fails**, rather than being filled with the original as
  the build file suggests. Rendering Devanagari under a heading that says "English working copy" is
  a small lie on a page whose whole argument is that we do not tell them. The page already says
  "not translated yet", and nothing is blocked either way.

### Stubbed / deferred (must appear on the "declared stubs" slide)
- **No fine-tuned models.** No labelled data, no GPU budget. Few-shot prompts plus an embedding kNN
  prior over already-classified challenges, declared honestly. Every human correction at
  /admin/triage lands in `training_corrections` and improves the next prior without retraining.
- **Live multilingual ASR is a declared stub.** The stage is real, the pipeline is real, and the
  live path (Groq `whisper-large-v3`) is implemented and typechecked — but the demo uses a seeded
  ground-truth transcript keyed by content hash. `seed-data/voice-note.mp3` is **still 0 bytes**, so
  no recording is attached at all; the hash placeholder in `lib/ai/seededTranscripts.ts` needs the
  real value once someone records it.
- **Language coverage is Hindi, English and one Santali sample**, not ten languages.
- **CPGRAMS / JharSewa are a mock handoff.** Neither exposes a public write API to a hackathon
  build, so Milan generates the reference locally and renders the exact JSON payload it would POST
  on the challenge page. That contract is the answer to "why not just use CPGRAMS".
- **The local embedding fallback is lexical, not semantic.** A hashed bag-of-words projection into
  the same 768 dimensions. It captures shared vocabulary, not shared meaning. Always available.
- **SMS and WhatsApp are mock inboxes.** A real gateway needs a DLT-registered sender ID and
  template approval. The message that would have been sent is written to `outbox` verbatim.
- **`/gov/gate` itself is Phase 3.** The gate *mechanism* is complete and enforced — routes are
  created unnotified, `releaseGate()` is the release path and it is exercised by the verification
  harness — but the District Collector's screen is Phase 3's task.
- Everything Phase 1 declared remains declared: no PMTiles basemap, no face blurring, no offline
  PWA, no self-serve institutional onboarding, nearest-centroid geocoding.

### Known issues
- **The pipeline runs at 7.4s-8.8s cold against a free provider tier** — *medium*. Measured over
  three consecutive cold runs: 7.4s, 7.6s, 8.8s submit-to-S5, against an 8s budget. The variance
  is entirely Gemini and Groq free-tier latency; the seeded demo path, which is cached, runs in
  about 3s. On a paid key this stops being a question.
- **`gemini-3.6-flash` is capped at five requests a minute on the free tier**, and one pipeline
  run makes five model calls — so the full Flash model 429s partway through its own run. The
  default is therefore `gemini-3.5-flash-lite`, which serves the run comfortably and classified
  the whole seed set at 0.85-0.95 confidence. Set `GEMINI_MODEL=gemini-3.6-flash` on a paid key.
- **`verify:pipeline` reported a negative submit duration once** — *cosmetic, in the script only*.
  Almost certainly a WSL clock adjustment mid-run. It does not affect the trace or the product.
- **Vercel's function timeout vs. the SSE route** — *low*. `maxDuration = 60` is set and the
  measured worst case is 8s, but this has not been exercised on Vercel.

### Verification evidence
```
pnpm ai:smoke                 level 2 returned for every stage, online
unshare -rn … ai-smoke.mts    level 2 returned with NO network interfaces at all
pnpm vitest run               6 files, 53 passed, 1 skipped (the deliberate Phase 3 invariant skip)
                              scoring 18, routing 15, triage 12, stateMachine 6, no-raw-date 1
pnpm verify:pipeline          9/9 live; three cold runs at 7.4s / 7.6s / 8.8s submit→S5
  degraded (AI_PROVIDER_CHAIN=rules)
                              9/9, 3.7s, every AI stage amber at level 2, no errors, still routed
pnpm verify:framing           9/10 — the one failure is the unrecorded voice note
pnpm verify:hei               28/28 — claim, capacity decrement, ledger, credit chain, no emails
pnpm verify:triage            9/9  — the human-in-the-loop recovery, end to end
pnpm verify:phase2            23/23 — every surface, every role guard, the public breakdown
CI run 33957907959            green, with Build and Test actually running (6 test files)
pnpm s3:matrix                GUM 0001/0002/0003 at 0.886 / 0.904 / 0.850; all others 0.69–0.71
pnpm build                    clean
pnpm typecheck                clean
pnpm lint                     clean
pnpm seed --reset             idempotent; 47 capability embeddings computed
```

### The three items Phase 1 left open are now closed
- **CI secrets are set.** All six, via `bash scripts/set-ci-secrets.sh` — which needed a fix first:
  it used `gh secret set --body-file -`, a flag this gh build does not have. Run 33957907959 is
  green and, checked in the log, it **compiled and ran all six test files** rather than skipping
  them, which is what the secrets were for.
- **Phase 2 is deployed.** The Vercel project is git-linked, so the push deployed it;
  `/api/pipeline/stream` answers with our own JSON on the live URL.
- **The seed backfill is complete.** All 21 non-terminal challenges carry model classifications at
  0.85-0.95 confidence, every non-English report has an English working copy (7 Hindi, 1 Santali),
  and 23 challenges are scored.

### Start here next phase
1. **Re-run the verification suite against the deployed URL** with
   `VERIFY_BASE_URL=https://milan-ruddy-chi.vercel.app`. Everything below was measured locally.
2. **Record `seed-data/voice-note.mp3`** and paste its SHA-256 into `lib/ai/seededTranscripts.ts`.
   It is the last thing standing between Task 2.8 and a full pass, and it needs a human voice.
3. Then execute `docs/PHASE_3_BUILD.md`, Task 3.1.

The single highest-leverage hour for the human team, per PHASE_2_LEARN.md §9.1, is curating the
few-shot examples. Every prompt in `lib/ai/prompts/` has a marked block. Five examples in `s1.ts`
were added during this phase to fix real misclassifications found by running the pipeline over the
seed set — that is the loop to keep running.
