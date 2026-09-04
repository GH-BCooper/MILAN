# BACKLOG.md — what is left for the human after Phase 1

Written 2026-09-05, at the end of Phase 1, by the Claude Code session that built it.

**If you are Claude Code and this is a fresh session:** read `CLAUDE.md`, then `PROGRESS.md`
(the Phase 1 section is the full record), then this file. This file is the human's task list —
the things Claude Code *cannot* do because they need credentials, a phone, a microphone, a native
Hindi speaker, or a decision. Do not try to do these yourself. Do check whether they are done
before starting Phase 2, because §1 blocks it.

**If you are Brett:** §1 is blocking, §2 is before the demo, §3 is context you will be asked about
on stage. Work top to bottom.

---

## 0. Where things actually stand

Phase 1 is **code-complete and verified locally, but not deployed.**

| | |
|---|---|
| Repo | `~/milan` in WSL Ubuntu, pushed to `GH-BCooper/MILAN`, branch `main`, through commit `9c9a923` |
| Working tree | clean |
| Build | `pnpm build` clean, 22 routes, zero type errors, zero lint warnings |
| Tests | `pnpm vitest run` — 8 passed, 1 skipped (the skipped one is deliberate, see §3) |
| Database | Supabase, migrated through `0004_heavy_sway`, seeded |
| Deployed | **No.** This is the one acceptance item that is open. |
| CI | Workflow pushed, **secrets not added**, run status unconfirmed |

Everything below is either "Claude could not do it" or "a human has to judge it".

---

## 1. BLOCKING — do these before Phase 2 starts

### 1.1 Deploy to Vercel

This is Task 1.1 step 9, the only unfinished item in the Phase 1 acceptance checklist. The reason
the build file put it on day one is that *"it works on my machine"* discovered at hour 130 is the
most common way a hackathon project dies. Every hour this stays undone is an hour of code that has
never run anywhere but this laptop.

1. Go to <https://vercel.com/new> and import `GH-BCooper/MILAN`.
2. Framework preset: **Next.js**. Root directory: leave as `./`. Do not override the build command.
3. Add these environment variables (copy the values out of `~/milan/.env.local`):

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | from `.env.local` | transaction pooler, port **6543** |
   | `DIRECT_URL` | from `.env.local` | session pooler, port **5432** |
   | `DATABASE_POOL_MAX` | `8` | **never 1** — see §3.2 |
   | `NEXT_PUBLIC_SUPABASE_URL` | from `.env.local` | |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from `.env.local` | |
   | `SUPABASE_SERVICE_ROLE_KEY` | from `.env.local` | **never** prefix a secret with `NEXT_PUBLIC_` |
   | `BETTER_AUTH_SECRET` | from `.env.local` | |
   | `BETTER_AUTH_URL` | `https://<your-vercel-domain>` | **not** localhost — sign-in cookies are rejected if this is wrong |
   | `SMS_MODE` | `mock` | |
   | `DEMO_MODE` | `true` | |
   | `CLOCK_OFFSET_DAYS` | `0` | |
   | `SEED_DEMO_PASSWORD` | `milan2026` | or your own; the seed prints whatever you set |
   | `CRON_SECRET` | any long random string | not used until Phase 3, set it now |

   `GEMINI_API_KEY`, `GROQ_API_KEY`, `AI_PROVIDER_CHAIN`, `RESEND_API_KEY`, `NOTIFY_FROM` are not
   read by any Phase 1 code. Add them now anyway so Phase 2 does not need a second deploy.

4. Deploy. Then open the production URL and check `/` renders.
5. **Come back and tell Claude the URL.** It goes in `PROGRESS.md` and it is the first line of the
   Phase 2 handoff.

> `BETTER_AUTH_URL` is the one that will silently break things. If you can reach `/login` but
> signing in appears to do nothing, that variable is still pointing at localhost.

### 1.2 Add the CI repository secrets

The workflow is at `.github/workflows/ci.yml` and is already pushed. It runs typecheck and lint
unconditionally, but **skips build and test when `DATABASE_URL` is absent** — deliberately, so that
a pull request from a fork does not fail on missing secrets. Which means: if you do not add these,
CI goes green while testing almost nothing.

Go to **Settings → Secrets and variables → Actions → New repository secret** on
`GH-BCooper/MILAN` and add:

```
DATABASE_URL
DIRECT_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
BETTER_AUTH_SECRET
```

Then push any commit (or use **Actions → CI → Run workflow**) and confirm the run is green *and*
that the "Build" and "Test" steps actually ran rather than being skipped.

### 1.3 Re-run the four verification scripts against the deployed URL

