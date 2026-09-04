# Phase 2 — BUILD (for Claude Code)

**Read `CLAUDE.md` and `PROGRESS.md` first.** Phase 1 is complete and deployed; treat all Phase 1
code as working and build **additively**. Execute tasks in order, verify each, commit as
`phase2/task<N>: <summary>`. Do not begin Phase 3.

**Phase 2 goal:** a judge types a brand-new problem into `/submit`, and within ~6 seconds watches
five stages tick over on screen — safety, domain and hazard, dedup, an explainable score with the
breakdown open, and a ranked shortlist of three real Jharkhand institutions each with a written
reason — then an HOD opens it from a notification link and claims it.

---

## Task 2.0 — Preconditions

Verify and report: Phase 1 acceptance checklist in `PROGRESS.md` is fully ticked; `pnpm seed` runs;
`GEMINI_API_KEY` and `GROQ_API_KEY` are present. Confirm the `vector` extension is enabled.
Do not print secrets.

---

## Task 2.1 — The provider chain and the AI substrate

Create `lib/ai/providers/`.

1. `types.ts` — one interface every provider implements:
   ```ts
   interface LLMProvider {
     name: string;
     level: number;                    // 0 gemini, 1 groq, 2 rules
     complete<T>(args: {
       system: string; user: string; schema: ZodType<T>; timeoutMs: number;
     }): Promise<{ value: T; model: string; latencyMs: number }>;
   }
   ```
2. `gemini.ts` (level 0) — Gemini 2.5 Flash, `responseMimeType: "application/json"` plus a JSON
   schema derived from the Zod schema. Hard timeout, default **2500 ms**.
