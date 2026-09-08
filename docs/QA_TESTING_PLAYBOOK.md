# Milan — QA Testing Playbook

**Scope:** full-stack functional, UI/responsive, architectural/authorization, data-integrity and
latency/performance testing of Milan (SIH26043 — Jharkhand disaster-risk-reduction pipeline).

**Audience:** a manual QA tester plus whoever runs the automated scripts. No code changes are
required to run this plan — it is a walkthrough that produces evidence.

> This is **not** the JDIP plan. The product code in this repo is **Milan** (the NEP-lab/CSR/credit-ledger version of the idea). All routes below are real routes in this repo. The JDIP text you pasted described a larger architecture; what is actually built here is the working subset. This playbook tests that built subset.

---

## 0. How to use this document

1. **Do the automated baseline first** (Section 13) so we know the machine-checked invariants pass.
2. **Reset to a known state** (Section 1). Never start a manual pass on a drifted database.
3. **Run the perspective flows** in Section 5–8. Each is a numbered test case; record results in
   `docs/qa-test-cases.csv` (same IDs).
4. **Hunt the cross-cutting categories** in Sections 9–12, especially authorization and latency.
5. **File bugs** using the template in Section 12. Evidence means: URL, role, test data, expected,
   actual, screenshot / trace / log, and the elapsed time where relevant.

**Working tip:** use two browser profiles at once — one signed in as the citizen, one as the DC —
because the demo depends on the ADMIN account **not** being able to act as GOVERNMENT (by design).

---

## 1. Environment, credentials and resetting state

### 1.1 Where to run it

| Target | Base URL | Notes |
|---|---|---|
| Production (known live) | `https://milan-ruddy-chi.vercel.app` | Slow deploys and CPU limits; verify here last |
| Local production build | `http://localhost:3000` (`pnpm build && pnpm start`) | Fastest for deep debug |
| Local dev | `http://localhost:3000` (`pnpm dev`) | Hot reload; first-load slower |
| Offline demo stack | `docker compose up -d` + `.env.offline` | Tests the invariant-8 fallback path |
| Supabase DB | use `DIRECT_URL` for SQL | `DATABASE_POOL_MAX=1` is a known deadlock trap |

### 1.2 Seeded demo accounts (password: `milan2026` unless changed in `.env.local`)

| Role | Email | Home after login |
|---|---|---|
| CITIZEN | `sunita@demo.milan.in` | `/me` |
| HEI_MEMBER (BIT Sindri, Civil) | `hod.civil@bitsindri.demo.milan.in` | `/hei` |
| INDUSTRY (Tata Steel Foundation) | `csr@tatasteelfoundation.demo.milan.in` | `/industry/discover` |
| GOVERNMENT (DC Gumla) | `dc.gumla@jh.gov.demo.milan.in` | `/gov` |
| ADMIN | `admin@milan.demo.milan.in` | `/admin/triage` |

### 1.3 Reset to a known state

```bash
# From repo root (uses .env.local / DIRECT_URL)
cp .env.local .env.online        # if you are about to go offline, keep a copy

# Full clean state — truncates and re-seeds
pnpm seed --reset
pnpm sla:backfill                # opens every missing deadline
pnpm ledger:repair               # rebuilds the hash chain if any seed enterties broke it
```

**Or from the UI:** log in as ADMIN → `/demo` → **Reset**. That is the fastest one-second reset.

> Do **not** reset while you are mid-test if you want to observe cross-request behaviour. Reset
> after leaving the demo script state, before the next scenario.

### 1.4 Local DB cheat sheet

```bash
pnpm db:generate   # Drizzle diff (should be additive/no-op for a clean checkout)
pnpm db:migrate    # apply migrations to DIRECT_URL
pnpm seed          # idempotent, re-runnable
pnpm ai:smoke      # provider-chain smoke with AI_PROVIDER_CHAIN=rules for offline
```

---

## 2. Test strategy — what "all perspectives" means here