Everything in Phase 1 was verified against a local production build. Verifying against Vercel
proves the serverless runtime, the pooler and Supabase Storage all behave the same way. From
`~/milan`:

```bash
export VERIFY_BASE_URL=https://<your-vercel-domain>

node scripts/verify-routes.mjs     # expect 19/19 — every public route 200
node scripts/verify-roles.mjs      # expect 16/16 — role gating, takes ~1 min (it paces itself)
node scripts/verify-submit.mjs     # expect 23/23 — submits a Hindi + English report, proves EXIF stripped
node scripts/verify-schema.mjs     # prints tables, enums, indexes, extensions, triggers
```

`verify-submit.mjs` creates two real challenges each time it runs. That is fine — but run
`pnpm seed --reset` afterwards when you want a clean demo database.

**If `verify-routes` times out rather than failing**, that is the connection-pool deadlock in §3.2.
Check `DATABASE_POOL_MAX` on Vercel.

---

## 2. BEFORE THE DEMO — none of this blocks Phase 2, all of it is visible on stage

### 2.1 ⚠️ Replace the seed data. It is mine, not real.

**This is the highest-value item on the whole list and it is the one a judge is most likely to
catch.** I generated `seed-data/*.csv` on 2026-09-04 because the real files were empty and you
authorised placeholders. `seed-data/README.md` has the full table of what is real and what is not.
The short version:

| File | Real | Invented |
|---|---|---|
| `districts.csv` | 24 district names, codes, approximate centroids | **every `vulnerability_index`** |
| `blocks.csv` | 14 block names, correctly assigned to districts | centroids approximate, indices invented |
| `heis.csv` | all 10 institutions exist, real websites | coordinates approximate |
| `capabilities.csv` | department names are plausible | **all 40 faculty names, lab names, tags, capacities** |
| `challenges.csv` | hazards and geography are plausible for Jharkhand | **all 23 reports, all reporter names, all the Hindi** |
| `industry.csv` | all 6 firms exist in Jharkhand | coordinates approximate |

Keep the column headers exactly as they are — `seed/index.mts` reads them by name and
`seed-data/README.md` documents the contract for each file. Then:

```bash
cd ~/milan
pnpm seed --reset      # truncate and reload from the CSVs
```

The seed refuses to invent anything: an empty column is left null and printed as a warning at the
end of the run. Read those warnings.

### 2.2 Record the voice note

`seed-data/voice-note.mp3` and `voice-note.transcript.txt` are both **0 bytes**. The seed prints
this warning on every single run:

```
! seed-data/voice-note.mp3 is missing or empty — the Sunita voice note is NOT attached.
```

From `PHASE_1_LEARN.md` §7.4: quiet room, phone at arm's length, 15–20 seconds, Hindi, the Sunita
embankment story. Save the ground-truth transcript beside it — Phase 2's speech-to-text stage is
scored against it. Then `pnpm seed --reset` and the warning goes away and
`challenge_media` stops being empty.

### 2.3 Get a native Hindi speaker to check everything in Devanagari

`PHASE_1_LEARN.md` §7.3 makes this blocking before the demo, and it is not optional: **I wrote all
the Hindi and I am not a native speaker.** A wrong Devanagari label on stage is a credibility hole
that costs you more than a missing feature.

Two places to check:
- The 12 Hindi reports in `seed-data/challenges.csv` (`body_original` where `body_lang` is `hi`).
- Every Hindi string in the UI. They are short and few:
  ```bash
  cd ~/milan && grep -rn 'lang="hi"' app/ components/ -A2
  grep -rn '[\u0900-\u097F]' app/ components/ | grep -v node_modules
  ```

### 2.4 Read all 23 challenges out loud

`PHASE_1_LEARN.md` §7.2. They must sound like citizens, not like an AI wrote them — because an AI
did. Rewrite anything that sounds generated. This is a 30-minute job that judges notice, and it
matters more once §2.1 replaces them with real ones anyway.

### 2.5 Get a basemap onto the map

Right now `NEXT_PUBLIC_PMTILES_URL` is unset, so `/challenges` and the location step of `/submit`
draw markers on a **blank grey canvas** with a note saying tiles are not loaded. It works, it just
looks unfinished.

1. Download a Jharkhand extract from <https://app.protomaps.com/> (draw a box around the state,
   it produces a single `.pmtiles` file).
2. Upload it to Supabase Storage in a public bucket, or drop it in `public/` if it is small
   (`*.pmtiles` is gitignored, so it will not bloat the repo — but then it will not exist on
   Vercel either, so Storage is the better answer).
