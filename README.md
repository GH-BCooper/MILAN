# Milan

**Milan converts a citizen's verified local problem into a time-bound, routed research assignment
for a university team, with a hash-chained credit ledger so nobody's contribution can be erased, and
an SLA clock so no challenge can silently die.**

Built for Smart India Hackathon 2026, problem statement **SIH26043** (Government of Jharkhand,
Disaster Management, Software).

It is a **disaster risk reduction** pipeline that runs in peacetime — mitigation and preparedness,
not response. Every challenge carries an explicit NDMA hazard linkage, and that linkage is a
weighted term in the priority score.

It is **not** a grievance portal. CPGRAMS and JharSewa route complaints with a known fix to an
accountable officer. Milan routes **unsolved problems to a lab**. Grievances are detected in S1 and
forwarded, with the citizen told where they went.

---

## The five sentences

1. Disaster management is mostly mitigation. We are a mitigation pipeline that runs in peacetime, and
   every challenge carries an explicit hazard linkage.
2. CPGRAMS routes complaints to officers. We route unsolved problems to labs, with a clock. When
   something is a grievance, we forward it to CPGRAMS.
3. Discovery is never luck. Every problem is pushed to matched departments, and every state has an
   SLA with an automatic escalation.
4. Universities are not doing us a favour — 200,000 Indian students invent a fake final-year project
   every year. We give them real ones.
5. We do not stop people from sharing work. We make it impossible to erase who did it.

---

## Architecture

```
                    citizen (web / SMS-seam / IVR-seam)
                                  │
                          POST /api/intake
                                  │
   ┌──────────────────────────────▼──────────────────────────────┐
   │  lib/ai/pipeline.ts     P0 → S1 ∥ S2 → embed → S3 → S4 → S5 │
   │                                                             │
   │  P0 translate/transcribe   S1 triage      S2 classify+frame │
   │  S3 cluster (pgvector)     S4 SCORE       S5 route          │
   │                                                             │
   │  S4 contains ZERO model calls. The AI proposes; deterministic│
   │  TypeScript in packages/scoring decides.                    │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  severity ≥ 0.70
                    ┌─────────────▼─────────────┐
                    │  /gov/gate — a human      │  ← nothing is sent until
                    │  confirms or overrides    │    an officer says so
                    └─────────────┬─────────────┘
                                  │
   ┌──────────────────────────────▼──────────────────────────────┐
   │  lib/db/stateMachine.ts — the ONLY writer of challenge status│
   │                                                             │
   │  one transaction ⇒ status + ledger append + SLA deadlines   │
   │                    + outbox event, or none of them          │
   └───────┬─────────────────────┬───────────────────┬───────────┘
           │                     │                   │
   ┌───────▼───────┐   ┌─────────▼────────┐  ┌───────▼─────────┐
   │ sla_deadlines │   │ ledger_entries   │  │ outbox          │
   │ durable rows  │   │ APPEND-ONLY at   │  │ (why no Kafka)  │
   │ reaped every  │   │ the DB level;    │  │                 │
   │ 5 min against │   │ SHA-256 chain    │  │                 │
   │ clock_now()   │   │ prev→entry hash  │  │                 │
   └───────┬───────┘   └─────────┬────────┘  └─────────────────┘
           │                     │
   WIDEN +7d                 /ledger — anyone verifies the chain
   OPEN_ALL +14d                 in their own browser
   BREACH +21d  → /bounties
   GRAND_CHALLENGE +45d
           │
   ┌───────▼──────────────────────────────────────────────────────┐
   │  HEI claims → project → artifact (CC-BY | RESTRICTED)        │
   │  → industry funds → IMPLEMENTED (a CLAIM, not an outcome)    │
   │  → citizen confirms at /me/verify → CITIZEN_VERIFIED         │
   │                                                              │
   │  The impact counter increments HERE and nowhere else.        │
   └──────────────────────────────────────────────────────────────┘
```

One Next.js deployable. Every module is its own folder, so it splits out later without a rewrite.

