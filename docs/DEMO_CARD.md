# Demo card — print this

Milan · SIH26043 · https://milan-ruddy-chi.vercel.app

## Sign-in

Password for **every** account below: `milan2026`
(set by `SEED_DEMO_PASSWORD`; the seed prints whatever you set)

| Role | Email | What they demo |
|---|---|---|
| CITIZEN | `sunita@demo.milan.in` | Reports the cracked Koel embankment (Gumla) |
| HEI_MEMBER | `hod.civil@bitsindri.demo.milan.in` | BIT Sindri, Civil — claims routed challenges |
| GOVERNMENT | `dc.gumla@jh.gov.demo.milan.in` | Scoped to district GUM; refused everywhere else |
| INDUSTRY | `csr@tatasteelfoundation.demo.milan.in` | Expresses CSR interest |
| ADMIN | `admin@milan.demo.milan.in` | Routing weights, triage, AI runs |

## Numbers on stage

24 districts · 263 blocks · 20 organisations · 47 lab capabilities
25 challenges · 208 corroborations · 25 ledger entries
15 of 25 challenges sit at or above the 0.7 human-gate threshold
Impact counter reads **2** — it increments at `CITIZEN_VERIFIED` and nowhere else

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| A page hangs and takes every other page down | `DATABASE_POOL_MAX=1` — postgres-js deadlock | Set it to 8 and redeploy |
| Sign-in appears to do nothing / every route 500s | `BETTER_AUTH_URL` wrong or missing its `https://` | Fix it and **redeploy** — env changes alone do not rebuild |
| Demo database is dirty | verification scripts wrote test rows | `pnpm seed --reset` |
| Map is a grey canvas | `NEXT_PUBLIC_PMTILES_URL` unset | Expected — say so; it is BACKLOG §2.5 |

## Declared stubs — say these before a judge finds them

- No voice note attached: `seed-data/voice-note.mp3` is empty, so `challenge_media` is 0.
- Hindi (7 reports) and Santali (1) unchecked by a native speaker.
- `seed_status` and `corroborations` are demo staging assigned by Claude, not field data.
- Faces are not blurred; `faces_blurred` is honestly recorded `false`.
- No SLA engine yet — `sla_deadlines` is empty and the invariant test is deliberately skipped
  until Phase 3 Task 3.2.
- No basemap tiles loaded.