3. Set `NEXT_PUBLIC_PMTILES_URL` to its public URL, locally **and** on Vercel.

No API token, no quota, no vendor that can fail on stage — that is the whole reason for PMTiles
over Mapbox, and it is worth saying on the slide.

### 2.6 Test the submit flow on a real phone, over mobile data

I verified the layout at 320px and the file input uses `capture="environment"`, but **I have never
run this on a handset.** The camera flow, the geolocation prompt and the upload speed on 4G are all
things only you can check.

From `PHASE_1_LEARN.md` §7.1: open `/challenges` on your phone over mobile data, not office wifi.
If the map is slow on 4G in Anantapur, it will be slow in the demo hall. Time it and tell Claude —
it goes in `PROGRESS.md`.

Specifically walk through: `/submit` → type Hindi → take a photo with the camera → allow location →
finish → confirm you get a tracking ID in under 3 seconds → open `/c/<that id>` → confirm the photo
is there and your Hindi is shown verbatim.

### 2.7 Write the demo credentials on paper

`PHASE_1_LEARN.md` §7.5. On stage, nobody can remember a password. Password is `milan2026` unless
you changed `SEED_DEMO_PASSWORD`.

| Role | Email |
|---|---|
| CITIZEN | `sunita@demo.milan.in` (Gumla) |
| HEI_MEMBER | `hod.civil@bitsindri.demo.milan.in` (BIT Sindri, Civil) |
| GOVERNMENT | `dc.gumla@jh.gov.demo.milan.in` (scoped to district GUM) |
| INDUSTRY | `csr@tatasteelfoundation.demo.milan.in` |
| ADMIN | `admin@milan.demo.milan.in` |

Password manager **and** a printed card.

### 2.8 Take a backup after the real seed

```bash
cd ~/milan
node scripts/backup.mjs backups/phase1-real-data.sql
```

`backups/` is gitignored, so copy the file somewhere that is not this laptop. Restore path:

```bash
pnpm drizzle-kit migrate
psql "$(node scripts/pg-url.mjs)" -f backups/phase1-real-data.sql
```

**Note this is not `pg_dump`.** Supabase is running PostgreSQL **17.6** and the `pg_dump` in this
WSL image is 16, which refuses to dump a newer server. `scripts/backup.mjs` reads through the app's
own connection instead, so it does not care about client versions. It dumps **data only** — run the
migrations first.

### 2.9 Fix one factual error in the deck

`CLAUDE.md` §3 says **"Supabase PostgreSQL 16"**. The database is actually **PostgreSQL 17.6**. If
the slide says 16 and a judge checks, that is a small unforced error. Either correct the slide or
correct `CLAUDE.md`.

### 2.10 Start the deck, beginning with the stubs slide

`PHASE_1_LEARN.md` §7.7. The "what we stubbed" slide is written straight from
`PROGRESS.md` → *Stubbed / deferred*. That section is already complete and honest; it is a slide
you can build today. Judges forgive declared stubs and punish fake depth.

### 2.11 Assign the loophole table

`PHASE_1_LEARN.md` §7.8 — 16 rows, split across the team, drilled every night. Two of them are
already partly answered in code and you should know which:

- **Row 7 (fake reports / brigading):** shipped a 40-character floor, a 5-submissions-per-hour rate
  limit counted in `audit_log`, and `unique(challenge_id, user_id)` on `corroborations` enforced by
  the database. Not shipped: verified identity tiers and the decaying trust score — the columns
  exist (`verified_tier`, `trust_score`) and nothing writes them.
- **Row 8 (low-effort spam):** the 40-character floor, in the Zod schema, server-side.

### 2.12 Answer the ten self-check questions

`PHASE_1_LEARN.md` §8. Answer all ten without looking anything up. If you cannot, re-read §2, §3
and §4 of that file before Phase 2 — the Phase 2 build assumes you can.

---

## 3. THINGS THAT WILL BITE YOU — read before you touch anything

### 3.1 The repo lives in WSL now, not on `D:`

The canonical working copy is `/home/brettcooper/milan` inside WSL Ubuntu. `D:\My Space\...\MILAN`
is **stale** and only receives changes through GitHub.

Two reasons it moved, both real:
- Building over `/mnt/d` from WSL took **10+ minutes**. On ext4 it is ~35 seconds.
- The apostrophe in `SIH'26` **broke the build**. Next.js inlines the source file path into a
  generated single-quoted JavaScript string without escaping it, so `app/favicon.ico` failed to
  compile with a syntax error. Any path with an apostrophe is a landmine for Next.

Open it in your editor as a **WSL remote folder**, not through `\\wsl.localhost\...` — going in
over the network path reintroduces the same filesystem slowness.