| Perspective | What they do | Main risk areas |
|---|---|---|
| **Citizen** | Register + OTP, submit a problem, upload/ blur a photo, choose district/pin, approve framing, track it, confirm/dispute an implementation | Frustration, data loss, photos, privacy (EXIF/blur), weird input, no account needed vs needs account |
| **University (HEI)** | Declare capability, read inbox, claim a challenge, form team, add milestones, publish artifact, accept/decline industry interest | Wrong-org isolation, capacity, claim expiry, artifact access control |
| **Industry** | Discover challenges, filter, express interest, respond to EOI, generate MoU, export CSR report | Where does money flow, who sees unconfirmed impact, restricted artifact metadata |
| **Government (DC)** | Gate high-severity challenges, verify in field, view SLA/breaches, toggle emergency mode | District scope, gate release, clock compression/restore |
| **Admin** | Triage low-confidence AI, override routing, verify org proofs, manage challenge state, watch AI runs, demo console | Role wildcard safety, reason-gating on destructive moves, superuser overreach |
| **Public / anonymous** | Landing, `/challenges`, `/track`, `/stats`, `/ledger`, `/bounties`, `/artifact` | What is public vs gated, what looks rounded vs what is real |

**Golden rule for every test:** when the UI shows a number, click it and follow the derivation. If a
score, count or impact figure has no visible breakdown, that is a product bug (CLAUDE.md invariant 10).

---

## 3. Functional test cases

IDs are **C-##** (citizen), **H-##** (university), **I-##** (industry), **G-##** (government),
**A-##** (admin), **X-##** (cross-cutting), **P-##** (performance).

### 3.1 Citizen perspective

| ID | Test | Steps | Expected |
|---|---|---|---|
| C-01 | Register a citizen account | `/register` → role Citizen → fill name/email/password/phone → district optional → submit | Fields validate; OTP screen appears; account is created; no org proof required |
| C-02 | Email OTP | Enter code from email (or mock inbox) | Account unlocks; redirect to `/me` |
| C-03 | Phone/OTP | Use mock SMS inbox; try wrong then right code | Wrong → error; right → unlock; reused code is rejected (single-use) |
| C-04 | Resend OTP spam | Click resend many times rapidly | Deferred/stub: observe whether cooldown exists. **Known gap** — record it |
| C-05 | `next` redirect | Open `/submit` signed out | 307 to `/login?next=%2Fsubmit`; after login return to `/submit` |
| C-06 | Submit wizard — step 1 text | `/submit`, enter <40-char body, try English/Hindi | Blocked below `MIN_BODY_CHARS` (40); >5000 chars blocked; hint in Hindi/English |
| C-07 | Photo upload + EXIF | Upload JPEG with GPS; observe preview | EXIF stripped; `facesBlurred` recorded; no unblurred bytes uploaded |
| C-08 | Photo blur tool | Tap face/plate, blur it, upload, confirm on saved image | Only blurred bytes stored; `faces_blurred=true` |
| C-09 | Upload failure | Disable storage / use invalid file | Challenge still submits; page says photo could not be stored (invariant 8) |
| C-10 | Location — dropdown vs pin | Pick a district; also drop a pin | District wins over GPS/nearest centroid; lat/lng/accuracy stored correctly |
| C-11 | Framing step | Reach step 5, wait for AI proposal; approve / decline | Proposal appears with confidence + provider; unapproved text is **never** stored as `framed_statement` |
| C-12 | Rate limit | Submit 5+ reports in an hour (or repeatedly hit `/api/intake`) | 6th attempt blocked; message gives used count |
| C-13 | Success page | Submit valid challenge | Tracking ID `JH-YYYY-<DIST>-####`; page only visible to signed-in submitter |
| C-14 | My reports | `/me` | See tracking IDs, statuses, priority, pending confirmations |
| C-15 | Confirm / dispute implementation | `/me/verify/<token>` from email/SMS; choose yes/no/partly | Yes → impact counter +1; No/Partly → counter unchanged; No marks claim DISPUTED and notifies DC |
| C-16 | Track anonymously | `/track` with valid and invalid ID | Valid → `/c/<id>`; empty → error; unknown → `notfound` message |

