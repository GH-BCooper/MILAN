# CLAUDE.md — Milan

You are building **Milan** for Smart India Hackathon 2026, PS **SIH26043** (Government of
Jharkhand, Theme: Disaster Management, Category: Software). Read this file at the start of every
session, then read `PROGRESS.md` to find out where the previous session stopped.

---

## 1. What Milan is (say it this way, always)

Milan converts a citizen's verified local problem into a **time-bound, routed research assignment**
for a university team, with a **hash-chained credit ledger** so nobody's contribution can be erased,
and an **SLA clock** so no challenge can silently die.

It is a **disaster risk reduction** pipeline that runs in peacetime — mitigation and preparedness,
not response. Every challenge carries an explicit **NDMA hazard linkage** and that linkage is a
weighted term in the priority score.

It is **not** a grievance portal. CPGRAMS and JharSewa route complaints with a known fix to an
accountable officer. Milan routes **unsolved problems to a lab**. Grievances are detected in S1 and
forwarded, with the citizen told where they went.

---

## 2. Non-negotiable invariants

These are correctness requirements, not preferences. If a change would break one, stop and say so.

1. **No challenge may silently die.** Every challenge in a non-terminal state must have at least one
   open row in `sla_deadlines`. This is enforced by a CI query. Terminal states are exactly:
   `CLOSED`, `MERGED`, `FORWARDED_EXTERNAL`, `WITHDRAWN`, `REJECTED_UNSAFE`, `PARKED`
   (and `PARKED` carries an automatic annual re-review, so it re-enters routing).
2. **The ledger is append-only.** No `UPDATE`, no `DELETE` on `ledger_entries`. Enforced by a
   Postgres rule/trigger, not by convention. Every entry carries `prev_hash`, `content_hash`
   (SHA-256), `author_id`, `created_at`.
3. **The AI proposes, deterministic code decides.** Models return structured facts plus a
   confidence. Branching, scoring, merging and routing are done by plain TypeScript. S4 contains
   **zero** model calls.
4. **The AI never invents a routing reason.** The top three contributing terms (weight × value) are
   passed to the model as structured facts; the model only writes the sentence around them.
5. **Human gate on high severity.** `severity ≥ 0.7` routes to `/gov/gate` and waits for a human.
   Every override is logged with a mandatory reason and becomes labelled training data.
6. **The citizen's original text is never destroyed or hidden.** It renders beside the English
   working copy at the same size and weight. Never behind a "show original" toggle.
7. **The impact counter increments at `CITIZEN_VERIFIED` and nowhere else.** Not on publish, not on
   funding, not on an implementer's claim. Unconfirmed claims render visibly grey everywhere,
   including CSR exports.
8. **Nothing on the demo path may depend on a live third-party API succeeding.** Every AI stage has
   a deterministic rule-based fallback. Every external provider sits behind an interface with a
   local implementation.
9. **Duplicates are signal, not noise.** Clustering merges and increments corroborations; nothing is
   discarded. Both reporters are credited on `MERGED`.
10. **Every number on screen is clickable through to its derivation.** The whole pitch rests on
    explainability. A score with no visible breakdown is a bug.

---

## 3. Locked technology stack — do not substitute

| Layer | Choice |
|---|---|
| Framework | **Next.js 15**, App Router, React 19, RSC. One deployable. |
| Styling | **Tailwind v4** + **shadcn/ui** (Radix) |
| Map | **MapLibre GL** + **Protomaps PMTiles** (no API token) |
| Charts | **Recharts** |
| Auth | **Better Auth** with the organisation plugin, role-based |
| ORM / validation | **Drizzle ORM** + **Zod** (one schema, shared contracts) |
| Database | **Supabase PostgreSQL 17** — rows, vectors (`pgvector` HNSW), FTS + `pg_trgm`, deadlines |
| Storage | **Supabase Storage**, every object keyed by its SHA-256 content hash |
| LLM | **Gemini 2.5 Flash** (structured JSON) → **Groq** fallback → **deterministic rules** |
| Embeddings | 768-d, cached on input hash, stored in `pgvector` |
| Realtime | **SSE** (native `ReadableStream`) — no websocket library |
| Hosting | **Vercel Hobby** + **Vercel Cron** (SLA reaper every 5 min) |
| CI | **GitHub Actions** — build, seed, invariant test |
| Package manager | **pnpm** |

