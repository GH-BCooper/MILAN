# Phase 3 — BUILD (for Claude Code)

**Read `CLAUDE.md` and `PROGRESS.md` first.** Phases 1 and 2 are complete and deployed. Build
**additively**; do not refactor working code. Execute in order, verify each task, commit as
`phase3/task<N>: <summary>`.

**Phase 3 goal:** the full 6-minute demo runs end to end without anyone touching a terminal — the
SLA ladders fire on a fast-forwarded clock, the ledger verifies in the browser, the credit chain
renders end to end, the citizen's SMS confirmation increments the impact counter, and the CI
invariant returns zero.

---

## Task 3.0 — Preconditions

Verify: Phase 2 acceptance checklist ticked in `PROGRESS.md`; the pipeline runs end to end; `CRON_SECRET`
is set in both `.env.local` and Vercel. Report the current count of challenges by status.

---

## Task 3.1 — `clockNow()` becomes real, and the demo state

1. Upgrade `lib/clock` to read `demo_state.clock_offset_days` (single row, cached for 5 s per
   request lifetime), falling back to `CLOCK_OFFSET_DAYS`. Export `clockNow()`,
   `advanceClock(days, actorId)` and `resetClock(actorId)`, each writing to `audit_log`.
2. Add a SQL function `clock_now()` that reads the same row, so the reaper's query and application
   code agree. All deadline comparisons use it.
3. A persistent amber banner in the root layout whenever `clock_offset_days != 0`:
   *"Demo clock: +N days"*. Non-negotiable — a judge must never be misled about the date.
4. Re-run `tests/no-raw-date.test.ts`; it must still pass.

**Verification** — advance the clock 7 days, confirm `SELECT clock_now()` and the app agree, then
reset. Report both values.

---

## Task 3.2 — The SLA engine and the reaper

1. `lib/sla/deadlines.ts` — `deadlinesFor(status, ctx)` returning the rows a state implies. Wire it
   into the `deadlinesFor` hook stubbed in Phase 1 Task 1.3 so deadlines are created **in the same
   transaction as the state change**. Cancelling on state change stamps `cancelled_at`; it never deletes.

   | On entering | Create |
   |---|---|
   | `ROUTED` | `WIDEN +7d`, `OPEN_ALL +14d`, `BREACH +21d`, `GRAND_CHALLENGE +45d` |
   | `CLAIMED` | `PROPOSAL_DUE +14d` |
   | `PROPOSAL_APPROVED` / `IN_RESEARCH` | `SILENT_30 +30d`, `SILENT_45 +45d` (rescheduled from `last_activity_at` on every project write) |
   | `IMPLEMENTED` | `IMPACT_UNCONFIRMED_30 +30d` |
   | `PARKED` | `ANNUAL_REVIEW +365d` |
   | any terminal except `PARKED` | cancel all open deadlines |

2. `lib/sla/reaper.ts` — one function, safe to run concurrently:
   ```sql
   SELECT * FROM sla_deadlines
   WHERE fired_at IS NULL AND cancelled_at IS NULL AND due_at <= clock_now()
   ORDER BY due_at LIMIT 100
   FOR UPDATE SKIP LOCKED;
   ```
   For each row, **in one transaction**: perform the action, stamp `fired_at`, append a ledger entry,
   write notifications, write the outbox event. Idempotent by construction.
3. `app/api/cron/reaper/route.ts` — authenticated by `CRON_SECRET` (constant-time compare), callable
   by Vercel Cron and by the `/demo` console. Add `vercel.json` with a `*/5 * * * *` schedule and a
   nightly `0 20 * * *` job for rescoring, outbox drain and ledger anchoring.