### 3.2 University (HEI) perspective

| ID | Test | Steps | Expected |
|---|---|---|---|
| H-01 | Sign in / role gate | `/hei` as citizen | Redirected/denied; only HEI_MEMBER (or ADMIN wildcard) reaches home |
| H-02 | Org proof gate | New HEI registration, not yet approved | `/hei` redirects to `/verify-account/pending`; can still browse public routes |
| H-03 | Home summary | `/hei` as HOD | Four numbers (inbox, soonest deadline, capacity, active projects) each link somewhere useful |
| H-04 | Inbox | `/hei/inbox` | Only items routed to this org; sorted by soonest deadline; shows rank, reason, breakdown |
| H-05 | Challenge bank filters | `/hei/challenge-bank?domain=X&hazard=Y` | Filters are server-side; "Claim it" only appears when offered |
| H-06 | Claim page — the offer | `/hei/challenges/<tid>/claim` | Shows citizen's original words side-by-side, routing reason, priority breakdown, claim window countdown |
| H-07 | Claim not offered | Try a challenge not routed to this org | "Not available to claim" with an explanation |
| H-08 | Claim form validation | Empty team member name/email, zero/negative capacity, no mentor | Server rejects; no partial project row |
| H-09 | Claim creates readiness | Claim valid offer | Route state→CLAIMED, project created, capacity decremented, deadline created, ledger entry written |
| H-10 | Duplicate/blocking claim | Same challenge claimed by another org | Second org sees not-offered; no double project |
| H-11 | Capability edit | `/hei/capability` toggle/destroy capacity | The page says capacity=0 closes routing; verify the inbox immediately changes |
| H-12 | Milestones | `/hei/projects/<id>` add milestone | Milestone appears with due date; completing it updates `last_activity_at` and shows in feed |
| H-13 | Artifact publish (CC-BY) | Publish an artifact | Stored by SHA-256; metadata + hash in ledger; public page shows prior-art panel |
| H-14 | Artifact publish (RESTRICTED) | Publish restricted | Title/problem/abstract still public; file metadata visible, download gated; access log row on request |
| H-15 | Access request to restricted | Anonymous / other org requests access with purpose | Store request; lead grants/denies; every download logs `access_log` + ACCESS ledger entry |
| H-16 | Silent project | Stale project (or `/demo` fast-forward) | At 30 days flagged AT_RISK, 45 days fork rights, prior team still credited |
| H-17 | Industry EOI response | Receive interest; open `/industry/interests/<id>`; accept/decline | Accept → FUNDER edge, status→INDUSTRY_INTEREST, notification to firm; Decline → firm told |

### 3.3 Industry perspective

| ID | Test | Steps | Expected |
|---|---|---|---|
| I-01 | Org proof gate | New industry account pending | `/industry/discover` redirects to pending verification |
| I-02 | Discovery filters | `/industry/discover` filter district/domain/hazard/solvability | Result set matches every applied filter; Clear blank |
| I-03 | Restricted metadata | Open a challenge with RESTRICTED artifact | Only title/problem/abstract visible; file requires request; "restricted (metadata only)" visible |
| I-04 | Express interest | `/industry/challenges/<tid>` → Express interest, <20 chars message | Reject short; valid creates EOI row + notifies project lead and org |
| I-05 | Duplicate interests | Submit same interest twice | Decide by observation: should either dedupe or explicitly allow duplicates; record outcome |
| I-06 | EOI thread | `/industry/interests/<id>` | Shows requester, message, state, team; can generate MoU |
| I-07 | MoU | `/api/industry/mou?interest=<id>` | Generates PDF, hashes into ledger, page says nobody signs anything |
| I-08 | Accept/decline notification | Have team accept | Firm gets in-app + email notification; challenge status moves; ledger has FUNDER edge |
| I-09 | Unconfirmed impact | Open a challenge in IMPLEMENTED/INDUSTRY_INTEREST/PILOT not yet confirmed | Grey "claimed, not confirmed" tag (not green); no impact counted |
| I-10 | CSR export | `/industry/csr` → CSV/PDF | Confirmed and pending are **two separate beneficiary totals**; never summed; unconfirmed rendered grey |
| I-11 | Wrong-role access | Citizen tries `/industry/discover` or `/industry/challenges/<tid>` | Denied/redirected (or admin wildcard only) |

