# MILAN — Setup Guide (do this BEFORE Claude Code sees anything)

**PS SIH26043 · Government of Jharkhand · Theme: Disaster Management · Category: Software**
Project codename: **Milan**

This document is for *you* (the human team), not for Claude Code. Nothing in the phase
build files will work until every box here is ticked. Budget **2–3 hours** for this, ideally
the evening before Day 1.

---

## 0. The 60-second mental model

You are building **one spine, end to end**:

```
citizen submits → AI triages/classifies/dedups/scores → pushed to matched HEIs with an SLA clock
→ a university claims it → work is hashed into a credit ledger → the citizen confirms it on the ground
```

Everything else is a declared stub. The three phases map to that spine:

| Phase | Owns | Ends when |
|---|---|---|
| **Phase 1** | Foundation: repo, DB schema, auth/roles, seed data, intake, public tracking | A citizen can submit and get a tracking ID on a deployed URL |
| **Phase 2** | Intelligence: S1–S5 pipeline, SSE live trace, priority explainer, routing, HEI claim | A judge can type a problem and watch it get routed with reasons |
| **Phase 3** | Accountability: SLA engine, escalation ladders, ledger, credit chain, citizen loop, demo console | The 6-minute demo script runs start to finish without you touching a terminal |

---

## 1. Local machine prerequisites

Install these and verify each version prints.

| Tool | Minimum | Check | Notes |
|---|---|---|---|
| Node.js | 20.11 LTS (22.x fine) | `node -v` | Use `nvm`/`fnm`, not a system package |
| pnpm | 9.x | `pnpm -v` | `corepack enable && corepack prepare pnpm@latest --activate` |
| Git | any recent | `git --version` | |
| Docker Desktop | any recent | `docker -v` | **Optional but strongly recommended** — it is the offline demo fallback |
| psql client | 16 | `psql --version` | For poking the DB when Drizzle Studio is not enough |
| Claude Code | latest | `claude --version` | Installed and logged in |

> Windows users: do all of this inside **WSL2 (Ubuntu)**, not PowerShell. Native Windows +
> Next.js 15 + Drizzle + sharp will cost you an hour you do not have.

---

## 2. Accounts to create (all free tier)

Create these in this order. Keep every key in a scratch file; you will paste them into `.env.local` in step 4.

1. **GitHub** — create an empty **private** repo named `milan`. Do not initialise it with a README;
   Claude Code will scaffold into an empty folder and push.