4. **Ladder actions** in `lib/sla/actions.ts`:
   - `WIDEN` → re-run S5 excluding the original three, notify the next five, extend the countdown,
     status `UNCLAIMED_ESCALATED`
   - `OPEN_ALL` → open to every HEI and independent innovator; the challenge appears in every
     `/hei/challenge-bank`
   - `BREACH` → set `sla_breached_at`, flag on `/gov/sla` and the DC dashboard, post to `/bounties`,
     status `BOUNTY_LISTED`
   - `GRAND_CHALLENGE` → tag into the annual Jharkhand Grand Challenges set (a boolean + a
     `/bounties?set=grand` filter; a separate page is a declared cut)
   - `PROPOSAL_DUE` → nudge lead + HOD; at +21 d release the claim, return the challenge to `ROUTED`,
     restart Ladder 1, **preserve and attribute the prior team's work**
   - `SILENT_30` → mentor nudge, public `AT_RISK` flag
   - `SILENT_45` → open fork rights; a fork creates a new project with `forked_from` set and the
     prior team credited in `credit_edges`
   - `IMPACT_UNCONFIRMED_30` → second SMS to the citizen; mark the claim unconfirmed everywhere
   - `ANNUAL_REVIEW` → rescore with the current `SCORING_VERSION` and re-route
5. **Un-skip `tests/invariant.test.ts`** from Phase 1 Task 1.8. It must now return **0**. If it does
   not, the missing state is a real hole — fix `deadlinesFor`, do not weaken the test. Add it to CI
   as a required check.

**Verification** — run the reaper manually after advancing the clock 7, 14 and 21 days on an
unclaimed seeded challenge, and report which ladder actions fired at each step with the resulting
status. Then run the invariant test and report the count (must be 0).

---

## Task 3.3 — Bounty board, DC dashboard, emergency mode

1. **`/bounties`** (public) — unclaimed and escalated challenges, sorted by priority, showing days
   unclaimed, escalation stage, priority breakdown, and a direct claim link. Filters: district,
   domain, hazard, escalation stage, Grand Challenges set.
2. **`/gov`** — the District Collector dashboard, scoped to the user's district and rechecked
   server-side:
   - counts by status; **SLA breaches with days overdue, most overdue first**
   - a map of the district's challenges coloured by priority
   - the human-gate queue count with a direct link
   - institutional SLA visibility: per HEI, offered / claimed / delivered / breached
   - **the impact counter, split into confirmed and unconfirmed, with unconfirmed rendered grey**
   - one-click export to CSV for the district disaster management plan
3. **`/gov/gate`** — the human gate from Phase 2, finished: the AI proposal, its reasoning, the
   priority breakdown, the shortlist, and confirm / override / reject controls. Overrides require a
   written reason and are appended to `training_corrections`.
4. **`/gov/verification`** — field verification tasks by block: a block officer marks a challenge
   `VERIFIED` with a note and optional photo, setting `official_endorsed` (which feeds the 0.06
   scoring term — show the score change before and after on the page).
5. **`/gov/sla`** — full breach history and per-institution performance.
6. **`/gov/emergency`** — the toggle only, per the declared scope. When on: a banner statewide, a
   map filter to the selected hazard, and priority display re-sorted for that hazard. It changes
   **display and filtering, not the stored score**. Label it on screen as a filter, and record in
   `PROGRESS.md` that full Emergency Mode is a declared stub.

**Verification** — as `dc.gumla@jh.gov`, show a breach appearing on the dashboard after the +21 d
fast-forward, and confirm a Dhanbad-scoped page is refused. Screenshot both.

---

## Task 3.4 — The provenance ledger

1. `lib/ledger/hash.ts` — `canonicalJson(obj)` (sorted keys, no whitespace, stable number
   formatting), `sha256Hex(input)`, and `computeEntryHash({seq, contentHash, prevHash, authorId, createdAt})`.
2. `lib/ledger/append.ts` — `appendEntry(tx, {...})`: takes an advisory lock on the ledger, reads the
   latest `entry_hash` as `prev_hash`, computes `entry_hash`, inserts. **Must be called inside the
   caller's transaction**, never on its own connection.