### 3.4 Government / DC perspective

| ID | Test | Steps | Expected |
|---|---|---|---|
| G-01 | District scope | DC Gumla opens `/gov`, `/gov/gate`, `/gov/sla` | Only Gumla rows; no Dhanbad data even with URL manipulation |
| G-02 | Cross-district server action | Attempt a Gumla officer action on a Dhanbad tracking ID | Refused (403/500) with calm error boundary; not silently no-op |
| G-03 | Human gate | High-severity (≥0.70) challenge in PRIORITISED | `/gov/gate` shows it; `notified_at` is null; no notification sent before confirm |
| G-04 | Gate release | Confirm the gate | Routes release; institutions notified; audit log entry |
| G-05 | Gate override | Override with missing reason | Must reject; mandatory written reason goes to `training_corrections` |
| G-06 | Field verification | `/gov/verification`, endorse a report | `official_endorsed=true`, score changes by 0.06 term, ledger entry written |
| G-07 | SLA board | `/gov/sla` | Breaches at top, most overdue first; open deadlines shown; released-undelivered projects visible |
| G-08 | Emergency toggle | `/gov/emergency` on for flood | Banner statewide; map/list re-sort with ×1.25 label; open flood clocks compress to half time |
| G-09 | Emergency OFF | Turn off | Original due dates restored exactly; nothing stored has been rewritten; audit log with counts |
| G-10 | Impact counter | DC dashboard | Reads only `CITIZEN_VERIFIED`; unconfirmed stays grey |

### 3.5 Admin perspective

| ID | Test | Steps | Expected |
|---|---|---|---|
| A-01 | Admin wildcard | Admin opens citizen/HEI/industry pages | Allowed as a **routing wildcard**; **government is the deliberate exception** |
| A-02 | Home → triage | `/admin/triage` | Low-confidence AI items shown with proposal/confidence/floor; can accept/override |
| A-03 | Training corrections | Override a classification | `training_corrections` row appears with proposed → corrected and reason |
| A-04 | Routing override | `/admin/routing`, reroute an offer | Recorded `S5_ROUTING` correction with reason; existing offer cancelled/updated cleanly |
| A-05 | Org verification | `/admin/verification`; approve HEI proof | New org member unlocks `/hei`; proof document visible only here |
| A-06 | Manage challenge state | `/admin/challenges`, move state | Legal transitions only; reason required; ledger + audit row appended; no SQL DELETE |
| A-07 | AI runs | `/admin/ai-runs` | Every pipeline tick has a row; p50/p95 exclude cache hits; provider/fallback counts |
| A-08 | Bug queue | File a bug anonymously, then view `/admin/bugs` | Bug in separate queue, status toggle works, screenshot renders |
| A-09 | Demo console | `/demo` health strip, run pipeline, gate, claim, publish, +21, implement, confirm | Health strip green; each beat reports; reset restores |
| A-10 | Reset | `/demo` → Reset | One second; health strip green again; ledger header hash new |

### 3.6 Public / anonymous

