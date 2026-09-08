# Milan — Complete Pipeline & Workflow

This document traces everything that happens to a citizen's problem from the moment
they start typing to the moment their impact counter increments, plus every
supporting system (SLA clocks, the provenance ledger, credit and trust, roles and
auth) and every screen in the product. It is a reference, assembled from the actual
code (`lib/`, `packages/scoring/`, `app/`), not from the pitch deck — where the two
disagree, this document follows the code.

See `CLAUDE.md` for the ten non-negotiable invariants this whole design exists to
satisfy, and `PROGRESS.md` for the phase-by-phase history of how it was built.

---

## 1. What Milan is, in one pass

Milan converts a citizen's verified local problem into a **time-bound, routed
research assignment** for a university team, with a **hash-chained credit ledger**
so nobody's contribution can be erased, and an **SLA clock** so no challenge can
silently die.

It is a **disaster risk reduction** pipeline that runs in peacetime — mitigation
and preparedness, not emergency response. Every challenge carries an explicit
**NDMA hazard linkage**, and that linkage is a weighted term in the priority score.

It is **not** a grievance portal. CPGRAMS and JharSewa route complaints with a
known fix to an accountable officer. Milan routes **unsolved problems to a lab**.
When a report turns out to be a grievance, S1 detects it and forwards it, and the
citizen is shown exactly what was sent.

The whole product is one Next.js 15 deployable (App Router, RSC), one Postgres
database (Supabase, pgvector + FTS + pg_trgm), one queue substitute (a
transactional outbox table), one AI provider chain (Gemini → Groq → deterministic
rules), and no blockchain, no separate vector DB, no Kafka, no fine-tuned model.
Every module lives in its own folder so it could split into services later without
a rewrite — but this cut ships as one deployable on purpose.

---

## 2. The whole shape, in one diagram

```
citizen / university / industry / government  ──sign in──▶  Better Auth + OTP + org-proof gate
        │
        ▼
   /submit (6-step wizard)  ──or──  /api/intake, /submit-question (HEI/industry)
        │  moderation + rate limit + EXIF strip + client-side face/plate blur
        ▼
   challenges row created, status = SUBMITTED
   SLA deadline opened (STAGE_TIMEOUT), ORIGINATOR credit edge, PROBLEM_TEXT ledger entry
        │
        ▼
┌─────────────────────────────── lib/ai/pipeline.ts ───────────────────────────────┐
│  P0 (language) ──▶ S1 (safety/triage) ∥ S2 (domain/hazard, needs embedding)      │
│                        │                        │                                │
│                REJECT_UNSAFE            embedding (started at t=0, parallel)     │
│                FORWARD_EXTERNAL                 │                                │
│                HUMAN_QUEUE                      ▼                                │
│                CONTINUE ──────────────▶  S3 (duplicates/cluster/roll-up)         │
│                                                  │   S4 (priority score, 0 model  │
│                                                  │        calls — pure function)  │
│                                                  ▼   S5 (routing, computed        │
│                                          MERGED / PARKED   alongside S3 & S4)     │
│                                                  │                                │
│                                                  ▼                                │
│                          severity ≥ 0.70?  ──yes──▶  gated: nothing sent,        │
│                                  │                    waits at /gov/gate          │
│                                 no                                                │
│                                  ▼                                                │
│                     VERIFIED → ROUTED, 3 institutions notified, 7-day claim clock │
└────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
   /gov/gate (human confirms/overrides/rejects)  ──▶ releaseGate() ──▶ ROUTED
        │
        ▼
   HEI claims (7/14/21/45-day SLA ladder if nobody does) ──▶ CLAIMED
        │
        ▼
   research (PROPOSAL_APPROVED → IN_RESEARCH, 30/45-day silence ladder)
        │
        ▼
   SOLUTION_PUBLISHED (artifact hashed + ledgered) ──▶ INDUSTRY_INTEREST (optional)
        │
        ▼
   IMPLEMENTED (a CLAIM, not an outcome — signed link sent to the citizen)
        │
        ▼
   /me/verify/[token]: YES / PARTLY / NO
        │             │            │
        ▼             ▼            ▼
  CITIZEN_VERIFIED  CITIZEN_VERIFIED   DISPUTED (counter does NOT move)
  impact counter++   (partial, counted
  (invariant 7)        separately)
        │
        ▼
      CLOSED (auto, 7 days after confirmation)
```

Running underneath all of it, at every state change, in one transaction:

- **`lib/db/stateMachine.ts`** — the only writer of `challenges.status`. Validates
  the edge, updates the row, appends a ledger entry, cancels the SLA deadlines that
  belonged to the old state, opens the SLA deadlines the new state requires, and
  writes an outbox event — or none of that happens.
- **`sla_deadlines`** — a durable row per open clock. `Vercel Cron` (daily on
  Hobby; every 5 minutes intended) plus the `/demo` console's manual trigger sweep
  due rows and fire ladder actions.
- **`ledger_entries`** — append-only at the database level (a Postgres trigger
  refuses UPDATE/DELETE), SHA-256 hash-chained from a genesis hash.
- **`outbox`** — a plain table standing in for a message queue; drained by the
  nightly cron.

---

## 3. The technology stack (locked, no substitutions)

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, React 19, RSC — one deployable |
| Styling | Tailwind v4 + shadcn/ui (Radix) |
| Map | MapLibre GL (+ Leaflet for the India outline) + Protomaps PMTiles (no basemap loaded this cut — declared stub) |
| Charts | Recharts |
| Auth | Better Auth, organisation plugin, role-based, plus a hand-rolled OTP layer |
| ORM / validation | Drizzle ORM + Zod, one schema, shared contracts |
| Database | Supabase PostgreSQL 17 — pgvector (HNSW), FTS + pg_trgm, deadlines |
| Storage | Supabase Storage (or MinIO offline), every object keyed by its own SHA-256 |
| LLM | Gemini (Flash tier) → Groq (`openai/gpt-oss-120b`) → deterministic rules |
| Embeddings | 768-d, cached on input hash, stored in pgvector; lexical hash fallback offline |
| Realtime | SSE (native `ReadableStream`) for the pipeline trace — no websocket library |
| Hosting | Vercel + Vercel Cron |
| CI | GitHub Actions — build, seed, invariant test |
| Package manager | pnpm |

Deliberately excluded: a blockchain (a SHA-256 chain plus a public timestamp gives
the same non-repudiation at zero cost), a separate vector database (pgvector with
HNSW scales), Kafka (the outbox table covers events at this scale), fine-tuned
models (no labelled data, no GPU budget — few-shot plus an embedding kNN prior,
declared honestly), and a separate API/inference service.