**Explicitly excluded, and we say why on the slide:**
- *Blockchain* — a SHA-256 hash chain plus a public timestamp gives the same non-repudiation at zero cost and zero latency.
- *A separate vector DB* — pgvector with HNSW serves millions of rows.
- *Kafka* — a transactional outbox table in Postgres covers every event at state scale.
- *Fine-tuned models* — no labelled data, no GPU budget; few-shot plus an embedding kNN prior, declared honestly.
- *A separate API service and inference service* — collapsed into the Next.js app for the 6-day cut. Every module is its own folder, so it splits out later without a rewrite.

Do not add a state management library. Do not add tRPC. Do not add Prisma. Do not add a queue.
Do not introduce a second runtime. If you believe the stack is wrong, say so in one paragraph and
then follow it anyway.

---

## 4. Repository layout

```
milan/
├─ app/
│  ├─ (public)/            # /, /challenges, /c/[trackingId], /track, /ledger, /bounties, /stats
│  ├─ (citizen)/           # /submit, /submit/success/[id], /me, /me/verify/[id], /me/drafts
│  ├─ (hei)/               # /hei, /hei/inbox, /hei/challenges/[id]/claim, /hei/capability,
│  │                       #   /hei/projects/[id], /hei/challenge-bank
│  ├─ (industry)/          # /industry/discover, /industry/challenges/[id],
│  │                       #   /industry/interests/[id], /industry/csr
│  ├─ (gov)/               # /gov, /gov/gate, /gov/verification, /gov/sla, /gov/emergency
│  ├─ (admin)/             # /admin/routing, /admin/triage, /admin/ai-runs, /demo
│  └─ api/                 # route handlers: /api/pipeline/stream, /api/cron/reaper, ...
├─ lib/
│  ├─ ai/                  # S1..S5, providers, prompts, cache — pure functions
│  ├─ db/                  # drizzle schema, migrations, queries
│  ├─ auth/                # better-auth config, role guards
│  ├─ ledger/              # hashing, chain append, verification
│  ├─ sla/                 # deadline creation, reaper, ladders
│  ├─ clock/               # clock_now() with demo offset — NOTHING calls Date.now() directly
│  └─ notify/              # email + mock SMS + mock WhatsApp
├─ packages/scoring/       # pure, versioned, unit-tested priority function. No I/O. No imports from app/.
├─ components/
├─ seed/                   # seed script reading /seed-data/*.csv
├─ seed-data/              # human-authored CSVs (do not generate these yourself)
├─ tests/                  # vitest: scoring, state machine, invariant
└─ docs/
```

---

## 5. Conventions

- **TypeScript strict.** No `any` in `lib/` or `packages/`. `unknown` + Zod parse at every boundary.
- **All writes go through route handlers or server actions.** No client-side DB access, ever.
- **One transaction per state change.** A state transition, its ledger append, its SLA deadline
  rows and its outbox event are written in the same transaction or none of them are.
- **State transitions only via `lib/db/stateMachine.ts`.** A hand-written `UPDATE challenges SET
  status = ...` anywhere else is a bug. The machine validates `from → to` against an explicit table
  and throws on an illegal edge.
- **Time**: import `clockNow()` from `lib/clock`. Direct `new Date()` / `Date.now()` in application
  code is forbidden — the demo fast-forward depends on this.