Node 22 and pnpm 11 are already the default in an interactive WSL shell. If you ever land on Node
18 (which happens in non-interactive shells, which skip `.bashrc`), run `source ~/milan-env.sh`.

### 3.2 Never set `DATABASE_POOL_MAX` to 1

This one cost real time to find and it will look like a hang, not an error.

Drizzle's postgres-js driver issues every statement through postgres.js `unsafe()`, which is **not
pipelined**. With a single shared connection, two queries started concurrently — which is what
`Promise.all([db.select(...), db.select(...)])` does, and that is the ordinary shape of a Next.js
server component — **deadlock permanently**. Because the client is shared across requests, the
whole instance then hangs on every later request too. `/stats` and `/submit` both wedged the server
this way.

The default is 8. The comment in `lib/db/index.ts` explains it. The usual serverless advice of
"one connection per instance" is wrong for this stack; a small pool is exactly what the Supabase
**transaction pooler** exists to serve.

Symptom to recognise: a page that never responds and takes every other page down with it, with
nothing in the logs.

### 3.3 The skipped test is supposed to be skipped

`tests/invariant.test.ts` currently reports:

```
[invariant] 22 non-terminal challenge(s) have no open SLA deadline.
            Expected to be non-zero until Phase 3 Task 3.2.
```

The assertion is `it.skip`. This is correct and required by Task 1.8 — there is no SLA engine yet,
so `deadlinesFor()` returns an empty list and `sla_deadlines` has zero rows. The query still runs
on every CI pass and prints the count so the gap stays visible. **Phase 3 Task 3.2 un-skips it and
it must return 0.** Do not make it pass any other way.

### 3.4 The ledger physically refuses to be edited

`ledger_entries` has a database trigger (migration `0002`) that refuses `DELETE` always and refuses
`UPDATE` on every content column. `prev_hash` and `entry_hash` can be written exactly once, from
NULL — that one-way seal is what Phase 3 Task 3.4 needs to link the chain.

Consequences you will actually hit:
- Test data in that table **cannot be cleaned up**. `tests/stateMachine.test.ts` runs inside
  transactions that always roll back for exactly this reason.
- `TRUNCATE` is deliberately left open, because it is `pnpm seed --reset` — the one-command restore
  path for a corrupted demo database.

### 3.5 `DIRECT_URL`'s password contains an unencoded `@`

`postgres.js` copes. `libpq` tools (`psql`, `pg_dump`) do not — they split on the last `@` and then
fail to resolve a hostname with half the password glued to it. `scripts/pg-url.mjs` normalises it,
which is why the restore command in §2.8 is written the way it is. Percent-encoding the password in
`.env.local` (`@` → `%40`) would remove the need entirely.

### 3.6 Known cosmetic issue

`requireDistrict` correctly refuses a government user from the wrong district, but renders an
HTTP 500 rather than a 403, because there is no `error.tsx` under `/gov` yet. The security is
correct; only the presentation is wrong. Phase 3 fixes it when `/gov` is built out.

---

## 4. Quick reference

```bash
cd ~/milan

pnpm dev                      # dev server
pnpm build && pnpm start      # production build, what the verification scripts expect
pnpm typecheck                # tsc --noEmit
pnpm lint
pnpm vitest run               # 8 passed, 1 skipped is correct

pnpm seed                     # idempotent: run it twice, same counts
pnpm seed --reset             # truncate and reload — the demo restore path
pnpm drizzle-kit generate     # after editing lib/db/schema.ts
pnpm drizzle-kit migrate      # apply, uses DIRECT_URL

node scripts/verify-routes.mjs   # 19/19
node scripts/verify-roles.mjs    # 16/16
node scripts/verify-submit.mjs   # 23/23
node scripts/verify-schema.mjs   # schema inventory
node scripts/backup.mjs backups/name.sql
node scripts/pg-url.mjs          # DIRECT_URL, password-encoded, for psql/pg_dump
```

Expected seed counts: districts=24, blocks=14, organisations=16, users=5, capabilities=40,
challenges=23, corroborations=89, credit_edges=23, ledger_entries=23, challenge_media=0
(challenge_media becomes 1 once §2.2 is done).

---

## 5. The one-line summary for a fresh Claude session

> Phase 1 is code-complete and verified locally but **not deployed**, CI has **no secrets**, and all
> seed data plus every Hindi string is **Claude-generated placeholder** pending the real Jharkhand
> dataset. Do not start Phase 2 until §1 is done. Remind Brett about §2.1 and §2.2 at the end of
> every phase.