**Stack:** Next.js 15 (App Router, RSC) · React 19 · Tailwind v4 + shadcn/ui · MapLibre + Protomaps ·
Recharts · Better Auth · Drizzle + Zod · Supabase PostgreSQL 17 (pgvector HNSW, FTS, pg_trgm) ·
Supabase Storage keyed by content hash · Gemini Flash → Groq → deterministic rules · SSE · Vercel +
Vercel Cron · GitHub Actions · pnpm.

**Deliberately excluded, and we say why on the slide:** blockchain (a SHA-256 chain plus a public
timestamp gives the same non-repudiation at zero cost and zero latency), a separate vector database
(pgvector with HNSW serves millions of rows), Kafka (a transactional outbox table covers every event
at state scale), fine-tuned models (no labelled data, no GPU budget — few-shot plus an embedding kNN
prior, declared honestly), and a separate API and inference service.

---

## Run it locally

```bash
pnpm install
cp .env.example .env.local          # then fill in DATABASE_URL, DIRECT_URL, BETTER_AUTH_SECRET
pnpm db:migrate
pnpm seed --reset                   # 24 districts, 263 blocks, 20 orgs, 25 challenges
pnpm dev                            # http://localhost:3000
```

Sign in with any seeded account and the password in `SEED_DEMO_PASSWORD` (default `milan2026`):

| Account | Role | Scope |
|---|---|---|
| `sunita@demo.milan.in` | CITIZEN | reports the cracked embankment, confirms the fix |
| `hod.civil@bitsindri.demo.milan.in` | HEI_MEMBER | BIT Sindri, claims routed challenges |
| `dc.gumla@jh.gov.demo.milan.in` | GOVERNMENT | Gumla — and only Gumla |
| `csr@tatasteelfoundation.demo.milan.in` | INDUSTRY | Tata Steel Foundation |
| `admin@milan.demo.milan.in` | ADMIN | `/demo`, `/admin/*` |

Then open **`/demo`** — the judge console runs the whole six-minute script with no terminal.

## Run it offline, with the wifi off

Every external dependency has a local implementation. This is CLAUDE.md invariant 8 made
operational, and it is two commands:

```bash
docker compose up -d                       # Postgres 17 + pgvector, MinIO, Ollama, Mailpit
cp .env.local .env.online && cp .env.offline .env.local
pnpm db:migrate && pnpm seed --reset
pnpm build && pnpm demo:offline            # http://localhost:3000
```

`.env.offline` sets `AI_PROVIDER_CHAIN=rules`, so every AI stage returns at **fallback level 2** from
`lib/ai/providers/rules.ts` and the trace panel says so in amber rather than erroring. This has been
run end to end: 4/4 containers healthy, all migrations applied, seeded in 2.9 s, `verify:demo` 13/13,
and **53 of 53 model calls at level 2** with no call to Gemini, Groq, Supabase or Resend.

One thing to expect offline: the rule tier answers at 0.45 confidence, and a level-2 answer never
overwrites a classification — it is recorded as a proposal for a human. So an offline run leaves the
hero challenge at SUBMITTED in the `/admin/triage` queue rather than at the gate. Accept it there and
the rest of the script proceeds. That is the invariant working, not a failure. Mail lands in
Mailpit at `http://localhost:8025`; SMS and WhatsApp are already mock inboxes on `/demo`.

Restore the online profile with `cp .env.online .env.local`.

## Restore the demo state

Two levels, because two things go wrong.

```bash
# 1. The state drifted during a rehearsal (statuses, clock, SLA flags).
#    Also available as one button on /demo. Takes about a second.
pnpm sla:backfill

# 2. Start completely clean — truncates and re-seeds, and rebuilds the ledger chain.
pnpm seed --reset && pnpm sla:backfill && pnpm ledger:repair

# 3. From the committed SQL backup of the final demo state.
#    scripts/backup.mjs dumps DATA in foreign-key order as one transaction, so a
#    half-restored database is not a state you can end up in. Take a fresh one
#    with `pnpm backup`.
pnpm db:migrate
psql "$DIRECT_URL" -f backups/phase3-demo.sql
```