| ID | Test | Steps | Expected |
|---|---|---|---|
| X-01 | Landing portals | `/`, `/portals/citizens`, `/portals/universities`, `/portals/industry` | Copy matches reality (e.g. "report & full detail need account" is now true) |
| X-02 | Public list/map | `/challenges`, filters, map | Filters validate enums; map draws markers or cleanly says basemap unavailable; clear works |
| X-03 | Challenge detail gate | `/c/<tid>` signed in vs out | Signed out → login redirect; signed in → original words + framed statement + breakdown + credit chain |
| X-04 | Track | `/track` | No login; error paths handled |
| X-05 | Stats | `/stats` | Every number clickable; impact counter = confirmed only; confirmation-gap chart |
| X-06 | Ledger | `/ledger` → Verify chain | Chain verifies green; expand an entry to see payload + file-hash calculator for artifact |
| X-07 | Bounties | `/bounties` | Shows unclaimed/championed challenges, days to expiry, stage, score breakdown, funder if any |
| X-08 | Artifact public | `/artifacts/<id>` | Prior-art panel always visible; restricted file needs request |
| X-09 | Report a bug | `/report-bug` | Anonymous or signed-in; goes to `/admin/bugs`, not the pipeline |
| X-10 | Submit question | `/submit-question` | Blocked unless HEI/INDUSTRY; otherwise routed like a citizen report |

---

## 4. Architectural, authorization and data-integrity tests

These are the highest-value bugs. Run them even when the happy path is green.

**Authorization / isolation**
- **X-A1** Middleware is UX, not security: call a server action / API directly (bypass `/login`
  redirect). Confirm server `requireRole()` / `requireOrgMember()` / `requireDistrict()` rejects.
  Specifically test `/api/intake`, `/api/industry/accept`, `/api/hei/claim`, `/api/admin/*`,
  `/api/verify/confirm`.
- **X-A2** Org isolation: HEI-Member at BIT Sindri should not see another HEI's project page, inbox,
  capability, or be able to respond to another org's EOI.
- **X-A3** District isolation: DC Gumla cannot act/read a Dhanbad row via crafted query/trackingId.
- **X-A4** Admin vs Government: admin is **not** a wildcard for `/gov` decision surfaces. Verify admin
  gets a refusal, not a silent pass.
- **X-A5** Anonymous intake conflict: `/api/intake` comment says anonymous submission is allowed,
  while Phase 4 moved `/submit` behind login. **Decide which is intended and test it explicitly.**
  If anonymous API submissions succeed, verify they still create ledger/credit correctly and this is
  documented as the SMS/WhatsApp seam; if not intended, this is a bug.

**State consistency (the invariants)**
- **X-B1** Invariant 1: after every status transition, the challenge has ≥1 open `sla_deadline`
  row. Test across SUBMITTED → TRIAGED → CLASSIFIED → CLUSTERED → PRIORITISED → VERIFIED → ROUTED →
  CLAIMED → IN_RESEARCH → SOLUTION_PUBLISHED → INDUSTRY_INTEREST → IMPLEMENTED → CITIZEN_VERIFIED.
  Also check the ladder: WIDEN +7d, OPEN_ALL +14d, BREACH +21d, GRAND_CHALLENGE +45d.
- **X-B2** Invariant 2: ledger append-only. Try UPDATE/DELETE from SQL; expect a raising trigger. UI
  should never edit the ledger.
- **X-B3** Invariant 3: S4 has no model calls. Look at `/admin/ai-runs`; S4 rows should have a fixed
  deterministic provider and no model latency spike.
- **X-B4** Invariant 4: routing reason never contains a number not in the supplied scoring terms.
  Open 3 routes and check the "terms → sentence" audit (the page should expose the arithmetic).
- **X-B5** Invariant 5: severity ≥0.70 never releases until DC confirms; `notified_at` remains null.
- **X-B6** Invariant 6: citizen's original words appear beside/above English at equal size on `/c`,
  claim page, project page, industry page. Never behind a toggle.
- **X-B7** Invariant 7: impact counter moves only on CITIZEN_VERIFIED. Check `/stats`, `/gov`,
  `/industry/csr` all read the same counter; a `CLOSED` confirmed row is still counted.
- **X-B8** Invariant 8: unplug third-party APIs (set `AI_PROVIDER_CHAIN=rules`, no storage, no email)
  and run the whole demo — should fall to local providers, never crash.