2. **Supabase** (https://supabase.com) — new project, region **Mumbai / ap-south-1**, Postgres 16.
   Save: Project URL, `anon` key, `service_role` key, and the **connection string** (use the
   *Session pooler* / port 5432 string for migrations, and the *Transaction pooler* / 6543 string for the app).
   - In **Database → Extensions**, enable: `vector`, `pg_trgm`, `pgcrypto`, `unaccent`.
   - In **Storage**, create two buckets: `media` (public read) and `artifacts` (private).
3. **Vercel** (https://vercel.com) — hobby account, connected to your GitHub. Do **not** import
   the project yet; you will import it at the end of Phase 1 Task 1.
4. **Google AI Studio** (https://aistudio.google.com) — create an API key for **Gemini 2.5 Flash**.
   This is the primary LLM provider.
5. **Groq** (https://console.groq.com) — create an API key. This is the fallback provider.
   Two independent providers is a non-negotiable stage-safety requirement.
6. **Resend** (https://resend.com) — API key for notification email. SMS is **mocked** in-app
   (a simulated inbox at `/demo`); do not buy an SMS gateway.
7. *(Optional)* **Ollama** locally (`ollama pull llama3.1:8b`) — the wifi-unplugged fallback.

---

## 3. Human research pack — YOU must gather this, not the AI

The single biggest credibility multiplier in this project is that every name on screen is real.
Claude Code cannot invent these reliably. Put them in `/seed-data/` as CSVs **before Phase 1**.

Create the folder `seed-data/` in the repo root with these files:

### `seed-data/districts.csv`
All **24 Jharkhand districts** with their blocks.
Columns: `district_code,district_name,district_name_hi,block_code,block_name,lat,lng,vulnerability_index`
- `vulnerability_index` is 0.0–1.0, your own judgement based on JSDMA/flood-prone/drought-prone
  status. Write a one-line note on how you derived it — a judge will ask.
- Source: JSDMA district disaster management plans, Census 2011 block list.

### `seed-data/heis.csv`
**8–12 real Jharkhand higher-education institutions**.
Columns: `hei_code,hei_name,district_code,lat,lng,type,website`
Must include at least: IIT (ISM) Dhanbad, BIT Sindri, BIT Mesra, NIT Jamshedpur, Ranchi University,
Central University of Jharkhand, Birsa Agricultural University, XISS Ranchi, Nilamber–Pitamber University.

### `seed-data/capabilities.csv`
The **Institutional Capability Graph** — the thing S5 routes against. This is the file that makes
routing look intelligent, so spend real time here.
Columns: `hei_code,department,lab_name,specialisation_tags,faculty_name,faculty_designation,declared_capacity,capacity_window`
- `specialisation_tags`: pipe-separated, e.g. `flood-resilience|embankment|hydrology|geotechnical`
- `declared_capacity`: integer, number of capstone teams free
- `capacity_window`: e.g. `2026-08-01..2026-12-31`
- Aim for **~40 rows**. Pull department and lab names off the actual institutional websites.

### `seed-data/challenges.csv`
**20–25 real, pre-seeded challenges** written in citizen voice, spread across districts and domains.
Columns: `district_code,block_code,title,body_original,body_lang,domain,hazard,severity_hint,people_affected,recurrence,lat,lng,reporter_name`
- At least 3 must be **near-duplicates of each other** so S3 clustering has something to merge on stage.
- At least 4 must be in **Hindi** (`body_lang=hi`), and 1 in a **tribal language sample**
  (Santali/Kurukh/Ho — one line is enough, it is a demonstration not a claim of coverage).
- At least 2 must be **actual grievances** ("sanctioned road not built") so S1 can visibly forward
  them to CPGRAMS on stage.
- Include the demo hero record: Sunita Oraon, Gumla, spreading crack in the South Koel embankment.

### `seed-data/industry.csv`
**6–8 real firms with a Jharkhand CSR footprint.**
Columns: `org_name,sector,district_focus,domain_interests,csr_contact_title`
e.g. Tata Steel Foundation, Hindustan Copper, CCL, JSPL, Usha Martin.

### `seed-data/voice-note.mp3` (or `.ogg`)
**One** 15–20 second recording of the hero submission in Hindi, recorded on a phone.
Also write `seed-data/voice-note.transcript.txt` with the ground-truth Hindi transcript and its
English translation. This is the seeded ASR path — it is replayed on stage, never live-transcribed.

> **Rule:** if a name appears on the demo screen, it exists in the real world. No `Foo University`,
> no `District A`, no lorem ipsum. Ever.

---

## 4. Environment file

Create `.env.local` in the repo root (Claude Code will read `.env.example` from it later; you own
the real values). Never commit it.

```bash
# ---- database ----
DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true"   # transaction pooler, app runtime
DIRECT_URL="postgresql://...:5432/postgres"                     # session pooler, migrations only

# ---- supabase ----
NEXT_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."

# ---- auth ----
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
BETTER_AUTH_URL="http://localhost:3000"

# ---- intelligence ----
GEMINI_API_KEY="..."
GROQ_API_KEY="..."
AI_PROVIDER_CHAIN="gemini,groq,rules"     # never remove 'rules'
OLLAMA_BASE_URL="http://localhost:11434"  # optional

# ---- notifications ----
RESEND_API_KEY="..."
NOTIFY_FROM="milan@yourdomain.dev"
SMS_MODE="mock"                            # never anything else

# ---- demo controls ----
DEMO_MODE="true"
CLOCK_OFFSET_DAYS="0"
CRON_SECRET="<openssl rand -hex 16>"
```

Generate the secrets now:
```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 16      # CRON_SECRET
```

---

## 5. Where the documents live

```
milan/
├─ CLAUDE.md              ← guardrails, read by Claude Code on every prompt
├─ PROGRESS.md            ← Claude Code updates this at the end of every phase
├─ docs/
│  ├─ SETUP_GUIDE.md      ← this file
│  ├─ PHASE_1_LEARN.md    ← for you
│  ├─ PHASE_1_BUILD.md    ← for Claude Code
│  ├─ PHASE_2_LEARN.md
│  ├─ PHASE_2_BUILD.md
│  ├─ PHASE_3_LEARN.md
│  └─ PHASE_3_BUILD.md
├─ seed-data/             ← your CSVs from step 3
└─ .env.local             ← gitignored
```

Copy `CLAUDE.md` and `PROGRESS.md` to the repo **root**, the rest into `docs/`.

---

## 6. How to actually run a phase with Claude Code

From the repo root, start a **fresh session per phase** (context hygiene matters more than
convenience here):

```
claude
```

Then the opening prompt for each phase is literally:

> Read CLAUDE.md and PROGRESS.md first. Then execute docs/PHASE_1_BUILD.md end to end.
> Work task by task in the order given. After each task, run the task's verification block and
> tell me the result before moving on. Do not skip verification. Do not start Phase 2.

Replace `1` with `2` and `3` for the later phases. At the end of every phase, say:

> Now update PROGRESS.md per the template in CLAUDE.md, then stop.

**Between phases: `/clear` or restart `claude`.** The build files are written so Phase 2 only needs
`CLAUDE.md` + `PROGRESS.md` + `PHASE_2_BUILD.md` as context.

---

## 7. Team split (5–6 people, 6 days)

Claude Code writes the code; humans own the things Claude cannot see.

| Role | Owns |
|---|---|
| **Driver** (1) | The only person running Claude Code. Owns the repo, merges, deploys. |
| **Seed & content** (1) | `seed-data/*`, the voice note, real HEI/lab research, Hindi copy |
| **Demo director** (1) | The 6-minute script, timing, the counterfactual beat, backup video |
| **Loophole owner** (1) | Memorises the 16-row loophole table; runs Q&A drills nightly |
| **Deck & docs** (1) | Slides, the "declared stubs" slide, architecture diagrams |
| **Floater / QA** (1) | Clicks through every route on a real phone, finds the crashes |

Nobody except the Driver commits. A second person running Claude Code in the same repo is how
you lose a day to merge conflicts on Day 4.

---

## 8. Pre-flight checklist

Tick every line before you open Claude Code.

- [ ] `node -v` ≥ 20.11, `pnpm -v` ≥ 9
- [ ] Empty private GitHub repo `milan` exists
- [ ] Supabase project live, region ap-south-1, extensions `vector` / `pg_trgm` / `pgcrypto` / `unaccent` enabled
- [ ] Storage buckets `media` (public) and `artifacts` (private) created
- [ ] Both connection strings copied (5432 direct, 6543 pooled)
- [ ] Gemini key works (`curl` it once)
- [ ] Groq key works (`curl` it once)
- [ ] Resend key created
- [ ] `.env.local` fully populated, `.env.local` in `.gitignore`
- [ ] `seed-data/districts.csv` — 24 districts, blocks, vulnerability index
- [ ] `seed-data/heis.csv` — ≥ 8 real institutions
- [ ] `seed-data/capabilities.csv` — ~40 real departments/labs/faculty
- [ ] `seed-data/challenges.csv` — 20–25 real challenges incl. 3 near-dupes, 4 Hindi, 1 tribal, 2 grievances, the Sunita hero record
- [ ] `seed-data/industry.csv` — 6–8 real firms
- [ ] `seed-data/voice-note.mp3` + transcript recorded
- [ ] `CLAUDE.md` and `PROGRESS.md` at repo root; six phase files in `docs/`
- [ ] Everyone has read the 5 sentences in §8 of the Build Scope doc

When all boxes are ticked, run Phase 1.