- **Roles**: `CITIZEN | HEI_MEMBER | INDUSTRY | GOVERNMENT | ADMIN`. Also present in the enum but
  with no separate UI: `ASSISTED_SUBMITTER`, `INDEPENDENT_INNOVATOR`, `EXPERT_PANEL`.
  Role is checked in middleware **and rechecked server-side** in every handler.
- **Errors**: never swallow. Log to `ai_runs` / `audit_log` where relevant. A failed AI call must
  fall through the provider chain and record `fallback_level`.
- **Bilingual UI**: `body_original` + `body_lang` always rendered next to `body_en`.
- **Accessibility**: this is a citizen product. Labels on every input, 44px touch targets,
  works at 320px width.
- **Comments**: explain *why*, not *what*. Every non-obvious threshold gets a comment citing the
  design doc.

---

## 6. Working rules for you, Claude

1. **Execute the current phase's BUILD file task by task, in order.** Do not jump ahead. Do not
   start the next phase.
2. **Run the verification block at the end of every task** and report the result before continuing.
3. **Never rewrite working code from a previous phase** unless the build file explicitly says to.
   Additive change only after Phase 2 begins.
4. **If a task is ambiguous, choose the option that is more demoable and less clever**, then note
   the choice in `PROGRESS.md` under "Decisions".
5. **If something cannot be built in the time available, ship the deterministic fallback** and mark
   it in `PROGRESS.md` under "Stubbed". A working stub beats a broken feature. We declare our stubs
   on a slide; judges forgive honest stubs and punish fake depth.
6. **Do not invent seed data.** Real Jharkhand districts, real HEIs, real firms. If
   `seed-data/*.csv` is missing a file, stop and tell the human.
7. **Do not delete or modify `seed-data/`, `.env.local`, or `PROGRESS.md` history.**
8. **Commit after every completed task**, message format:
   `phase<N>/task<M>: <imperative summary>`
9. **Never mark a task complete without the verification passing.**
10. At the end of a phase, update `PROGRESS.md` using the template below, then stop.

---

## 7. PROGRESS.md update template

Append a new section; never overwrite earlier ones.

```markdown
## Phase <N> — completed <YYYY-MM-DD HH:MM>

### Status
<one paragraph: what now works end to end, in demo terms>

### Tasks completed
- [x] Task N.1 — <name> — <verification result>
- ...

### Files created or changed
<grouped by directory, one line each with a purpose>

### Database
- Tables added: ...
- Migrations applied: ...
- Seed counts: districts=, blocks=, heis=, capabilities=, challenges=, industry=

### Environment variables consumed this phase
<name — what breaks without it>

### Decisions taken
- <decision> — <why> — <what it costs us later>

### Stubbed / deferred (must appear on the "declared stubs" slide)
- <item> — <why> — <what we show instead>

### Known issues
- <issue> — <severity> — <workaround>

### Verification evidence
<commands run and their output summary>

### Start here next phase
<the exact first thing the next session should do>
```

---

## 8. Definition of done for any task

- It compiles: `pnpm build` passes with no type errors.
- It runs: the described route/flow works in a browser at 320px and 1440px.
- It is seeded: it works against real seed data, not fixtures.
- It is offline-safe: unplug the wifi and it degrades to a fallback rather than crashing.
- It is explainable: any number it shows can be clicked through to its derivation.
- It is committed.

---

## 9. The five sentences (the product must make each one true)

1. "Disaster management is mostly mitigation. We are a mitigation pipeline that runs in peacetime, and every challenge carries an explicit hazard linkage."
2. "CPGRAMS routes complaints to officers. We route unsolved problems to labs, with a clock. When something is a grievance, we forward it to CPGRAMS."
3. "Discovery is never luck. Every problem is pushed to matched departments, and every state has an SLA with an automatic escalation."
4. "Universities are not doing us a favour — 200,000 Indian students invent a fake final-year project every year. We give them real ones."
5. "We do not stop people from sharing work. We make it impossible to erase who did it."