- **X-B9** Invariant 9: two similar reports merge; older survives; both credited; corroboration
  count increments; the merged row isn't discarded.
- **X-B10** Invariant 10: every priority score has a clickable breakdown with arithmetic; a null
  breakdown is a visible bug.

**Data edge cases**
- **X-C1** Tracking ID: lowercase, whitespace, unknown district code, `null`s, very long, huge page
  size in `/challenges`.
- **X-C2** Corroboration: same user corroborates same challenge twice → blocked by unique index.
- **X-C3** Rate limit: >5/hr; bypass by IP spoofing proxy headers? Note any bypass.
- **X-C4** Media: oversized file, wrong MIME, image bomb (many megapixels), deleted storage object,
  `facesBlurred` flag tampered via API.
- **X-C5** Empty / invalid search params: `?district=XXX`, `?hazard=BOGUS`, `?status=BOGUS`,
  `?band=BOGUS`, `?severity=BOGUS` → should filter to empty or ignore, never 500.
- **X-C6** Closed / terminal states: admin override to CLOSED/MERGED; verify no orphan deadline and
  no illegal edge in `/admin/challenges`.
- **X-C7** Timezone / clock: all `clock_now()` reads agree with demo offset; countdowns don't jump
  weirdly; `Asia/Kolkata`/Asia/Kolkata regions render correctly; no `new Date()` in app code.

---

## 5. Performance / delay testing

This is the category the plan explicitly wants ("how long a loading is taking"). Do this as its own
pass, after functional fixes, on the **production** build, and record median + p95.

### 5.1 Budgets (from `verify:perf`, median of 5, budget 2s)

| Page | Typical local median | Production median (bom1) |
|---|---|---|
| `/challenges` | ~140 ms | ~120 ms |
| `/c/<id>` | ~223 ms | ~128 ms |
| `/bounties` | ~123 ms | ~85 ms |
| `/gov` | ~1019 ms | ~144 ms |
| `/stats` | ~185 ms | ~106 ms |
| `/ledger` | ~230 ms | ~131 ms |

**Acceptable:** median < 2s. **Investigate:** any page > 2s; `/gov` > 2s consistently; p95 > 3x
median.

### 5.2 How to measure delay (do it all)

1. **Server-side (already scripted):** `pnpm verify:perf`. It measures against a production build and
   reports median/worst. Run before/after any change.
2. **Browser waterfall:** open DevTools → Network → record each route. Capture *DOMContentLoaded*,
   *first paint*, *finish*, and the single slowest request. Note whether the slow thing is DB,
   SSE, an external provider call, or an unoptimised image.
3. **API/pipeline stage timing:** `/admin/ai-runs` gives p50/p95 per stage (excludes cache). Watch
   S1/S2/S3/S5. Flag any p95 > 10s on a live call, because the SSE trace will visibly hang.
4. **SSE pipeline trace:** run `/api/pipeline/stream?trackingId=...` and time from the first
   comment line to the final event. Expect ~6–10 s live; record the exact number. Check that
   `Cache-Control: no-cache, no-transform` is served (proxy buffering is a known SSE killer).
5. **First-load cold start:** hit a route in an incognito window right after deploy. Record time to
   interactive. Vercel cold starts and DB (Mumbai) round trips are the usual suspects.
6. **Throttled network:** DevTools → Slow 3G. Re-run submit, `/stats`, `/ledger`. The pages must not
   deadlock; note whether the map/charts push down interaction.
7. **Reaper/`+21 days`:** `/demo` → +21 days locally takes 30–40 s by known issue (WSL→Mumbai round
   trips); on production it's a few seconds. Record actual wall-clock and reason about whether the
   beam is acceptable.
8. **Load sanity (low volume):** 5 concurrent sessions each doing submit/claim/CSR; look for the
   known `DATABASE_POOL_MAX=1` deadlock. If a page hangs and takes the rest down, check the pool.