3. **Backfill** the Phase 1/2 entries that have a null `prev_hash`, in `seq` order, in one migration.
   Report the resulting head hash.
4. **Enforce append-only at the database level** in a migration:
   ```sql
   CREATE RULE ledger_no_update AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
   CREATE RULE ledger_no_delete AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;
   -- plus a trigger that RAISEs, so a silent no-op is never mistaken for success
   ```
   Add `tests/ledger.test.ts`: an attempted UPDATE fails; tampering with a payload makes verification
   fail from that entry onward; a clean chain verifies.
5. `lib/ledger/verify.ts` — walk the chain from genesis, recompute every hash, return
   `{ ok, brokenAtSeq }`. Streamed in pages so it works on a large chain.
6. **`/ledger`** (public) — a live feed of entries (seq, kind, challenge, author, short hash,
   timestamp), a **Verify chain** button that runs the verifier in the browser against the API and
   renders a green/red result, and a per-entry expander showing the payload and letting anyone
   recompute the hash of a file they hold. Add one plain-language paragraph explaining what the chain
   proves and what it does not.
7. **The daily anchor** — the nightly cron hashes the head `entry_hash`, writes an `ANCHOR` entry,
   and, if `OPENTIMESTAMPS_ENABLED=true`, submits it to OpenTimestamps and stores the receipt.
   Behind a provider interface with a no-op local implementation, per `CLAUDE.md` §2.8.
8. Every artifact upload keys its storage object by the SHA-256 of the file bytes and writes a
   ledger entry. Same file twice = same key = automatic dedup; show this on the artifact page.

**Verification** — publish an artifact, then attempt an UPDATE on `ledger_entries` via psql (must
fail), then run Verify chain in the browser (must be green). Report the head hash and the entry count.

---

## Task 3.5 — Credit chain, licensing and the access log

1. **`<CreditChain/>`** on `/c/[trackingId]` (public): an ordered graph rendering
   citizen (originator) → corroborators → team members with declared roles → mentor → funder →
   implementer. Each node links to that person's public credit record. Merged reporters appear as
   corroborators; forked-from teams appear with their contribution preserved and attributed.
2. **Citation string**, auto-generated from the Milan ID, with a copy button:
   `Oraon, S. (originator), BIT Sindri Civil Engineering Team (2026). "Embankment fissure early
   warning, South Koel." Milan JH-2026-GUM-0042. https://<host>/c/JH-2026-GUM-0042`
   Offer BibTeX too — a faculty member will ask.
3. **Publishing an artifact** at `/hei/projects/[id]`: title, abstract, file, and a licence choice of
   **CC-BY** or **RESTRICTED**, with the consequences of each stated in plain language on the form.
   Title, problem and abstract are **always public** regardless of licence.
4. **Restricted access** — a request/grant flow: a verified identity requests access with a stated
   purpose; the project lead grants or denies; **every download writes an `access_log` row** (who,
   which organisation, stated purpose, timestamp) and a ledger `ACCESS` entry. The log is visible to
   the project team and the originating citizen.
5. **The prior-art panel** on every published artifact: publication timestamp, content hash, anchor
   status, and one sentence explaining defensive publication. This is the on-screen answer to
   loophole row 11.
6. **`/me`** — the citizen's permanent credit record: reports, corroborations, credit edges, and the
   citation strings, exportable as a PDF.

**Verification** — publish one CC-BY artifact and one restricted one; request and grant access as an
industry user; show the `access_log` row and the ledger entry. Screenshot the credit chain for the
Sunita challenge showing all node types.

---

## Task 3.6 — The citizen confirmation loop

1. On `IMPLEMENTED`, send the citizen (and corroborators) a message via the mock SMS provider
   containing a link to `/me/verify/[id]`.
