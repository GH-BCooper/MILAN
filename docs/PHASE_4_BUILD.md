# Phase 4 — BUILD (JDIP alignment, for Claude Code)

**Read `CLAUDE.md` and `PROGRESS.md` first.** Phase 3 is complete and committed. Build
**additively**; do not refactor working code. Execute in order, verify each task, commit as
`phase4/task<N>: <summary>`.

**Phase 4 goal:** close the gap between what the JDIP execution plan promises on stage and what
the frontend actually shows. The source of truth for "why" is the 32-page screenshot review in
`~/screenshots-jdip/REPORT.md` (sections A and C). When this phase is done: the AI stage animation
advances live on a seeded challenge, Hindi renders everywhere, the dashboards tell the pipeline
story with multi-state seed data, the WhatsApp intake simulation runs from the demo console, and
`/stats` shows the Jharkhand heatmap, the public leaderboard and the pipeline funnel.

**Judge questions each task buys an answer to** (JDIP Part 7): Q3 (show me the AI), Q6 (rural
internet), Q8 (escalation), Q4 (compliance adoption), Q9 (revenue), Q12 (spam control). Noted per
task.

---

## Task 4.0 — Preconditions

Verify: `pnpm build` clean on top of `625050c`; the demo database is seeded (25 challenges, 24
districts, 5 role users); `pnpm vitest run` is 12/12. Baseline numbers to report before touching
anything: challenges by **status** (expect 25 × `SUBMITTED`), `ai_runs` rows by sync label
(expect all `WAITING`/`QUEUED` — that is the bug), and the rendered font box count on the landing
hero. These three numbers are the before/after evidence for the phase.

**Environment note (not a task, do not "fix"):** the four spec divergences were already ruled —
comments without upvotes, TS staged pipeline over the Python blob, 28-state lifecycle over the
doc's 13 statuses, Leaflet over MapLibre. Phase 4 stays inside those rulings.

---

## Task 4.1 — Ship a Devanagari webfont (fixes "Hindi = boxes" everywhere)

JDIP ties: multilingual accessibility, Part 3.2 wireframe (EN/HI/SAT toggle).

1. Add `@fontsource/noto-sans-devanagari` (subset weights 400/600/700) and register it in the root
   layout via `next/font` (or self-host the woff2 in `public/fonts` with a `font-display: swap`
   `@font-face`). Add it to the Tailwind font stack **after** the Latin faces so Latin rendering
   is byte-identical to today.