### 5.3 Delay-related bug template

```
[Performance] Page/flow: ___
Measured: median ___ms / p95 ___ms / worst ___ms
Bottleneck seen in: Network / SSE / DB / provider / image / JS
Budget: ___ms; PASS/FAIL
Repro URL + role + cache state (warm/cold), throttling profile.
```

---

## 6. UI / responsiveness / accessibility testing

Do this at **320px, 375px, 768px, 1024px, 1440px** and in both light/dark themes.

- **X-U1** 320px: no horizontal scroll on `/submit`, `/track`, `/me`, `/challenges`, `/gov/gate`,
  `/industry/discover`. Look for tables breaking the page.
- **X-U2** Touch targets: all buttons/inputs ≥44px (`min-h-11` is used widely; flag anything smaller
  than 44px that is clickable).
- **X-U3** Hindi: `/submit` and `/c` render Devanagari correctly (the repo ships Noto Sans
  Devanagari); no clipped glyphs, no fallback boxes.
- **X-U4** Colour/contrast: both themes; status/role badges must be legible. Known pass: badges carry
  light+dark text.
- **X-U5** Focus/AT: each step heading receives focus on step change; toast errors have
  `role="alert"`; labels tied to inputs; progress counts are spelled out, not just a bar.
- **X-U6** Form errors: submit empty forms, try to advance past blocked step in wizard, test 6th
  rate-limited submit. Errors should be inline and screen-reader announced, not only a toast.
- **X-U7** Empty/error states: `nothing matched`, `no org`, `no projects`, `invalid tracking id`,
  `not available to claim`, DB-down page. Each must be calm, not a stack trace.
- **X-U8** Maps: if `NEXT_PUBLIC_PMTILES_URL` is unset, the map must say so instead of silently
  drawing nothing.
- **X-U9** Skeleton/loading: route transitions show `page-loading.tsx`; SSE trace shows progressive
  steps; no blank flash.
- **X-U10** Phone/real device: (known medium-severity untested) run at least a basic submit + track
  on a physical Android phone, ideally on 3G.

---

## 7. Known risk spots / things someone should actively try to break

These come from code review and `PROGRESS.md` known issues. **Do not assume they are already fixed.**

1. **Anonymous `/api/intake`** — the route doc says anonymous is allowed, but the UX now requires a
   login. Decide the intended behaviour and test it.
2. **`/industry/interests/<id>` uses `requireUser()`** rather than `requireRole("INDUSTRY")`.
   Test whether a signed-in citizen can open another org's EOI thread by UUID and see requester,
   org, challenge, project lead. If yes, decide severity (information disclosure).
3. **Admin is a routing wildcard** (recent change). Test that admin can open HEI/industry pages but
   *cannot* silently fill `/gov/gate` (it must refuse or behave like a distinct decision path).
4. **`/admin/verification` + org proof documents** are served from a public-URL media bucket under
   `org-proofs/`. Test whether they are reachable by guessing URLs, and record whether that's
   acceptable for a hackathon cut.
5. **OTP resend has no cooldown** — record whether a judge can hammer resend; it's a declared gap.
6. **Profile age/DOB** is shown as "Not collected" — verify the profile renders and no broken links.
7. **Package.json literal duplicate keys** (`name`, `dependencies`, `seed:ai`, `@react-map/india`)
   exist. `JSON.parse` tolerates them, but pnpm/CI might behave oddly. Verify `pnpm install` and
   `pnpm build` still succeed from a clean checkout and note this as a repo-hygiene bug.
8. **Demo-card numbers drift** — `docs/DEMO_CARD.md` claims 25 challenges / 208 corroborations; the
   offline seed now produces 183. Compare on-screen `/stats` with the card; if they disagree, that's
   a content/documentation bug.
9. **`/submit/success/<tid>` is now gated** behind login like `/submit`; confirm signed-out deep-link
   redirects correctly (it was public before).