## Verify it

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm vitest run             # 77 tests, including the invariant-1 CI check
pnpm verify:phase3          # every Phase 3 verification, in order
```

Individually: `verify:clock`, `verify:sla`, `verify:gov`, `verify:provenance`, `verify:impact`,
`verify:industry`, `verify:demo`, `verify:perf`, `verify:seedguard`.

---

## The invariants, and where they are enforced

| # | Invariant | Enforced by |
|---|---|---|
| 1 | No challenge may silently die | `lib/sla/deadlines.ts` covers all 22 non-terminal states; `tests/invariant.test.ts` is a required CI check returning 0 |
| 2 | The ledger is append-only | A Postgres trigger that RAISEs (migration 0002), plus `tests/ledger.test.ts` forbidding any insert outside `lib/ledger/append.ts` |
| 3 | The AI proposes, code decides | `packages/scoring` is pure and import-asserted; S4 has zero model calls |
| 4 | The AI never invents a routing reason | `guardReason()` rejects any sentence containing a number not in the supplied facts |
| 5 | Human gate at severity ≥ 0.7 | `persistRoutes()` writes `notified_at = null`; only `/gov/gate` releases it |
| 6 | The citizen's words are never hidden | Rendered beside `body_en` at equal size on every surface; recorded as a column comment in migration 0006 |
| 7 | The impact counter moves only at `CITIZEN_VERIFIED` | One definition, in `lib/impact/counter.ts`, read by every dashboard, `/stats` and the CSR export |
| 8 | Nothing depends on a live third-party API | Every AI stage falls to deterministic rules; storage, mail and timestamping sit behind interfaces with local implementations |
| 9 | Duplicates are signal | S3 merges and increments corroborations; both reporters are credited on `MERGED` |
| 10 | Every number is clickable to its derivation | `<PriorityBreakdown/>` on the public challenge page, with the arithmetic showing |

---

## Declared stubs

We declare our stubs on a slide. Judges forgive honest stubs and punish fake depth.

- **IVR and WhatsApp Business API intake** — `/api/intake` is the seam; not built.
- **SMS and WhatsApp delivery** — mock inboxes. A real gateway needs a DLT-registered sender ID and
  template approval. The exact message is written to `outbox` verbatim and shown on `/demo`.
- **Offline PWA sync** — not built. `localStorage` drafts are the substitute.
- **Fine-tuned models** — no labelled data, no GPU budget. Few-shot plus an embedding kNN prior;
  every human correction lands in `training_corrections` and improves the next prior.
- **Language coverage is Hindi, English and one Santali sample**, not ten languages.
- **Live CPGRAMS / JharSewa API** — neither exposes a public write API. Milan generates the reference
  locally and renders the exact JSON payload it would POST.
- **Real institutional onboarding** — no self-serve organisation creation.
- **E-signature, payment rails and MoU negotiation threads** — the MoU is generated from a template
  and hashed into the ledger; nobody signs anything.
- **Patent/DOI integration and an IP dispute adjudication UI** — the prior-art panel is what exists.
- **Face and number-plate blurring** — not implemented; the wizard says so and
  `challenge_media.faces_blurred` records `false`.
- **Full Emergency Mode** — `/gov/emergency` is the toggle only: a banner, a map filter and a display
  re-sort. It changes nothing stored, and the page says so.
- **Live multilingual ASR** — the stage and the live path are real; the demo uses a seeded
  ground-truth transcript keyed by content hash, and `seed-data/voice-note.mp3` is still empty.
- **No PMTiles basemap** — `NEXT_PUBLIC_PMTILES_URL` is unset, so the map draws markers on a blank
  canvas and says so.
- **Nearest-centroid geocoding, not point-in-polygon** — wrong near district boundaries; the
  citizen's dropdown always wins.

See `docs/LOOPHOLES.md` for the sixteen failure modes and where each response lives in the product,
and `docs/DEMO_RUNBOOK.md` for the six-minute script beat by beat.