2. **`/me/verify/[id]`** — no login beyond a signed link token: shows the original problem in the
   citizen's own language, what was claimed, by whom, and three answers: **Yes, it's fixed** /
   **Partly** / **No, nothing changed**, with an optional photo and comment.
   - Yes → `CITIZEN_VERIFIED` → `CLOSED`, **impact counter increments**, ledger entry, credit chain
     finalised.
   - Partly → `CITIZEN_VERIFIED` with a partial flag; counted separately and shown as partial everywhere.
   - No → the implementer's claim is marked **disputed**, the challenge returns to `IN_RESEARCH`, the
     DC is notified, and the impact counter does **not** move.
3. **The impact counter reads only `CITIZEN_VERIFIED`.** Audit every dashboard, `/stats`, and the CSR
   export for any other definition and fix it. Unconfirmed claims render grey with the label
   *"claimed, not confirmed"* everywhere, with a tooltip explaining why.
4. `/gov` and `/stats` show the **confirmation gap**: claimed vs confirmed, as a number and a chart.
   Do not hide it. It is the most credible thing on the page.

**Verification** — take one challenge from `IMPLEMENTED` through each of the three answers on
separate records, and report the impact counter after each. Screenshot the confirmation gap chart.

---

## Task 3.7 — Industry and CSR

1. **`/industry/discover`** — browse solutions and challenges by domain, TRL/solvability, district
   and hazard. Only public metadata for restricted artifacts.
2. **`/industry/challenges/[id]`** and **`/industry/interests/[id]`** — express interest with a
   message, creating an `industry_interests` row, a notification to the project team and HEI, and an
   EOI thread. On acceptance, write a `FUNDER` `credit_edge` and set `INDUSTRY_INTEREST`.
3. **`/industry/csr`** — the audit-ready **Companies Act §135** export: challenges supported,
   districts, beneficiaries, spend fields, artifacts with licences, and **confirmed vs unconfirmed
   impact rendered separately, unconfirmed in grey**. Export as CSV and as a generated PDF.
4. Generate the **MoU document** (a PDF from a template, hashed into the ledger) rather than
   implementing signing. Show the document; state on screen and in `PROGRESS.md` that e-signature,
   payment rails and MoU negotiation threads are declared stubs.
5. The **Independent Innovator** path (loophole row 16): an individual may claim a challenge with
   personal credit only, their employer is never named, and the UI states that a legal entity is
   needed only to receive money, not to participate.

**Verification** — express interest as the seeded Tata Steel Foundation user, accept it, generate the
CSR export, and confirm unconfirmed impact is visibly separated. Attach the export.

---

## Task 3.8 — `/demo` — the judge console

This page is what makes the 6-minute script survivable. It must be beautiful, obvious and fast.

1. **Clock fast-forward**: buttons for +7 / +14 / +21 / +45 days and Reset, each of which advances
   the clock, **runs the reaper immediately**, and shows a live log of every ladder action that fired,
   with the affected challenge and its new status. This is the counterfactual beat at 4:15.
2. **Seed reset**: one button restoring the database to the 25-challenge seed state and clock 0, with
   a confirm dialog. Must complete in under 20 seconds. Time it and report.
3. **Simulated inboxes**: an SMS inbox, a WhatsApp inbox and an email inbox showing every message the
   platform has sent, newest first, with the recipient and the action link — so Sunita's confirmation
   SMS is visible on stage without a phone.
4. **Scenario shortcuts**: one button each for the demo beats — *Submit hero challenge*,
   *Run pipeline*, *DC confirms gate*, *HOD claims*, *Publish artifact*, *Mark implemented*,
   *Citizen confirms*. Each is a single click and idempotent.
5. **Health strip**: AI provider status per level, last reaper run, open deadlines, invariant status
   (green/red), ledger head hash, database latency. If anything is red, the driver sees it before the
   judges do.
6. Protect `/demo` behind the ADMIN role, but make it usable on a laptop screen mirrored to a projector.

**Verification** — run the entire 6-minute script using only `/demo` and the normal UI, no terminal.
Report the wall-clock time for each beat.