10. **`--reset` / `sla:backfill`** — after reset, confirm the health strip is green and no orphan
    deadlines exist. A reset that leaves state dirty is a demo-killer.

---

## 8. Automated checks to run before manual work

These don't need a browser. They establish the baseline.

```bash
# In repo root, with .env.local populated
pnpm build && pnpm typecheck && pnpm lint
pnpm vitest run                 # 113 tests; invariant.test.ts must return 0 orphans
pnpm verify:clock
pnpm verify:sla
pnpm verify:emergency
pnpm verify:trust
pnpm verify:gov
pnpm verify:provenance
pnpm verify:impact
pnpm verify:industry
pnpm verify:demo
pnpm verify:perf
pnpm verify:seedguard
```

**Offline baseline (invariant 8):**

```bash
docker compose up -d
cp .env.offline.example .env.local   # after saving your online copy
pnpm db:migrate && pnpm seed --reset
pnpm sla:backfill && pnpm build
pnpm verify:demo                     # expect all beats to pass at fallback level 2
```

> If you have no `.env.local`, copy `.env.example` and fill `DATABASE_URL`, `DIRECT_URL`,
> `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SEED_DEMO_PASSWORD`. The app throws at import without
> the DB URL.

---

## 9. Bug report template

```
ID:
Severity: S1 (critical) / S2 (major) / S3 (minor) / S4 (cosmetic)
Category: functional | ui | accessibility | responsive | authorization | data | performance | architectural | offline
Perspective: citizen | university | industry | government | admin | public
URL:
Role signed in: 
Steps:
1.
2.
Expected:
Actual:
Evidence: screenshot / trace / log / perf numbers
Notes:
```

**Severity guide**
- **S1:** data loss, security bypass, wrong-role data access, ledger/eidolon invariant broken, auth
  bypass, crash that takes other routes down, unable to submit.
- **S2:** feature flow fails (claim, publish, interest, CSR export, gate), state not progressing,
  wrong-count/impact math, illegal state transition reachable.
- **S3:** edge cases (invalid filters, empty states, layout at 320px, one-off slow page >2s).
- **S4:** copy, colour, spacing, stale docs.

---

## 10. Suggested first-run script (2 hours, one tester)

1. Reset (`/demo` → Reset or `pnpm seed --reset && pnpm sla:backfill && pnpm ledger:repair`).
2. Run `pnpm vitest run` and `pnpm verify:perf`. Record numbers.
3. Open `/demo` as admin — health strip green.
4. Sign in citizen in profile A; submit a real Hindi report with photo + pin. Record tracking ID.
5. Sign in DC Gumla in profile B; open `/gov/gate`; confirm gate.
6. Run `/demo` → run pipeline → publish → +21 → implement → confirm. Watch timings.
7. Sign in HOD BIT Sindri; check inbox → claim → add milestone → publish artifact.
8. Sign in industry; discover → express interest → view thread → generate MoU → export CSR.
9. Check `/stats`, `/ledger`, `/bounties`, `/challenges`, `/c/<id>` for number/detail consistency.
10. Try the deliberately-broken things in Section 7. Log every one.

---

## 11. Evidence log

Keep a running table (or use `docs/qa-test-cases.csv`):

| ID | Date | Tester | Environment | Result | Comment |
|---|---|---|---|---|---|
| C-01 | 2026-09-08 | ??? | prod | PASS | |
| X-A5 | 2026-09-08 | ??? | local | FAIL | anonymous API submit unexpectedly works |

---

## 12. Links to the product's own honesty docs (read these before judging any finding)

- `docs/LOOPHOLES.md` — the sixteen failure modes and where each answer lives.
- `docs/DEMO_RUNBOOK.md` — the six-minute script, including what goes wrong and the recovery.
- `docs/CRON_SCHEDULE.md` — why the reaper is daily on Hobby, not 5-min.
- `docs/SETUP_GUIDE.md` — environment setup.
- `PROGRESS.md` — known issues and declared stubs; use this to avoid re-reporting deliberate design
  decisions as bugs.