---

## 4. Roles, registration and the verification gate

Five roles have UI: `CITIZEN`, `HEI_MEMBER`, `INDUSTRY`, `GOVERNMENT`, `ADMIN`.
Three more exist in the enum with no separate screen this cut:
`ASSISTED_SUBMITTER`, `INDEPENDENT_INNOVATOR`, `EXPERT_PANEL`.

### 4.1 Registration (`/register`)

Everyone supplies name, email, password, **phone (mandatory)**, preferred
language. GOVERNMENT additionally requires a district. HEI_MEMBER and INDUSTRY
additionally pick their organisation from the seeded list, supply a designation
and a **proof-of-affiliation document** (institutional ID, appointment letter,
GST/CIN, company authorisation letter — PDF/JPG/PNG, ≤5MB, hashed and stored, no
image reprocessing). `registerAction` uploads the proof first (a failed upload
fails the whole registration), calls Better Auth's `signUpEmail`, and in one
transaction inserts a `userProfiles` row (`orgVerificationStatus: PENDING` for
HEI/Industry, `NOT_APPLICABLE` otherwise) and an org-membership row.

Admin self-registration requires `ADMIN_REGISTRATION_CODE` (default
`AUREON_MILAN_BKKPPR`).

### 4.2 OTP verification (`/verify-account`)

Both email and phone must be verified with a 6-digit, 10-minute, single-use code
(`lib/auth/otp.ts`) before the account reaches its dashboard. Codes are hashed
(SHA-256) at rest in Better Auth's own `verification` table under an
`otp:register:<kind>:<value>` key — no separate table, no fight with Better
Auth's `phoneNumber` plugin over who owns `user.phoneNumber`. When no real
gateway is configured (no Resend key, no Twilio credentials — the default), the
code is shown on screen (`demoCode`) rather than the citizen being stuck waiting
for a message that will never arrive.

### 4.3 Organisation approval gate (`/admin/verification`)

HEI and Industry accounts additionally wait for an admin to approve their proof
document before `/hei` or `/industry` pages unlock. `requireRole()` redirects an
unapproved account to `/verify-account/pending`. `decideVerificationAction`
(APPROVE/REJECT, mandatory ≥8-char reason) updates
`userProfiles.orgVerificationStatus` and notifies the applicant.

### 4.4 Server-side enforcement

`middleware.ts` gates routes for UX (redirect before a page renders); the real
check is `lib/auth/guards.ts`, called again inside every server action and route
handler, because middleware can be bypassed by calling an action directly.
`requireRole()` lets `ADMIN` through every non-GOVERNMENT check (a deliberate
wildcard, reversed from an earlier "no implicit superuser" stance, by explicit
owner instruction — admin writes still stamp the actor id and destructive moves
still demand a written reason). `requireDistrict()` is the one place ADMIN is
**not** a free pass: government decisions are a distinct chain of custody, and an
admin clicking through as "government" would blur who actually made the call.

Citizen submission (`/submit`), a single challenge's full detail (`/c/[id]`), and
every `/hei`/`/industry` page require a signed-in account. `/challenges` (the
list), `/track`, `/stats`, `/ledger`, `/bounties` and `/me/verify/[token]` stay
public with no login — the last one deliberately, since it is the one screen that
moves the impact counter and a login wall there would quietly shrink the most
credible number in the product.

---

## 5. Stage 0 — Intake

### 5.1 The citizen wizard (`/submit`)

Six steps, all state held in a `useReducer` and persisted to `localStorage` per
draft so a lost tab on a bad connection does not cost someone their report:

1. **The problem** — free text, Hindi or English, minimum 40 characters
   (`MIN_BODY_CHARS` — "roughly one sentence, the least that can describe a real
   problem"), checked against a deterministic offline moderation pre-filter
   (`lib/moderation/blocklist.ts` — profanity, low-effort/troll phrases,
   character-spam and repeated-word heuristics; not the AI safety stage, which
   runs later with real judgement).
2. **Photo or evidence** — up to 3 photos. Each is **blurred by the citizen on
   their own device** before upload (`photo-blur.tsx`, tap-to-place canvas
   mosaic) — the unblurred original never leaves the phone. Automatic face/plate
   detection is a declared stub; `challenge_media.faces_blurred` records what the
   citizen actually did. On upload the server strips EXIF/GPS (`sharp`,
   `lib/media/upload.ts`) and re-keys the object by the SHA-256 of the *processed*
   bytes.
3. **Where** — Nominatim place search, "use my location" (GPS), tap-to-pin map,
   or district/block dropdown. `lib/geo/nearest.ts` resolves a point to a
   district by **point-in-polygon** over real Jharkhand boundaries
   (`lib/geo/jharkhand-districts.json`), falling back to nearest-centroid outside
   a polygon hit or for block resolution within a district. A pin more than 25 km
   outside every district polygon blocks progress with an explicit
   out-of-coverage message; the dropdown always wins over any automatic guess.
4. **Scale** — a people-affected bucket (never a spurious precise number: stored
   as the bucket's midpoint), recurrence (one-off/seasonal/yearly/constant), and
   a 1–5 self-reported urgency slider.
5. **Wording review** — P1 (`proposeFramingAction`) proposes a `framedStatement`
   and `successCriteria`; the citizen's own words render at equal size and
   weight, never behind a toggle, and they must explicitly tick approval or their
   own words are what ships (`framingApprovedByCitizen`, re-checked server-side).
6. **Review and submit** — a recap, an "include my name" toggle (the name itself
   always comes from the session server-side — no client-supplied name string is
   ever trusted), and the submit button.

`submitChallengeAction` (one transaction): re-runs moderation and a rate-limit
check (`checkSubmissionRate` — five submissions per hour, per-instance memory
this cut), mints a tracking ID (`JH-2026-<DISTRICT>-<SEQ>`, sayable over a
phone), inserts the `challenges` row at `SUBMITTED`, opens the intake SLA
deadline, inserts `challengeMedia` rows, writes an `ORIGINATOR` credit edge,
appends a `PROBLEM_TEXT` ledger entry, and inserts an outbox event.
`/submit/success/[trackingId]` then live-streams the AI pipeline running on that
same challenge.

### 5.2 Other intake seams

- **`/api/intake` + `/api/intake/media`** — the machine-facing version of the
  same server actions, anonymous submission allowed. This is the seam an IVR or
  WhatsApp Business integration would plug into; neither is built this cut.
- **`/submit-question`** — HEI/Industry members submit a problem the same way a
  citizen does (same SLA deadlines, same ORIGINATOR credit edge, same ledger
  entry), tagged with their role/qualification. This is how "universities and
  industries can also submit problems" is satisfied — no separate code path.
- **`/report-bug`** — deliberately *not* a challenge. A platform defect goes to
  `bugReports` and `/admin/bugs`, never into the civic pipeline.

---

## 6. The AI pipeline (`lib/ai/pipeline.ts`)

`runPipeline(challengeId, emit)` runs P0 → S1 → S2 → S3 → S4 → S5 against one
challenge, emitting an event after every stage — what the SSE route
(`/api/pipeline/stream`) streams to `/submit/success/[id]`'s animated trace, and
what `/c/[trackingId]#pipeline` replays afterward from the stored `ai_runs`
receipts. Every stage is wrapped in its own try/catch: a stage that fails emits a
`degraded` event (amber, not red) and the pipeline continues — a broken S5 must
never cost a citizen their S1 triage.

**Concurrency, because latency was a real, measured problem** (a submit-to-S5 run
against a free provider tier was 7–9 s; on the wrong Vercel region it was 23 s):
the embedding starts the instant the pipeline does, in parallel with P0 and S1;
S2 runs concurrently with S1 rather than after it (both read the same text and
neither needs the other's answer); and S5's ranking + three reason sentences are
computed while S3 clusters and S4 scores, since routing depends only on S2's
output and the embedding. Nothing is ever *written* from a speculative branch —
if S1 halts the run, S2's and S5's promises are simply discarded (their
`ai_runs`/cache rows stay, honestly, so a retry after a human releases the hold
is free).

**The provider chain** (`lib/ai/providers/chain.ts`): every model call tries
Gemini, then Groq, then a deterministic rules tier
(`lib/ai/providers/rules.ts`, reading only `lib/ai/gazetteer.ts` — no network at
all). `AI_PROVIDER_CHAIN` controls the order for a deliberately-degraded demo;
`rules` is always appended regardless of what it says. A level-2 (rules) answer
is recorded at 0.45 confidence and, critically, **never overwrites an existing
classification** — it is recorded as a proposal and routed to `/admin/triage`
instead, because replacing an authored domain/hazard with a keyword guess makes
the data worse, silently, in exactly the conditions nobody is watching. Every
call — success or failure, cached or live — writes an `ai_runs` row with its
provider, model, fallback level, confidence, latency and an input hash; a cache
hit still writes a row with `provider: "cache"` so the trace never overstates
what actually ran.

### 6.1 P0 — Language

Transcribes an attached voice note (Groq `whisper-large-v3` live; the demo uses a
seeded ground-truth transcript keyed by content hash — the recording itself is
still a declared stub) and produces an English working copy for any non-English
report. **Never overwrites `body_original`** — the database itself documents
this as an invariant via a column comment (migration 0006). If translation
fails, `body_en` is deliberately left null rather than filled with the original;
rendering the citizen's own script under a heading that says "English working
copy" would be a small lie on a page whose entire argument is that nothing is
hidden.

### 6.2 S1 — Safety and grievance triage

The model (`runS1`) reads the text and reports `is_unsafe`, `is_grievance`,
`grievance_target`, confidence and a rationale. The decision layer
(`lib/ai/triage.ts`, pure, no I/O — testable offline) then decides, in order:

1. **Unsafe** (confidence ≥ 0.60) → `REJECT_UNSAFE`. Media is purged from
   storage (not merely unlinked), the challenge is not published, the citizen is
   shown a helpline (Tele-MANAS, 112, Women's helpline 181, Childline 1098 —
   never a dead end), and the reporter's trust score takes a −0.20 hit (the
   sharp cost that keeps brigading unprofitable — one bad report costs more than
   five good ones earn).
2. **Grievance** (confidence ≥ 0.70) → `FORWARD_EXTERNAL`, **but only if the
   text itself carries hard evidence** — a named scheme, a sanctioned work, a
   withheld entitlement, a bribe (`hasGrievanceEvidence`, against
   `GRIEVANCE_EVIDENCE` in the gazetteer). `FORWARDED_EXTERNAL` is terminal, so
   the model's confidence alone is not sufficient for an action with no way
   back; without textual evidence it falls through to `HUMAN_QUEUE` instead. A
   mock CPGRAMS/JharSewa reference is generated deterministically
   (`mockReference`) and the exact JSON payload Milan *would* POST is rendered
   on the public challenge page (`handoffContract`) — the citizen's own words
   travel with it, untranslated-only version never sent alone.
3. **Below the confidence floor** (< 0.60, which every level-2 rules answer is)
   → `HUMAN_QUEUE`, shown at `/admin/triage`; the challenge stays `SUBMITTED`.
4. Otherwise → `CONTINUE`, transition to `TRIAGED`.

### 6.3 S2 — Domain and hazard classification

Classifies the report into one of ten domains (`WATER`, `HEALTHCARE`,
`AGRICULTURE`, `SANITATION`, `ENVIRONMENT`, `LIVELIHOODS`, `EDUCATION`,
`ACCESSIBILITY`, `URBAN_INFRA`, `PUBLIC_SERVICE`), one of eight NDMA hazard
classes (`FLOOD`, `DROUGHT`, `LANDSLIDE`, `HEATWAVE`, `MINING_SUBSIDENCE`,
`EPIDEMIC`, `FOREST_FIRE`, `NONE`), a hazard strength (0–1), a severity (0–1),
solvability, and whether the fix is capital works (a tender, not a research
question). It is seeded with an embedding kNN prior over already-classified
challenges — the closest thing this system has to "learning" without a
fine-tune. Transitions the challenge to `CLASSIFIED`. Once S2 completes, S5's
routing computation is kicked off in the background (it needs domain, hazard and
the embedding, and nothing S3 or S4 produce).

### 6.4 Embedding

A 768-dimension vector over the challenge's title + English body + district,
computed once, cached on the input hash, stored in `challenges.embedding`
(pgvector HNSW index). Offline, the embedding provider falls back to a hashed
bag-of-words lexical projection into the same 768 dimensions — it captures
shared vocabulary, not shared meaning, and is declared as such, but it is always
available (invariant 8).

### 6.5 S3 — Duplicates, corroboration and roll-up

**Invariant 9: duplicates are signal, not noise. Nothing is ever discarded.**

*Candidate search:* a block-level prefilter (widening to district when the block
has fewer than 20 other challenges) followed by a cosine-similarity kNN over
pgvector (or an in-process cosine scan when pgvector is unavailable), returning
up to 10 candidates.

*The bands:* cosine ≥ 0.86 is `AUTO_MERGE` (no model call); 0.72–0.86 is
`ADJUDICATE` (the model answers one boolean — "same problem?" — seeing only the
two texts and the similarity score); below 0.72 is `DISTINCT`. Exactly one
adjudication call is spent per run, on the nearest ambiguous candidate — if the
model says that one is different, further candidates are further away and would
answer the same. A report S1 already held for a human is still compared (so a
reviewer sees the likely duplicate) but is never actually merged — an AI must
not take an irreversible action on an item it has already admitted it is unsure
about.

*The merge:* always survivor = the **older** report (tracking ID breaks a
same-instant tie), one transaction: a corroboration row for the merged report's
reporter (distance-weighted — full weight within 15 km, exponential decay beyond
it, never reaching zero), the survivor's `corroboration_count` incremented, a
`CORROBORATOR` credit edge on the survivor (the merged report keeps its own
`ORIGINATOR` edge, untouched — nothing is deleted, nothing is double-counted),
both reporters awarded merge trust (+0.03 each), a `CREDIT_EDGE` ledger entry
explicitly stating "nothing was discarded," and the merged challenge transitions
to `MERGED` (terminal). The merged report's own page still exists and still
shows its own credit chain; it just now shows it was merged into the survivor.

*The roll-up:* three or more distinct challenges, spread across two or more
blocks, similar enough (cosine ≥ 0.62) in the same district, spawn a new
`BLOCK_SYSTEMIC` parent challenge — a real, routable, scorable row whose body
lists its children. Children keep their own pages, their own statuses, their own
credit chains; `parent_id` links without consuming. Named after what the
children actually *share* (mode of hazard, then domain), not after whichever
report happened to trigger the check.

*Anti-brigading* (`scanForBrigading`): more than 3 corroborations from one
device fingerprint, or more than 25 in one hour, is flagged and that
fingerprint's weight is zeroed (never deleted — it stays visible as evidence
someone tried); corroborations from more than 150 km away are flagged as
down-weighted rather than removed.

Not merged → transition to `CLUSTERED`.

### 6.6 S4 — The priority score (zero model calls)

**"Is the AI deciding who gets help?" — no.** `packages/scoring/score.ts`
(`computePriority`) is a pure function: no database, no network, no clock read,
no model call reachable from it at all. Seven weighted, normalised terms
(weights sum to exactly 1.00, asserted in `tests/scoring.test.ts`):

| Term | Weight | Source | Normalisation |
|---|---|---|---|
| Severity | 0.22 | S2 (AI) | Clamped 0–1 |
| Hazard linkage | 0.20 | S2 (AI) | `hazard_strength`, or 0 if hazard is NONE |
| People affected | 0.15 | Citizen's own estimate | `log(1+n) / log(1+100,000)` — log-normalised on purpose, so a hamlet of 300 is not systematically outranked by a town of 6,000; equity is a deliberate design choice |
| Block vulnerability | 0.15 | Seeded district disaster-management plan | Already 0–1 |
| Corroborations | 0.12 | S3, trust-weighted (v1.1.0) | `sqrt(n) / sqrt(50)`, capped — diminishing returns bound a brigading attack's payoff |
| Recurrence | 0.10 | Citizen's own answer | one-off 0.25 / seasonal 0.6 / yearly 0.8 / constant 1.0 |
| Official endorsement | 0.06 | A block officer at `/gov/verification` | 1 or 0 — small on purpose: it should help, never decide |

Every term's raw value, normalised value, weight and contribution
(`weight × normalised`, rounded *before* multiplication so the visible
arithmetic on screen checks out by hand) is returned and rendered on the public
challenge page (`<PriorityBreakdown/>`) — invariant 10. The total is scaled to
0–100. `SCORING_VERSION` is stamped onto every stored score, so a re-score under
new weights never silently reinterprets an old number.

**v1.1.0** added `corroborationTrustWeight`: the mean trust (0–1) of the
signed-in people who corroborated, centred on the 0.50 baseline so an unknown
crowd counts exactly as it did in v1.0.0 — no retrospective inflation. Advances
to `PRIORITISED`.

**The routing bar:** a score below 85/100 does **not** route to any institution
— it is `PARKED` instead (with the full breakdown still shown, at `/flagged`, as
the answer to "why didn't this route"), and re-enters routing automatically at
its annual review, or sooner if new corroborations or facts lift it.

### 6.7 S5 — Capability routing and the human gate

**The match score** (`lib/ai/routing.ts`, pure, versioned) is five weighted
signals against the Institutional Capability Graph:

| Signal | Weight | What it measures |
|---|---|---|
| Semantic fit | 0.45 | cosine(challenge embedding, capability embedding) |
| Specialisation overlap | 0.20 | Jaccard of the lab's tags against domain+hazard keyword expansion |
| Distance | 0.15 | `exp(-km / 250)` — decays to 1/e at 250 km; unknown coordinates score a neutral 0.4 |
| Declared capacity | 0.12 | Capstone slots declared open in the current window, capped at 5 |
| Track record | 0.08 | Delivered projects in this domain, Laplace-smoothed (prior = 3) so one-for-one does not outrank nine-for-ten |

Ranked, then the top **3 distinct organisations** (never two labs at one
college — a shortlist of three departments in one place is not a shortlist).

**The guardrail** (invariant 4): the model writing each routing reason sentence
is handed *only* the top three contributing terms — no challenge text, no
institution facts beyond what's in those terms. `guardReason()` then rejects any
sentence containing a number (digit or spelled-out word one through ten) that
was not in the supplied facts, or that does not name the institution. A rejected
sentence falls back to a blunt template assembled from the same three facts.
This is a structural guarantee in code, not a prompt instruction.

**The human gate** (invariant 5): at severity ≥ 0.70, `persistRoutes()` writes
the three offers with `notified_at = null` — nothing is sent, the challenge sits
at `VERIFIED` (pending), and only `releaseGate()` — triggered by a District
Collector's confirmation at `/gov/gate` — sends the notifications and advances
to `ROUTED`. A second, subtler gate: a challenge S1 or S2 held for a human is
still `SUBMITTED`, and nothing is offered to a university until the platform is
confident enough to have moved the challenge past triage, even if S5 computed a
shortlist for the reviewer to see.

Below the threshold and ready to route: `VERIFIED` → `ROUTED` immediately, three
institutions notified (push, straight to the claim page — never a list), 7-day
claim clock starts.

---

## 7. The human gate (`/gov/gate`)

Every `PRIORITISED`/`VERIFIED` challenge at severity ≥ 0.70 in the officer's own
district (district-scoped, re-checked server-side by `requireDistrict`,
independent of middleware) appears here with the citizen's words and English
copy side by side, the full priority breakdown, and the shortlist marked "not
notified — held at this gate." Three outcomes, each writing `auditLog`:

- **Confirm** — `releaseGate()`: VERIFIED → ROUTED, notifications actually sent.
- **Override** — a mandatory ≥10-character reason, an optional corrected
  severity, written to `trainingCorrections` (becomes labelled data for the next
  embedding-kNN prior — Milan does not fine-tune, but every human correction
  makes the next automatic answer a little better).
- **Reject** — `PARKED` (with its automatic annual re-review), also logged to
  `trainingCorrections`.

A `GATE_TIMEOUT` SLA deadline (3 days, escalating) makes sure the wait itself
never becomes an invisible bottleneck — invariant 1 does not carve out an
exception for "waiting for a human."

---

## 8. Post-routing lifecycle

### 8.1 Claim (`/hei/inbox`, `/hei/challenge-bank`, `/hei/challenges/[id]/claim`)

A department claims within the 7-day window (or after it widens/opens — §9). One
transaction (`claimChallengeAction`/`claimAs`): a `projects` row, a
`projectMembers` row per named team member, a `TEAM_MEMBER` credit edge per
member (credited by **name**, never email — an unregistered student is still
credited and can attach an account later), a `MENTOR` edge, and — unless
explicitly declined — a `TEAM_MEMBER` edge for the **reporter**, by default as
"Domain Informant." The winning route flips to `CLAIMED`; the other two offers
expire (nobody double-claims); the department's declared capacity decrements by
one; the challenge transitions to `CLAIMED`; the citizen is notified that a team
has taken on their report and that only they can confirm whether it's actually
solved.

### 8.2 Research (`/hei/projects/[id]`)

`CLAIMED` → `PROPOSAL_APPROVED` → `IN_RESEARCH`. A milestones panel; every write
resets `projects.last_activity_at`, which is what the silence ladder (§9.3)
measures against — not the claim date, the last thing the team actually did.

### 8.3 Publication (the artifact panel)

`publishArtifact()`: the file is keyed by the SHA-256 of its own bytes (same
bytes uploaded twice is one object — free dedup, and a ledger entry can cite the
file by a hash anyone holding it can recompute). Title, problem statement and
abstract are **always public regardless of licence** — a RESTRICTED licence
locks the *file*, never the knowledge that the work exists (declared explicitly
against "loophole row 11": making a citizen's problem disappear by restricting
it). A `REPORT` ledger entry commits to the file's own content hash. Challenge
transitions to `SOLUTION_PUBLISHED`.

**Restricted access**: a signed-in visitor requests access with a stated
purpose (`accessRequests`); the project lead grants or denies with a note;
every actual download of a restricted file — granted request or team member —
writes an `access_log` row **and** an `ACCESS` ledger entry in the same
transaction as the authorisation check. CC-BY files download to anyone, with
attribution, no log required beyond the public record.

### 8.4 Industry interest and CSR (`/industry/*`)

A firm expresses interest (`industryInterests`, state `EXPRESSED`); the project
lead accepts (writes a `FUNDER` credit edge, transitions to
`INDUSTRY_INTEREST`) or declines. An MoU PDF (`/api/industry/mou`) is generated
from a template, SHA-256 hashed, and the hash appended to the ledger — explicitly
an **unsigned draft**; e-signature and payment rails are declared stubs, and the
document says so on its own face. `AGREEMENT_SIGNED` and `PILOT` exist in the
enum, wired into the state machine, with no UI this cut.

The §135 CSR report (`/industry/csr`, `/api/industry/csr?format=csv|pdf`) is one
SQL query used identically by the screen, the CSV and the PDF, so the three can
never disagree. Its central discipline: **Confirmed / Partly confirmed / Claimed
but not confirmed** are three separate counters, never summed into one
flattering number — the reason a company can defend this document to its
auditor, per the file's own comment.

### 8.5 Implementation claim and citizen confirmation

`markImplemented()`: challenge → `IMPLEMENTED` (deliberately **not** terminal —
an implementer's claim is not an outcome). Every corroborator and the reporter
receive a signed link (`/me/verify/[token]`, HMAC over the challenge id,
90-day TTL, no login required). An `IMPACT_UNCONFIRMED_30` SLA deadline opens so
a citizen who never answers is asked again rather than quietly counted as a
success.

Three answers, one action (`confirmImpact`), and this is the **entire**
definition of the impact counter (invariant 7 — `lib/impact/counter.ts` is the
one place any surface reads it):

- **YES** → `impact_confirmed = true`, `CITIZEN_VERIFIED`, reporter trust +0.10,
  every backing corroborator's trust +0.05. **The counter moves here, and
  nowhere else in the codebase.**
- **PARTLY** → `impact_confirmed = true` *and* `impact_partial = true` — counted
  in a separate bucket, never rounded up into "confirmed."
- **NO** → `impact_disputed = true`, `DISPUTED`, the District Collector
  notified. **The counter does not move.**

`CITIZEN_VERIFIED` opens a `CLOSURE_DUE` deadline (7 days); the reaper closes it
automatically — "bookkeeping is on a clock too."

---

## 9. The SLA engine

**Invariant 1: every challenge in a non-terminal state carries at least one open
`sla_deadlines` row, always.** `lib/sla/deadlines.ts` (`deadlinesFor`) is a pure
function covering all 22 non-terminal states — not only the seven the original
build plan named, but every pipeline stage, the human gate, the closure step and
a dispute too, because a challenge stuck at `CLASSIFIED` from a crashed pipeline
run is exactly the silent death this exists to prevent. `tests/invariant.test.ts`
is a required CI check that this count is zero.

### 9.1 Ladder 1 — nobody claimed it

```
ROUTED  ──+7d (WIDEN)──▶  UNCLAIMED_ESCALATED  ──+7d more (OPEN_ALL, day 14)──▶
      open_to_all=true  ──+7d more (BREACH, day 21)──▶  BOUNTY_LISTED
      sla_breached_at set  ──+24d more (GRAND_CHALLENGE, day 45)──▶  annual re-review
```

- **WIDEN** (day 7): re-runs S5 for five more institutions (computed *before*
  the reaper's transaction opens, so a slow model call never holds a row lock),
  offers them, notifies.
- **OPEN_ALL** (day 14): visible and claimable in every `/hei/challenge-bank` in
  the state, district officer notified.
- **BREACH** (day 21): `sla_breached_at` stamped, listed on the public
  `/bounties` board, district officer + admins notified.
- **GRAND_CHALLENGE** (day 45): joins the annual Jharkhand Grand Challenges set;
  an `ANNUAL_REVIEW` deadline (365 days, never compressed by Emergency Mode)
  keeps it from ever truly falling off the board.

The escalation states carry the **remainder** of the ladder, not a fresh copy —
`UNCLAIMED_ESCALATED`'s `OPEN_ALL` fires 7 days after entering it, which is day
14 from the original routing, the same absolute date the `ROUTED` row named.
(A state change cancels the deadlines belonging to the state being left, so
without this the ladder would silently reset every time it climbed a rung.)

### 9.2 Ladder 2 — claimed, then silence on the proposal

`CLAIMED` opens `PROPOSAL_DUE` at +14 days: nudges the lead and the head of
department, then re-opens itself at +7 more (day 21). At day 21 the claim is
**released** — the project row is marked `RELEASED_UNDELIVERED` (never deleted),
the offer routes clear back to `ROUTED`, and the prior team's project, credit
edges and any partial work are preserved and attributed, permanently. "We do not
stop people from sharing work. We make it impossible to erase who did it"
applies to a team that failed to deliver as much as to one that succeeded.

### 9.3 Ladder 3 — a claimed team goes quiet

`PROPOSAL_APPROVED`/`IN_RESEARCH` opens `SILENT_30` and `SILENT_45`, measured
from `projects.last_activity_at` (not the claim date). At 30 days: the project
is publicly flagged `AT_RISK`, the mentor is nudged. At 45: **fork rights open**
— another team may fork the work, with the original team's project and credit
edges kept intact and visible on the fork.

### 9.4 Coverage rungs (invariant 1's full guarantee)

Four `sla_kind` values exist purely so every non-terminal state — not just the
ladder states — carries a clock: `STAGE_TIMEOUT` (a pipeline stage or a citizen
follow-up stalled), `GATE_TIMEOUT` (§7), `CLOSURE_DUE` (§8.5), `DISPUTE_REVIEW`
(a `DISPUTED` challenge waiting on district review). `PARKED` is terminal for
routing purposes but always carries an `ANNUAL_REVIEW` deadline, which is how
"parked" avoids being "forgotten."

### 9.5 The reaper

`lib/sla/reaper.ts`: `SELECT ... FOR UPDATE SKIP LOCKED` over due, un-fired,
un-cancelled deadlines, one transaction per row (two overlapping cron runs
cannot double-fire the same deadline). Anything slow — WIDEN's re-run of S5,
`ANNUAL_REVIEW`'s rescoring — is computed *before* the transaction opens
(`lib/sla/prepare.ts`) so a four-second model call never holds a database lock.
After every action, `ensureOpenDeadline()` re-asserts invariant 1 directly
against the database as a backstop — if it ever fires in practice, that is
logged in the ledger payload as a bug in the action that should have opened its
own follow-on clock.

Vercel Cron drives `/api/cron/reaper` (bearer-authenticated by `CRON_SECRET`,
constant-time compare) daily on the Hobby plan (a sub-daily cron fails the whole
deployment on Hobby — this is a plan limit, documented, not silently accepted);
`/demo`'s clock buttons trigger it manually and immediately for the judge
console. `/api/cron/nightly` separately rescores every challenge, decays every
reporter's trust, drains the outbox, and anchors the ledger head.

### 9.6 Emergency Mode's effect on the clock (`/gov/emergency`)

A District Collector pins one NDMA hazard. Every open, non-`ANNUAL_REVIEW`
deadline on a challenge linked to that hazard is compressed to half its
remaining time (`EMERGENCY_TIME_SCALE = 0.5`), **reversibly** — the
pre-emergency due date is kept in the row's own payload and restored exactly
when the toggle switches off. Nothing here changes a stored priority score;
lists re-sort by a bounded (×1.25 max), clearly labelled, display-only "surge"
multiplier (`lib/emergency/surge.ts`) so a weak linked problem can rise above a
slightly stronger unlinked one but never float above a genuinely severe one.
Declared as a filter on the officer's screen, explicitly — not a claim of a
separate emergency response system, which remains a stub (no standing-capacity
surge routing, no separate response queue).

---

## 10. The provenance ledger

**Invariant 2: append-only, enforced at the database level** by a Postgres
trigger that refuses UPDATE and DELETE on `ledger_entries` (migration 0002) —
not by application convention.

### 10.1 The hash chain (`lib/ledger/hash.ts`, pure — runs identically in the
browser for the "Verify chain" button)

`canonicalJson()` sorts object keys at every level, drops undefined/function
values, serialises dates as ISO-8601 — so any third party can recompute a hash
and get the same answer, which is the entire point of not using a blockchain.
`contentHashOf(payload) = sha256(canonicalJson(payload))`.
`entryHash = sha256(canonical({seq, contentHash, prevHash, authorId, createdAt}))`.
Changing any earlier payload changes its content hash, which changes its entry
hash, which is the next entry's `prevHash` — verification fails from the
tampered entry onward and names its `seq`.

### 10.2 Appending (`lib/ledger/append.ts`)

Runs inside the **caller's** transaction (a state change, its ledger entry, its
SLA deadlines and its outbox event are one atomic fact) and takes a Postgres
advisory transaction lock first, so two concurrent appends cannot both read the
same tip and fork the chain. The tip is defined as the last entry that actually
*has* a hash — a hard-won fix after a real incident where a direct-insert call
site left a null-hashed row that poisoned every append after it; a test now
fails the build if anything outside this one file inserts into
`ledger_entries`.

### 10.3 Verifying (`lib/ledger/verify.ts`)

Walks the chain in pages of 500 from genesis, checking link integrity
(`prevHash` matches the prior entry's `entryHash`) and payload integrity
(recomputed content hash matches the stored one, or — for a file-backed entry
like an artifact — the payload's declared hash matches the column). Phase 1/2
entries, hashed before `canonicalJson` existed, are covered by a separate
**legacy seal**: one chained entry recording the canonical hash of each old
payload as it stood at sealing time, so tampering with a legacy payload still
disagrees with the seal, and tampering with the seal breaks the chain — coverage
is complete from genesis, only the mechanism differs, and `/ledger` says so.

**What verification proves, precisely, stated on `/ledger` in plain words**: no
entry has been altered or removed since it was written, and the order is the
order it claims. It does **not** prove that what someone wrote was true, and it
does not prove *when* it was written unless a daily `ANCHOR` entry for that
range has been externally timestamped (`OPENTIMESTAMPS_ENABLED`, off by default
— the anchor is still written, and `/ledger` says there is no third-party
timestamp rather than implying one).

### 10.4 What gets an entry

Nine kinds: `PROBLEM_TEXT` (submission), `MEDIA`, `PROPOSAL` (claim, MoU),
`REPORT` (artifact publication), `STATE_CHANGE` (every transition, every SLA
firing), `CREDIT_EDGE` (a merge), `ACCESS` (a restricted download),
`OVERRIDE` (a human gate override, a rejection), `ANCHOR` (the daily timestamp,
the legacy seal).

---

## 11. Credit and trust

### 11.1 Credit edges — the permanent, public record

`credit_edges` rows (`ORIGINATOR`, `CORROBORATOR`, `TEAM_MEMBER`, `MENTOR`,
`FUNDER`) are never deleted and never reassigned. A merge adds a
`CORROBORATOR` edge without touching the merged report's own `ORIGINATOR`
edge. A claim credits every named team member by **name** (never email — the
email links an account and sends a notification, and stays out of the public
page). The reporter is credited on the project team by default. `/credit/[userId]`
is the permanent public record for a person; `/c/[trackingId]#credit` is the
per-challenge chain.

### 11.2 Reporter trust (`lib/credit/trust.ts` + `trust-writers.ts`)

A single writer module (`adjust()`, private) is the only code path allowed to
touch `user_profiles.trust_score` — everything else goes through a named,
audited event, each writing an `auditLog` row.

- **+0.10** — a report of yours the citizen confirmed (`CITIZEN_VERIFIED`) — the
  strongest evidence there is.
- **+0.05** — a corroboration of yours on a challenge that was confirmed.
- **+0.03** — your duplicate report merged as signal (both sides of a merge get
  this).
- **−0.20** — a report of yours rejected as unsafe. Deliberately larger than
  five good events combined, so brigading a false narrative and then reporting
  something real does not net out to zero.
- **Decay** — every profile drifts 3% per day (`TRUST_DAILY_DECAY = 0.97`, a
  roughly 23-day half-life) back toward the 0.50 baseline, applied nightly, idle
  accounts unaffected (0.50 is a fixed point). Good standing must be renewed;
  bad standing is forgivable.

v1.1.0 feeds this into scoring: `corroborationTrustWeight` multiplies S4's
corroboration term by the mean trust of the people who backed a report, centred
so an unknown crowd (mean trust exactly 0.50) scores identically to v1.0.0.

---

## 12. Notifications ("push, never browse")

`lib/notify/index.ts` is the single interface behind four channels: an
always-written in-app row, email (Resend online, Mailpit offline, honestly
reported as "not configured" with neither), SMS (Twilio if fully configured,
otherwise a mock inbox whose exact message is written to `outbox` and shown on
`/demo`), and WhatsApp (same mock-inbox pattern, declared stub). A hard
assertion (`assertPushNotBrowse`) throws — as a programming error, not a runtime
condition — if any notification's action URL points at a list page
(`/hei/inbox`, `/challenges`, `/gov`, `/admin`, `/bounties`,
`/industry/discover`); every notification must point at the one specific thing
to act on. No channel failing may fail the caller (invariant 8) — a challenge
that routed correctly but could not send an email has still routed correctly.

---

## 13. Route-by-route reference

### 13.1 `(landing)` — public, unauthenticated

- **`/`** — live counts pulled from the database (never hardcoded), a plain-
  language six-step pipeline explainer, links into the three portals.
- **`/portals/{citizens,universities,industry}`** — static orientation pages
  per audience.

### 13.2 `(auth)` — see §4 in full

`/login`, `/register`, `/logout`, `/forgot-password`, `/post-login`,
`/verify-account`, `/verify-account/pending`.

### 13.3 `(citizen)`

- **`/submit`** — the six-step wizard (§5.1).
- **`/submit/success/[trackingId]`** — the live pipeline trace (§6), then the
  tracking ID and next steps.
- **`/me`** — the citizen's own reports, corroborations and full credit record,
  with a PDF export (`/api/me/export`).
- **`/me/verify/[token]`** — the impact confirmation screen (§8.5), no login.

### 13.4 `(public)`

- **`/challenges`** — the public map + filterable list of every challenge;
  honours Emergency Mode's display surge.
- **`/c/[trackingId]`** — the canonical page: lifecycle stepper, original text
  beside the English copy, framing, voice/evidence panels, corroboration button,
  threaded comments, the full priority breakdown (`#score`), the routing
  shortlist or gate-held notice (`#routing`), the grievance handoff contract if
  forwarded (`#forwarded`), the replayable pipeline trace (`#pipeline`), and the
  credit chain (`#credit`).
- **`/track`** — resolve a tracking ID to its page, no login.
- **`/stats`** — statewide numbers in one SQL round trip: the impact counter and
  confirmation gap, a district heatmap, the pipeline funnel, an institutional
  leaderboard.
- **`/ledger`** — the public hash chain, paginated, with a "Verify chain" button
  that runs the same verification code in the browser.
- **`/bounties`** — every escalated, unclaimed challenge, filterable, each
  linking straight to its claim page.
- **`/credit/[userId]`** — a person's permanent public credit record and trust
  tier.
- **`/artifacts/[id]`** — an artifact's public metadata always, its file behind
  a licence/access check, a public access log for restricted files.
- **`/flagged`** — every `PARKED` challenge that fell under the 85-point routing
  bar, with its full breakdown — the transparency page for "why didn't this
  route."
- **`/report-bug`**, **`/submit-question`** — see §5.2.

### 13.5 `(hei)` — `requireRole("HEI_MEMBER")`

`/hei` (dashboard), `/hei/inbox` (routed offers), `/hei/capability` (declare
departments/tags/capacity — explains the five match weights live),
`/hei/challenge-bank` (every open challenge, claimable if actually offered),
`/hei/challenges/[trackingId]/claim` (the claim form, §8.1),
`/hei/projects/[id]` (workspace: milestones, credit chain, artifact panel,
activity feed).

### 13.6 `(industry)` — `requireRole("INDUSTRY")`

`/industry/discover` (open challenges), `/industry/challenges/[trackingId]`
(detail + express interest), `/industry/interests/[id]` (EOI thread, MoU link),
`/industry/solutions` (published work), `/industry/csr` (§8.4).

### 13.7 `(gov)` — `requireRole("GOVERNMENT")`, district-scoped

`/gov` (dashboard), `/gov/gate` (§7), `/gov/verification` (field endorsement —
re-scores live on endorsement), `/gov/sla` (the district's SLA board),
`/gov/emergency` (§9.6), `/gov/district/[code]` (a read-only district
reference).

### 13.8 `(admin)` — `requireRole("ADMIN")` (a wildcard for every other role
check except GOVERNMENT)

`/admin/triage` (the low-confidence human queue — accept/override, both become
labelled training data), `/admin/routing` (manual reroute, guardrail explained),
`/admin/ai-runs` (every model call's receipt, p50/p95 per stage — the "the
trace is real" proof), `/admin/verification` (§4.3), `/admin/stats` (numbers
only), `/admin/challenges` (state override with a mandatory reason — this is
"delete": a transition to a terminal state, never a SQL DELETE),
`/admin/bugs` (platform defects, kept out of the civic pipeline), and
**`/demo`** — the judge console: a health strip, clock controls that advance
time and immediately reap (showing every ladder action that fired), six
scenario buttons that drive the seeded hero challenge through pipeline → gate →
claim → publish → implement → citizen-confirm using the *exact same production
server actions* the real UI calls (never a shortcut), mock SMS/WhatsApp/email
inboxes, and a state reset that restores demo *state* without ever touching the
ledger.

### 13.9 `app/api/` — every route handler

| Route | Purpose |
|---|---|
| `pipeline/stream` | SSE live trace of the AI pipeline |
| `pipeline/run` | Fire-and-forget pipeline start (no stream) |
| `pipeline/trace` | Poll-friendly JSON snapshot from stored receipts |
| `intake`, `intake/media`, `intake/framing` | Machine-facing submission seam |
| `cron/reaper` | The SLA reaper (`CRON_SECRET`) |
| `cron/nightly` | Rescore, trust decay, outbox drain, ledger anchor |
| `demo/{clock,beat,reset,impact}` | HTTP wrappers for the judge console |
| `ledger/verify` | Public chain verification |
| `gov/export` | District CSV export |
| `hei/claim` | Machine-facing claim |
| `industry/{accept,csr,mou}` | EOI response, CSR export, MoU PDF |
| `me/export` | Citizen's credit record as PDF |
| `verify/confirm` | Machine-facing impact confirmation |
| `admin/triage`, `admin/verification-document` | Triage wrapper; proof-doc streaming |
| `artifacts/download` | Gated artifact file serving, with the access log write |
| `auth/[...all]` | Better Auth's own catch-all |

---

## 14. Invariants and where each is enforced

| # | Invariant | Enforced by |
|---|---|---|
| 1 | No challenge may silently die | `lib/sla/deadlines.ts` covers all 22 non-terminal states; `tests/invariant.test.ts`, a required CI check, returns 0 orphans |
| 2 | The ledger is append-only | A Postgres trigger (migration 0002); `tests/ledger.test.ts` forbids any insert outside `lib/ledger/append.ts` |
| 3 | The AI proposes, code decides | `packages/scoring` is pure and import-asserted; S4 makes zero model calls |
| 4 | The AI never invents a routing reason | `guardReason()` rejects any sentence with a number not in the supplied facts |
| 5 | Human gate at severity ≥ 0.7 | `persistRoutes()` writes `notified_at = null`; only `/gov/gate` releases it |
| 6 | The citizen's words are never hidden | Rendered beside `body_en` at equal size everywhere; a column comment in migration 0006 |
| 7 | The impact counter moves only at `CITIZEN_VERIFIED` | One definition, `lib/impact/counter.ts`, read by every surface |
| 8 | Nothing depends on a live third-party API | Every AI stage falls to deterministic rules; storage/mail/timestamping sit behind local-implementation interfaces |
| 9 | Duplicates are signal | S3 merges and rolls up; both reporters are credited on `MERGED` |
| 10 | Every number is clickable to its derivation | `<PriorityBreakdown/>` on the public page, arithmetic visible |

---

## 15. Declared stubs (said out loud on purpose)

IVR/WhatsApp Business intake · SMS/WhatsApp delivery (mock inboxes, DLT
registration needed for real) · offline PWA sync (localStorage drafts stand in)
· fine-tuned models (few-shot + embedding kNN prior instead; every human
correction becomes training data) · full ten-language coverage (Hindi, English,
one Santali sample) · a live CPGRAMS/JharSewa write API (the exact payload is
rendered instead) · self-serve institutional onboarding · e-signature/payment
rails (the MoU is generated and hashed, never signed) · automated document
verification at `/admin/verification` (a human looks at the file) · patent/DOI
integration · automatic face/plate detection (citizen-driven blur instead — a
stronger privacy claim, since the unblurred original never leaves the device) ·
a separate live emergency response queue and automatic surge-routing (the
compression + display surge in §9.6 are built; the rest is not) · a PMTiles
basemap (markers draw on a blank canvas, and say so) · block-level boundary
geometry (districts are polygon-resolved; blocks remain nearest-centroid) · a
third-party timestamp on the daily ledger anchor by default.

---

## 16. Key tables, at a glance

`districts`, `blocks` — geography, seeded with real Jharkhand data.
`user_profiles`, `organisations_meta` — identity, role, trust, org verification.
`capabilities` — the Institutional Capability Graph S5 routes against.
`challenges` — the spine; every pipeline output, every SLA flag, every impact
flag lives on this one row. `challenge_media`, `corroborations`,
`challenge_comments`, `clusters` — everything attached to a challenge.
`routes` — one row per offer to one institution. `projects`, `project_members`,
`milestones` — the research side. `sla_deadlines` — invariant 1's ledger of open
clocks. `ledger_entries` — invariant 2's append-only chain. `credit_edges` —
the permanent public credit record. `artifacts`, `access_log`, `access_requests`
— publication and restricted access. `notifications`, `outbox` — delivery and
the event log. `ai_runs`, `ai_cache`, `training_corrections` — every model call,
cached and auditable. `audit_log` — every human override, everywhere. `demo_state`
— the one row the clock offset, Emergency Mode and trust-decay bookkeeping live
in. `industry_interests`, `impact_confirmations` — the industry and
confirmation loops. `bug_reports` — deliberately outside the civic pipeline.