---

## Task 3.9 — Hardening for stage day

1. **Offline path**: `docker-compose.yml` with Postgres 16 + pgvector, MinIO, Ollama, Mailpit and the
   mock SMS/WhatsApp inbox; `.env.offline`; a `pnpm demo:offline` script. **Run the full demo with
   the wifi physically off** and report which stages used fallback level 2.
2. **Failover**: confirm `next start` runs the same repository against local Postgres with only
   environment variables changed. Document the two commands in `README.md`.
3. **Error boundaries** on every route group with a calm, branded message. No stack trace ever
   reaches a judge's screen.
4. **Performance**: `/challenges`, `/c/[id]`, `/gov` and `/bounties` under 2 s on a throttled 4G
   profile. Add missing indexes; do not add a cache layer.
5. **Empty states** everywhere — a page with no data must explain itself, never render blank.
6. **Mobile pass**: every citizen-facing route at 320px on a real phone.
7. **Seed guard**: a CI check that fails if any string matching `Foo|Test University|Lorem|District A`
   appears in `seed-data/` or in the UI.
8. **Backup**: `pg_dump` of the final demo state committed to `backups/demo.sql` (gitignored large
   files aside), plus a one-command restore documented in `README.md`.
9. **`README.md`**: what Milan is, the five sentences, the architecture diagram, how to run locally,
   how to run offline, how to restore the demo state, and the **declared stubs list**.

**Verification** — report the offline run result, the four page timings, and the restore time from backup.

---

## Task 3.10 — Close the project

1. Run everything: `pnpm build`, `pnpm vitest run` (including the invariant test), `pnpm seed --reset`,
   the full pipeline, the reaper.
2. Produce a final `docs/DEMO_RUNBOOK.md`: the 6-minute script beat by beat, with the exact clicks,
   the URLs, the credentials, what to say, what can go wrong at each beat and the recovery for each.
3. Produce `docs/LOOPHOLES.md`: the 16-row failure/response table from the build scope, each row
   annotated with **where in the product it is implemented** and the URL to open if challenged.
4. Update `PROGRESS.md` with the final phase section. The **Stubbed** list is the declared-stubs
   slide; make it complete and honest: IVR, WhatsApp Business API, offline PWA sync, fine-tuned
   models, full 10-language coverage, live CPGRAMS/JharSewa API, real institutional onboarding,
   e-signature, payment rails, MoU negotiation threads, patent/DOI integration, IP dispute
   adjudication UI, face/plate blurring, full Emergency Mode.
5. Print the final handoff: deployed URL, credentials, hero tracking ID, ledger head hash, seed
   counts, invariant status.

---

## Phase 3 acceptance checklist

- [ ] `clockNow()` is the single source of time; the demo banner shows a non-zero offset
- [ ] Deadlines are durable rows, created in the same transaction as the state change
- [ ] The reaper is idempotent under concurrency (`FOR UPDATE SKIP LOCKED`)
- [ ] All three ladders fire correctly on a fast-forwarded clock
- [ ] **`tests/invariant.test.ts` is un-skipped and returns 0**, and is a required CI check
- [ ] Every challenge can reach exactly one of the six terminal states; `PARKED` re-reviews annually
- [ ] The ledger is append-only **at the database level**, and tampering is detectable
- [ ] `/ledger` verifies the chain in the browser
- [ ] Credit chain renders end to end with citation strings
- [ ] CC-BY and RESTRICTED both work; every restricted download is logged
- [ ] The impact counter increments **only** at `CITIZEN_VERIFIED`; unconfirmed claims are grey everywhere
- [ ] The confirmation gap is visible on `/gov`, `/stats` and the CSR export
- [ ] `/demo` runs the whole 6-minute script with no terminal
- [ ] The full demo runs with the wifi off
- [ ] `DEMO_RUNBOOK.md`, `LOOPHOLES.md`, `README.md` and `PROGRESS.md` are complete