2. While here, fix the two production glyph bugs the review found: the `⇒` arrow on
   `app/(gov)/gov/verification/page.tsx` (renders as missing glyph in the English stack — replace
   with a glyph the shipped font actually has, or render it as text `->`) and the overflow on the
   claim-page action button (`app/(hei)/hei/challenges/[trackingId]/claim` — the "…clears it, and
   release the…" copy is clipped; wrap or shorten).
3. Add a smoke test (vitest, no browser needed): the root HTML must reference the Devanagari font
   file, and `git grep '⇒'` in `.tsx` files returns nothing.

**Verification** — re-render `/`, `/c/JH-2026-GUM-0002`, `/submit`, `/admin/triage`: every
Devanagari string (hero subtitle, example lines, seed title) shows glyphs, not tofu. Screenshot
evidence against `00-landing.jpg` / `28-admin-triage.jpg`.

**Effort:** S. **Owner:** P2.

---

## Task 4.2 — Diagnose and fix the AI queue livelock on the rules tier

JDIP ties: Q3, Part 8.5 (the winning moment). **This blocks 4.3 and 4.4.**

Observed: `app/(admin)/admin/ai-runs` shows every row cycling `WAITING → QUEUED` with zero failure
rows, no active provider keys — on the rules tier every stage should complete in milliseconds.
Hypotheses to test, in order: (a) the queue worker only runs in a cron/request context the demo
never hits; (b) rows are written with `next_attempt_at` in the future by a retry policy meant for
failing providers; (c) the sync label transition for `rules`-only runs never fires because it is
keyed on provider events; (d) `DEMO`/offline guard short-circuits the worker's claim query.

1. Find the queue claim path (`lib/**/queue*`, the P0/S-stage runner, and the cron route that
   ticks it) and instrument the three state transitions (`QUEUED` claimed, run finished, label
   written). Identify which transition never happens and why, with a comment in code documenting
   the actual root cause — no fixing by hesitation.
2. Fix it so a submission with **no provider keys** completes P0→S5 entirely on the rules tier
   (`AI_PROVIDER_CHAIN=gemini,groq,rules` is the shipped default; rules-degradation is a designed
   behaviour — the demo depends on it working).
3. Regression test: with the scratch DB and no AI keys, submit a challenge end-to-end and assert
   every stage row reaches the terminal/synced label within N polls. Sits next to
   `tests/comments.test.ts` / `tests/stateMachine.test.ts`.

**Verification** — fresh submission in the sandbox completes all stages; `/admin/ai-runs` shows
completed rows with level=2; latencies recorded. Report the root cause in one sentence.

**Effort:** M. **Owner:** P3 + P1.

---

## Task 4.3 — Pre-sync the seed through the pipeline (25/25 challenges)

JDIP ties: Q3, Part 10 checklist ("seed challenges loaded with AI classification pre-computed").

1. Add an idempotent seed step (`pnpm seed:ai` or a `--ai` flag on the existing seeder) that runs
   the real pipeline for every seeded challenge and records the results as completed `ai_runs`
   rows: classification fields on `challenges` populated, embeddings written, S3 dedupe verdicts,
   S4 priority factors, S5 shortlists. Never invents a row beyond what the pipeline emits.
2. Hero challenge (`JH-2026-GUM-000*) must come out with a routed shortlist and a written reason —
   it is the one the demo walks through.
3. `/admin/triage` should show **only** genuinely low-confidence items afterwards (today it holds
   the Hindi seed that was never processed); re-run expectations per the rules tier.

**Verification** — `SELECT count(*) FROM ai_runs WHERE <unsynced>` returns 0 for seed challenges;
`/admin/ai-runs` and `/c/[id]` score breakdowns show real content; report the per-stage latency
percentiles from the run.

**Effort:** M. **Owner:** P3 (script) + P4 (DB leg).

---

## Task 4.4 — The success-page pipeline animation actually advances

JDIP ties: Part 3.2 "AI Processing Visualization" wireframe, Part 8.5. Depends on 4.2 + 4.3.

1. `app/(citizen)/submit/success/[trackingId]/page.tsx` — wire the P0→S5 stage cards to live
   `ai_runs` state: poll (every ~2 s, capped, or a server action revalidate), tick stages off as
   their rows land, show the stage's real receipt (model/tier/latency) when done. Staggered reveal
   stays; the honest labels stay ("Priority score — no AI", dedupe "never discarded").
2. On a pre-synced challenge the page must render already-complete (no fake spinner) — the demo
   walks a *seed*, not a fresh submit, most of the time.
3. Empty/error states: if a stage is still running after the cap, say "processing continues in the
   background — your tracking ID works already" instead of spinning forever.

**Verification** — re-shoot `13-citizen-submit-success.jpg`: P0–S5 show completed glyphs with real
receipts; compare against the archived frozen state.

**Effort:** S–M. **Owner:** P2.

---

## Task 4.5 — Multi-state seed pack (tell the pipeline story)

JDIP ties: Q8, Part 4.2, Part 10 status-funnel expectations. Depends on 4.3.

1. New seed script (`seed/states.mts`, idempotent) that walks a *handful* of challenges forward
   through the **real** state machine — not by writing status columns directly, but by executing
   the transitions (gate ack, route, claim, proposal, implemented, citizen confirms) so ledger,
   deadlines, credit and outbox rows all exist. Target distribution out of 25:
   - ~14 stay `SUBMITTED`/in-triage (the public list and map stay busy),
   - 3 `ROUTED` (fills `/hei/inbox` `29-admin-routing`),
   - 2 `CLAIMED`/`IN_RESEARCH` (fills `/hei` projects, claim page),
   - 1 `SOLUTION_PUBLISHED` + industry interest (fills `/industry/discover` `26-csr`),
   - 1 `IMPLEMENTED` **citizen-confirmed** (moves `/stats` impact counter + gov confirmation gap),
   - 1 SLA-**breached** (via deadline rows against the seed clock — fills `/bounties` + `/gov/sla`).
2. Keep the hero challenge's current state consistent with the demo runbook (read
   `docs/DEMO_RUNBOOK.md` first — the console shortcuts must still be one click, idempotent).
3. Every added row flows through the append-only ledger; nothing handwritten.

**Verification** — page counts: `/bounties` ≥ 1, `/gov/sla` per-institution claimed/delivered
non-zero, `/hei/inbox` = 3, `/industry/csr` export has a positive confirmed row, `/stats` "By
status" shows ≥ 5 distinct states. Screenshot the six pages against the archive.

**Effort:** M. **Owner:** P1 + P4.

---

## Task 4.6 — WhatsApp / voice-note intake simulation

JDIP ties: Q6, Part 5 Day 5, citizen-accessibility differentiator. Depends on 4.2.

1. New admin-visible screen `app/(admin)/demo/intake` (linked from `31-demo` console): a scripted
   WhatsApp conversation — voice note bubble → "transcribing…" → Hindi transcript (use the seeded
   transcript from `seed-data/`) → English translation → structured challenge card → lands in the
   real pipeline via the actual intake path on the rules tier. It must create a **real** challenge
   row with tracking ID, so the judge watches it pop into `/challenges` + the map.
2. At the top of the screen, the honest architecture note the console already uses ("mock gateway;
   production = WhatsApp Business API → DLT-registered sender → transcription → intake").
3. Idempotent "Play" button; second press says it already ran (same pattern as scenario shortcuts).

**Verification** — play it: a new challenge with the seeded transcript's content exists, is
classified on rules, appears on `/challenges`. Screenshot for the deck's Q6 slide.

**Effort:** M. **Owner:** P3 (intake path) + P2 (convo UI).

---

## Task 4.7 — `/stats`: heatmap + public leaderboard + pipeline funnel

JDIP ties: Part 3.2 analytics wireframe, Q8 accountability, Q9. Depends on 4.5 (for non-flat
data) — build the components against current data in parallel if needed.

1. Restore the Jharkhand **district heatmap** at the top of `app/(public)/stats/page.tsx` (Leaflet
   + committed PMTiles, severity-weighted district colouring, click-through to the district's
   challenges). The map was removed from this page earlier; bring it back per the wireframe.
2. **Public leaderboard** — institutional performance (offered / claimed / delivered / released
   undelivered / median hours to claim). Reuse the `/gov/sla` aggregation, public-safe (no emails,
   no per-user data); zero-filling rows stay visible with the same "we show it rather than hide
   it" framing.
3. **Pipeline funnel** — counts per lifecycle band (submitted → verified → routed → claimed →
   solution → implemented → confirmed), rendered as horizontal bars in the existing card style.
4. Keep the confirmation-gap/honesty blocks exactly as they are; the new sections slot under them.

**Verification** — re-shoot `06-stats.jpg`: map + leaderboard + funnel present; numbers match the
DB (`/gov/sla` aggregates agree); zero-state still renders sanely pre-4.5 data.

**Effort:** M. **Owner:** P5 (map/charts) + P1 (aggregation).

---

## Task 4.8 — `/challenges`: filter bar + severity badges

JDIP ties: Part 3.2 challenge-list wireframe ("filter by district, disaster type, severity,
status… severity badge, status badge").

1. URL-driven server-filtered bar on `app/(public)/challenges/page.tsx`: district (24), NDMA
   hazard, domain, severity band (from priority score), lifecycle band. Filters compose;
   `?district=GUM&hazard=flood` links work (the heatmap and demo hand-offs use them).
2. Severity-coloured badge on each challenge card (score → band → colour), status badge stays.
3. Empty-filter state in the same written voice as the bounty board's.

**Verification** — every filter combination on the seeded data returns correct counts; deep link
from a heatmap district lands filtered. Re-shoot `03-challenges.jpg`.

**Effort:** S. **Owner:** P2.

---

## Task 4.9 — District reference-data enrichment + `/gov/district/[code]`

JDIP ties: Part 4.1 reference data, district-specific storytelling (Sunita's Gumla numbers).

1. Migration: add to `districts` — `division`, `population`, `internet_penetration`,
   `tribal_population_pct`, `disaster_vulnerability` (jsonb). Values straight from JDIP Part 4.1
   JSON; Gumla/Simdega/Latehar/Palamu rows must be complete (the demo names them).
2. Seed it via the CSV/JSON loader (never hand-UPDATE in the seeder body).
3. Replace the "Arrives in Phase 3" placeholder on `app/(gov)/gov/district/[code]/page.tsx` with:
   the district card (division, population, internet %, tribal %, per-disaster vulnerability
   chips), its SLA board + gate queue + verification queue (the placeholder's own promise), and
   links into filtered `/challenges` (uses 4.8).
4. Update `README` schema summary line for the new columns.

**Verification** — re-shoot `16-gov-district.jpg`: populated district page; numbers match the
JDIP 4.1 table for Gumla; migration applies clean on a scratch chain 0000→HEAD.

**Effort:** S–M. **Owner:** P4 (migration/seed) + P5 (page).

---

## Task 4.10 — Santhali in the submit wizard + wireframe conformity audit

JDIP ties: Part 3.2 submission wireframe (EN/HI/SAT), tribal-accessibility pitch.

1. Add the `sat` option to the language toggle (seed data already contains a Santhali report — the
   toggle must cover it). Example lines for Santhali in the "For example" card come from the seed
   corpus, not invented text.
2. Audit all 6 wizard steps against the wireframe: title/description ✓ (step 1), district
   dropdown of 24 + block + village, map-pin step (Leaflet), media/evidence step, review/submit.
   If any step is missing from the wizard, add it; if the order differs, document why (one
   comment) rather than churning the order.
3. Mobile pass on the wizard (wireframe customers are phone-first).

**Verification** — submit a test report in Santhali; it renders correctly end-to-end (depends on
4.1 font; `sat` in Ol Chiki script — if the corpus uses Devanagari-script Santali, the 4.1 font
covers it; note which script the seed uses and match it).

**Effort:** S. **Owner:** P2 + P6 (language data).

---

## Task 4.11 — Adoption-story page + notifications surface + deck text

JDIP ties: Q4 (compliance adoption — NEP 2020/NAAC/CSR 135), Q9, Part 6 slide 13.

1. `/about` (public, linked from the footer/nav): the three adoption mandates — JSDMA quarterly
   DC reporting, NEP 2020/NAAC community-engagement, Companies Act §135 CSR budgets — in the
   house voice ("not hope — compliance"), plus methodology + the CPGRAMS carve-out repeated.
2. Notifications bell for signed-in users: unread-count + dropdown fed by the same outbox the demo
   console displays (Simulated inboxes) — it is all already written somewhere; surface it.
3. Deck Q10 stack-answer rewrite (doc text, not code): the slide claims Python /
   sentence-transformers / Leaflet+OSM tiles — reality is the TS staged pipeline (rules tier
   included), local embeddings, Leaflet + PMTiles offline. Fix the speaker-notes text so nobody
   lies on stage. File: the deck source (not this repo) — produce the corrected paragraph as
   `docs/DECK_Q10.md`.

**Verification** — `/about` renders; bell shows the 3 routed-offer messages after 4.5; Q10
paragraph reviewed by the presenter.

**Effort:** S (split across P2 / P6).

---

## Task 4.12 — Phase acceptance, CI and evidence

1. `pnpm build` clean; `pnpm vitest run` all green (old + new suites); eslint clean on touched
   files; scratch migration chain 0000→HEAD applies clean.
2. Re-run the 32-page screenshot capture (`/tmp/pwrun/shoot-all.mjs` recipe — headless Chromium,
   five role sessions) and diff visually against `~/screenshots-jdip/`: every REPORT.md §A finding
   visibly closed.
3. Update `PROGRESS.md` with the Phase 4 record (before/after numbers from 4.0) and tick the
   Phase 10-night-before checklist lines this phase covers.
4. Update `docs/DEMO_RUNBOOK.md` if the stage flow changed (4.4 order-of-operations for the
   wow-screen + intake sim in the 10-minute cut).

**Commit cadence:** one commit per task as `phase4/task<N>: <summary>`; push at task boundaries.

---

## Order-of-battle for the 6-person team (maps JDIP Part 5 roles)

| Wave | Tasks | Owners | Gate |
|---|---|---|---|
| 1 | 4.1 font, 4.2 queue fix | P2 · P3+P1 | submit succeeds end-to-end on rules tier |
| 2 | 4.3 pre-sync, 4.8 filters, 4.9 districts | P3+P4 · P2 · P4+P5 | seeds synced; pages populated |
| 3 | 4.4 animation, 4.5 multi-state seed, 4.7 stats | P2 · P1+P4 · P5+P1 | dashboards tell the story |
| 4 | 4.6 WhatsApp intake, 4.10 Santhali, 4.11 about/bell/deck | P3+P2 · P2+P6 · P2/P6 | full 10-minute demo walkthrough |
| 5 | 4.12 acceptance | all | screenshot-suite diff + CI green |

Waves 1–2 are prerequisites for 3–4 demo material; 4.8/4.9 can slide one wave later if the demo
date lands early — nothing in wave 3 hard-depends on them.