3. `groq.ts` (level 1) — same interface, JSON mode.
4. `rules.ts` (level 2) — **deterministic, no network.** Implements a rule version of S1 and S2 from
   `lib/ai/gazetteer.ts` (keyword → domain, keyword → hazard, grievance phrase list, unsafe phrase
   list, plus each block's known hazard profile from the seed). Returns a fixed low confidence
   (0.45) so downstream code knows it is a fallback.
5. `chain.ts` — `runWithChain(stage, args)` walks `AI_PROVIDER_CHAIN`, catching timeouts and parse
   failures, and **always** writes an `ai_runs` row with `provider`, `model`, `fallback_level`,
   `confidence`, `latency_ms`, `input_hash`, `output`. It never throws to the caller: the worst case
   is a level-2 result.
6. `cache.ts` — memoise on `sha256(stage + version + input)` in a small `ai_cache` table
   (add the table in a new migration). Cache hits still emit an `ai_runs` row with
   `provider: 'cache'` so the trace stays honest.
7. `embed.ts` — 768-dimension embeddings via Gemini's embedding model with a Groq/local fallback;
   cached on the input hash; returns a zero-vector-safe result. Add the HNSW indexes now:
   ```sql
   CREATE INDEX ON challenges USING hnsw (embedding vector_cosine_ops);
   CREATE INDEX ON capabilities USING hnsw (embedding vector_cosine_ops);
   ```
8. `prompts/` — one file per stage. Each exports `SYSTEM`, `FEWSHOT` (an array the humans will
   extend — leave a clearly-marked `// HUMAN: add curated Jharkhand examples here` block with 3
   starter examples), and a `render(input)` function.

**Verification** — a script `pnpm ai:smoke` that runs one prompt through each provider level and
prints the results table. Then **disconnect the network and run it again**; report that level 2
still returns. Report both tables.

---

## Task 2.2 — Stages S1 and S2

`lib/ai/stages/s1.ts`, `s2.ts`. Both are **pure async functions** taking a plain input and returning
a typed result; they do not write to the challenges table.

**S1 — safety + grievance triage** (the single most important classifier)
- Returns `{ is_unsafe, unsafe_category, is_grievance, grievance_target, confidence, rationale }`.
- Deterministic decisions made by the caller:
  - `is_unsafe && confidence ≥ 0.6` → `REJECTED_UNSAFE`: **purge the media objects**, do not publish,
    show the citizen the correct helpline (112 / 181) and preserve submitter anonymity.
  - `is_grievance && confidence ≥ 0.7` → `FORWARDED_EXTERNAL`: generate a mock CPGRAMS/JharSewa
    reference number, store it in `forwarded_ref`, notify the citizen where it went, and render the
    handoff **contract** (the JSON payload we would POST) on the challenge page. This is the live
    answer to "why not just use CPGRAMS".
  - `confidence < 0.6` → `/admin/triage` human queue.
  - otherwise → `TRIAGED`.

**S2 — domain + hazard + severity**
- Before calling the model, compute the **embedding kNN prior**: the 5 nearest already-classified
  challenges by cosine, passed into the prompt as prior labels. Comment it as our declared substitute
  for fine-tuning.
- Returns `{ domain, hazard, hazard_strength, severity, solvability, capital_works, confidence, rationale }`.
- `confidence < 0.65` → human queue at `/admin/triage`; the human's correction is written to
  `audit_log` and appended to a `training_corrections` table (add it) as labelled data.
- Writes `domain`, `hazard`, `hazard_strength`, `severity` and transitions to `CLASSIFIED`.

Both stages: idempotent, cached on input hash, independently replayable via
`pnpm pipeline:replay <trackingId> --from S1`.

**Verification** — run S1+S2 over all seeded challenges with `pnpm pipeline:run --all` and print a
table of tracking ID → domain → hazard → severity → confidence → fallback level. Confirm the two
seeded grievances are caught and forwarded. Report the table.

---

## Task 2.3 — Embedding, S3 dedup and roll-up

`lib/ai/stages/s3.ts`.

1. Write the challenge embedding (built from `title + body_en + district`) to `challenges.embedding`.
2. **Block prefilter, then vector kNN**: candidates are challenges in the same block, or the same
   district when the block has fewer than 20 rows. Comment the prefilter as the thing that keeps
   this cheap at scale.
3. Thresholds — put these constants in one exported object with a comment citing the design doc:
   - `≥ 0.86` → **auto-merge**: the new challenge goes to `MERGED`, a `corroborations` row is written
     against the surviving challenge, `corroboration_count` increments, and **both reporters are
     credited** via `credit_edges` (`ORIGINATOR` on the survivor, `CORROBORATOR` on the merged
     reporter). The merged challenge keeps its own page and redirects to the survivor.
   - `0.72 – 0.86` → LLM adjudication with both texts side by side, returning
     `{ same_problem: boolean, confidence, rationale }`.
   - `< 0.72` → distinct.
4. **Roll-up**: when three or more child challenges exist across two or more panchayats/blocks in the
   same block-parent scope, create a `BLOCK_SYSTEMIC` parent challenge (`is_parent = true`), link
   children by `parent_id`, and sum corroborations onto the parent. **Nothing is discarded.**
5. Anti-brigading (loophole row 7): a corroboration is weighted by distance from the original point
   (decay beyond ~15 km), capped at one per identity per challenge (the Phase 1 unique constraint),
   and an anomaly flag is set when more than N corroborations arrive from one device fingerprint or
   inside one hour. Flagged corroborations still count as 0-weight signal and are visible to admins.
6. Transition to `CLUSTERED`.

**Verification** — the three planted near-duplicates in the seed merge into one challenge with
corroboration count 3; two genuinely different water challenges do **not** merge. Print the
similarity matrix for the planted set. Report it.

---

## Task 2.4 — S4, the explainable priority score

Create `packages/scoring` — **a pure package. No database, no network, no clock, no imports from `app/`.**

1. `weights.ts` — exported versioned config:
   ```ts
   export const SCORING_VERSION = "1.0.0";
   export const WEIGHTS = {
     severity: 0.22, hazard: 0.20, peopleAffected: 0.15, blockVulnerability: 0.15,
     corroborations: 0.12, recurrence: 0.10, officialEndorsement: 0.06,
   };   // sums to 1.00 — a unit test asserts this
   ```
2. `normalise.ts` — one function per term, each documented:
   - `peopleAffected`: `log(1+n)/log(1+100000)` — **log-normalised so that village-scale problems are
     not permanently outranked by town-scale ones. Equity is a deliberate design choice.**
   - `corroborations`: `sqrt(n)/sqrt(50)` capped at 1 — **diminishing returns, so brigading has a
     bounded payoff.**
   - `hazard`: `hazard_strength`, or 0 when `hazard = NONE`.
   - `recurrence`: one-off 0.25 / seasonal 0.6 / yearly 0.8 / constant 1.0.
   - `blockVulnerability`: straight from the seeded index.
   - `officialEndorsement`: 0 or 1.
   - `severity`: straight from S2.
3. `score.ts` — `computePriority(input): { total, version, terms: Term[] }` where each `Term` is
   `{ key, label, rawValue, normalised, weight, contribution }`. Total is on a 0–100 scale.
4. `tests/scoring.test.ts` — weights sum to 1; a maximal input scores 100; a minimal input scores > 0;
   log-normalisation keeps a 50-person village above a 5000-person town when severity and hazard are
   much higher; the same input twice gives an identical result (determinism).
5. Wire it: S4 reads the challenge, calls the pure function, writes `priority_score`,
   `priority_breakdown` (the full `terms` array) and `scoring_version`, and transitions to `PRIORITISED`.
6. **UI — `<PriorityBreakdown/>`**, used on `/c/[trackingId]` (public, no login) and every dashboard.
   A Recharts horizontal stacked bar plus a table: term, raw value, normalised, weight, contribution.
   Show `scoring_version`. Every raw value links through to its source (people affected → the
   submission; block vulnerability → the district page; corroborations → the corroboration list).
   Caption: *"Every challenge is scored by the same published function. Nothing is hidden."*

**Verification** — open a seeded challenge's public page and screenshot the breakdown. Run
`pnpm vitest run tests/scoring.test.ts`. Report the top 5 scored challenges with their totals.

---

## Task 2.5 — S5, capability routing with reasons

`lib/ai/stages/s5.ts`.

1. Embed every `capabilities` row once (text = department + lab + tags + faculty specialisation),
   cached on hash. Add this to the seed script so a `--reset` re-embeds.
2. `matchScore` in code, weights in a versioned exported config:
   `semantic 0.45 · tagOverlap 0.20 · distance 0.15 · capacity 0.12 · trackRecord 0.08`
   - `semantic`: cosine(challenge, capability)
   - `tagOverlap`: Jaccard of `specialisation_tags` against the challenge's domain + hazard keyword set
   - `distance`: `exp(-km/250)` using haversine between the challenge point and the institution
   - `capacity`: `declared_capacity > 0 && window covers clockNow()` ? scaled : **0**
   - `trackRecord`: delivered projects in this domain / total, smoothed
3. Rank, take **top 3 distinct organisations** (never two labs of the same institution in the top 3 —
   diversity of shortlist is the point), write `routes` rows with `rank`, `match_score`,
   `reason_terms` (the top three `weight × value` contributors) and a `claim_window_ends_at` of
   **`clockNow() + 7 days`**.
4. **The reason sentence.** Pass ONLY the three structured contributor terms plus the institution,
   department and lab names to the model, with a system prompt that forbids any fact not supplied.
   Zod-validate the sentence length and reject any output containing a number not present in the
   input terms (write this check — it is a real guardrail, not a comment).
   Fallback level 2 renders the terms as a templated sentence.
5. **The human gate.** If `severity ≥ 0.7`, do **not** notify: create the routes in state `OFFERED`
   but `notified_at = null`, transition to `VERIFIED`-pending, and place the item in `/gov/gate`.
   The DC of that district (and only that district) confirms or overrides. Confirmation releases the
   notifications and transitions to `ROUTED`. **Every override requires a written reason**, is
   written to `audit_log` and to `training_corrections`.
   Below the threshold, routing releases automatically to `ROUTED`.
6. Notifications: write `notifications` rows for the HOD/faculty of each matched capability, with
   `action_url` pointing directly at `/hei/challenges/[id]/claim`. Email via Resend; SMS via the mock
   inbox. **Push, never browse** — no notification may link to a list page.

**Verification** — run S5 on the Sunita embankment challenge. The top 3 must be defensible real
institutions with reason sentences that contain no invented facts. Paste the three reason sentences
and their `reason_terms` JSON. Confirm the human gate fired (severity ≥ 0.7).

---

## Task 2.6 — The live trace: SSE and the pipeline UI

1. `lib/ai/pipeline.ts` — `runPipeline(challengeId, emit)` orchestrating P0 → S1 → S2 → embed → S3 →
   S4 → S5, calling `emit(stageEvent)` after each stage. Every stage is wrapped in its own
   try/catch/timeout; a stage failure emits a `degraded` event and continues with the fallback.
   One transaction per state change (`lib/db/stateMachine.ts`).
2. `app/api/pipeline/stream/route.ts` — SSE as described in `PHASE_2_LEARN.md` §6. Headers:
   `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
   `Connection: keep-alive`, `X-Accel-Buffering: no`. `export const dynamic = "force-dynamic"`.
   Auth-check the challenge before streaming.
3. `<PipelineTrace/>` client component — five stage cards, each showing: name, one-line description,
   a spinner → tick, the structured result, the model's short rationale, and a small footer with
   provider · model · confidence · fallback level · latency ms. Stages appear as they complete.
   S4's card expands into `<PriorityBreakdown/>`; S5's card lists the three matches with their
   reason sentences.
   - The trace is rendered on `/submit/success/[trackingId]` (the citizen and the judge see it) and
     replayable from `/c/[trackingId]` via a **Replay pipeline** button.
   - A `degraded` event renders as an amber badge reading `fallback: rules` — never as an error.
4. `/admin/ai-runs` — a table of `ai_runs` with filters by stage, provider, fallback level; latency
   p50/p95 per stage; a link from any trace tick to its row. **This is the receipt if a judge asks
   whether the animation is real.**
5. `/admin/triage` — the low-confidence human queue: the item, the AI's proposal, the confidence,
   and accept/override controls with a mandatory reason.

**Verification** — submit a new challenge on the deployed URL and report the **wall-clock time** from
submit to S5 complete, plus the per-stage latencies from `ai_runs`. Must be under 8 s. Then throttle
the network in devtools and confirm it degrades rather than errors.

---

## Task 2.7 — AI problem framing (the citizen approves the wording)

Complete step 5 of the submit wizard from Phase 1.

1. `lib/ai/stages/p1_framing.ts` — takes `body_original` + `body_en` and returns
   `{ framed_statement, success_criteria, confidence }`. The framed statement is a research-ready
   problem statement; the success criteria answers "what would success look like".
2. The wizard shows the citizen's original text and the proposal **side by side**, both editable.
   Nothing is stored as `framed_statement` until the citizen ticks approval
   (`framing_approved_by_citizen`). If they decline, their own text is used and that is recorded.
3. `body_original` is never overwritten. Add a database-level comment on the column saying so.
4. On `/c/[trackingId]`, render original + framed with a visible label:
   *"Wording proposed by AI, approved by the reporter"* — or, if declined,
   *"Reporter's own wording"*.

**Verification** — submit a deliberately messy Hindi complaint; show the original, the proposal, and
the stored result after approval and after decline. Report both paths.

---

## Task 2.8 — P0: the seeded voice path and translation

1. `lib/ai/stages/p0.ts` — for a submission with an attached audio file: transcribe and translate.
   **Use the seeded ground-truth transcript for `seed-data/voice-note.*`** (keyed by content hash),
   with a live ASR call as the non-demo path. Comment this honestly: the stage demonstrates the ASR
   pipeline with a seeded artifact; live multilingual ASR is a declared stub.
2. For any text submission where `body_lang != 'en'`, translate to `body_en` via the provider chain,
   falling back to storing `body_en = body_original` with a `translation_failed` flag rather than
   blocking the pipeline.
3. UI: on the challenge page, an audio player, the original-language transcript, and the English
   working copy — **the original at equal size and weight, never behind a toggle.**

**Verification** — replay the seeded voice note end to end and screenshot the three-panel result.

---

## Task 2.9 — The HEI side: inbox, claim, proposal

1. **`/hei/inbox`** — routed items for the user's organisation, each with rank, match score, the
   reason sentence, the priority breakdown, and a **live countdown** to `claim_window_ends_at`.
   Sorted by deadline, not by score.
2. **`/hei/challenges/[id]/claim`** — reached directly from the notification link. Shows the full
   challenge, the routing reason, then a claim form: project title, IP track (`OPEN` = CC-BY /
   `RESTRICTED`), team members (add users by email, each with a **declared role**), mentor, and
   confirmation against declared capacity. On submit, in one transaction: create `projects` +
   `project_members`, write `credit_edges` for every team member and the mentor, set the winning
   `routes` row to `CLAIMED` and the others to `EXPIRED`, transition the challenge to `CLAIMED`,
   ledger-append, decrement `declared_capacity`.
   - **Add the citizen as a `Domain Informant`** on the credit chain by default (an editable
     declared role) — this is a demo beat and a product principle.
3. **`/hei`** — department dashboard: claimed projects, capacity remaining, inbox count, deadlines.
4. **`/hei/capability`** — view and edit the department's labs, tags, faculty and declared capacity.
   Editing capacity must visibly change future routing; say so in the UI.
5. **`/hei/projects/[id]`** — milestones, activity feed, `last_activity_at` updated on every write
   (Phase 3's inactivity ladder depends on this column being honest).
6. **`/hei/challenge-bank`** — the browsable set of unclaimed challenges, framed as
   *"real final-year projects"*. This is the adoption driver; put the student-facing pitch on it.
7. `/admin/routing` — an override surface: re-route a challenge to a different institution with a
   mandatory reason, all logged.

**Verification** — log in as the seeded BIT Sindri HOD, open the notification link for the Sunita
challenge, claim it, form a team, and confirm the credit chain on the public page shows
citizen → corroborators → team → mentor. Screenshot it.

---

## Task 2.10 — Close the phase

1. Run the full pipeline over all seeded challenges (`pnpm pipeline:run --all`), then `pnpm build`
   and `pnpm vitest run`.
2. Print a distribution report: challenges by domain, by hazard, by status, mean confidence per
   stage, fallback-level counts, and the p50/p95 latency per stage.
3. Update `PROGRESS.md` per `CLAUDE.md` §7. Under **Stubbed** add at minimum: fine-tuned models
   (few-shot + kNN prior instead), live multilingual ASR (seeded voice note), full 10-language
   coverage (Hindi + English + one tribal sample), live CPGRAMS/JharSewa API (mock handoff with the
   contract shown).
4. Print a handoff naming the exact first action of Phase 3.
5. **Stop. Do not start Phase 3.**

---

## Phase 2 acceptance checklist

- [ ] Provider chain works, and level 2 (rules) returns with the network unplugged
- [ ] Every stage writes a real `ai_runs` row; `/admin/ai-runs` shows them
- [ ] S1 catches the seeded grievances and forwards them with a reference number and a visible contract
- [ ] S2 uses the embedding kNN prior; low confidence lands in `/admin/triage`
- [ ] S3 merges the planted duplicates, credits both reporters, creates a `BLOCK_SYSTEMIC` parent
- [ ] `packages/scoring` is pure, versioned, tested; weights sum to 1.00
- [ ] The priority breakdown is visible on the **public** challenge page, every number clickable
- [ ] S5 produces 3 distinct real institutions with reason sentences containing no invented facts
- [ ] The human gate fires at severity ≥ 0.7 and every override demands a written reason
- [ ] SSE trace animates all five stages, end to end under 8 seconds
- [ ] Citizen approves the framing; `body_original` is never overwritten
- [ ] An HOD can claim from a notification link and form a credited team
- [ ] `PROGRESS.md` updated
