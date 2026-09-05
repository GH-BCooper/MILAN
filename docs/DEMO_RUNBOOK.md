# Demo runbook — the six-minute script

**Driver:** one person on the laptop. **Speaker:** one person talking.
**Everything below runs from `/demo` and the normal UI. No terminal.**

Before you start:

1. Sign in as `admin@milan.demo.milan.in` (`milan2026`) in one tab.
2. Open **`/demo`** and check the health strip. **Invariant 1 must read GREEN.**
   If it does not, press **Reset** and re-check. That takes about a second.
3. Have these tabs pre-opened, in this order:
   `/demo` · `/submit` · `/c/JH-2026-GUM-0001` · `/gov/gate` · `/bounties` · `/ledger` · `/stats` ·
   `/industry/csr`
4. Sign in as `dc.gumla@jh.gov.demo.milan.in` in a **second browser profile** — the DC tab. ADMIN is
   deliberately not a wildcard for GOVERNMENT, so the same session cannot do both.

Hero challenge: **`JH-2026-GUM-0001`** — the crack spreading along the South Koel embankment near
Basia, reported by Sunita Devi in Hindi.

---

## 0:00 — What this is

**Say:** "Disaster management is mostly mitigation. This is a mitigation pipeline that runs in
peacetime. Every challenge in it carries an explicit NDMA hazard linkage, and that linkage is a
weighted term in the priority score."

**Do:** Landing page. Then `/demo`, and point at the health strip — invariant green, the ledger head
hash, the open deadline count.

**Can go wrong:** the strip shows orphans. **Recovery:** press **Reset** on `/demo`. One second.

---

## 0:30 — A citizen reports a problem

**Say:** "Sunita types in Hindi. We never replace her words — the English is an addition beside them,
at the same size, never behind a toggle."

**Do:** `/submit`. Show the six-step wizard, the 320px layout, the photo step saying plainly that
faces are not blurred. You do not have to complete it; the hero report is already in.

**Can go wrong:** photo upload fails. **Recovery:** it is designed to — the challenge is still
created and the page says the photo could not be stored. Say that out loud; it is invariant 8.

---

## 1:00 — The pipeline

**Do:** `/demo` → **Run the pipeline**. Takes about 8 seconds live.

**Say:** "P0 translates, S1 triages, S2 classifies and frames, S3 clusters against pgvector, S4
scores — with zero model calls — and S5 routes. The AI proposes; deterministic TypeScript decides."

**Then:** `/c/JH-2026-GUM-0001`. Open the **priority breakdown**. Point at the arithmetic. "Every
number on this page is clickable through to its derivation. This is public, with no login."

**Can go wrong:** a provider rate-limits. **Recovery:** nothing to do — the chain falls to Groq, then
to deterministic rules, and the trace goes amber saying "fallback: rules". That is the demo, not a
failure. Say so.

---

## 2:30 — The human gate

**Say:** "Severity 0.70 or above and the AI takes no action at all. The shortlist is written, and
`notified_at` stays null until a District Collector says otherwise."

**Do:** In the **DC tab**, open `/gov/gate`. Show the proposal, the reasoning, the breakdown, the
three institutions marked *not notified — held at this gate*. Then, back on `/demo`, press
**DC confirms the gate** and **HOD claims it**.

**Say:** "200,000 Indian students invent a fake final-year project every year. We give them real
ones — and the citizen is on the team, credited as Domain Informant."

**Can go wrong:** the gate is empty because the pipeline already released it. **Recovery:** say "it's
already through the gate" and go to `/c/…` to show the shortlist with `notified` timestamps.

---

## 3:15 — Publication and prior art

**Do:** `/demo` → **Publish the artifact**. Then open the artifact page from the link.

**Say:** "The file is stored under the SHA-256 of its own bytes and that hash goes into an
append-only ledger. This is a defensive publication: it does not stop anyone filing a patent — no
system can — it makes the work prior art, which is what stops one being granted over it."

**Can go wrong:** object storage unreachable. **Recovery:** the metadata and the hash publish anyway
and the page says the file could not be stored. That IS the invariant working.

---

## 4:15 — The counterfactual: what happens when nobody acts

**This is the most important beat. Do not rush it.**

**Do:** `/demo` → **+21 days**. Watch the log fill.

**Say:** "Nothing here is a cron job someone remembered to write. Every non-terminal state has a
durable deadline row, and a CI query fails the build if a single challenge anywhere is without one.
Seven days: widen to five more institutions. Fourteen: open to every institution in Jharkhand.
Twenty-one: that is an SLA breach, it is recorded as one, and it goes on a public bounty board."

**Then:** `/bounties`. Show days unclaimed, the escalation stage, the score breakdown.
**Then:** the DC tab, `/gov` — the breach at the top, most overdue first.

**Can go wrong:** it takes 30–40 seconds locally. **Recovery:** talk over it — this is the beat with
the most to say. On the deployed instance in Mumbai it is a few seconds.

---

## 5:00 — The ledger

**Do:** `/ledger`. Press **Verify chain**. Green.

**Say:** "Anyone can press that. It walks the chain from genesis and recomputes every hash. The
database physically refuses UPDATE and DELETE on this table — not by convention, by a trigger that
raises. We use a hash chain rather than a blockchain because a hash chain plus a public timestamp
gives the same non-repudiation at zero cost and zero latency, and we would rather say that than sell
you a distributed ledger you do not need."

**Do:** Expand one entry. Show the payload and the file-hash calculator. "Your browser computes it.
Nothing is uploaded."

**Can go wrong:** it comes back red. **Recovery:** say what it says — it names the sequence number.
Then `pnpm ledger:repair` in the terminal afterwards. Do not hide it; a verifier that can go red is
the only kind worth having.

---

## 5:20 — The claim, and the only number that counts

**Do:** `/demo` → **Mark implemented**. Then scroll to the **SMS inbox** on the same page and read
Sunita's message aloud.

**Say:** "IMPLEMENTED is a claim, not an outcome. The counter has not moved. Everywhere in this
product — every dashboard, the public statistics, and the CSR report a company files under section
135 — this renders grey and says *claimed, not confirmed*."

**Do:** `/demo` → **Citizen confirms**.

**Say:** "That is the only event in Milan that moves the impact counter."

**Then:** `/stats` — the confirmation gap chart. "We show you what we have not proved. That is why
you can believe what we have."

---

## 5:50 — Industry, and the close

**Do:** `/industry/csr`. Point at the three blocks: confirmed, partly, claimed-not-confirmed, with
two separate beneficiary totals that are never summed.

**Say:** "A CSR report that counts unconfirmed claims as impact is the normal thing, and it is why
nobody believes CSR reports. This one an auditor can defend."

**Close on:** "We do not stop people from sharing work. We make it impossible to erase who did it."

---

## After the run

`/demo` → **Reset**. About a second. Confirm the health strip is green again before the next run.

## If everything goes wrong

- The deployed instance is down → run locally: `pnpm build && pnpm start`.
- The internet is down → `docker compose up -d`, `cp .env.local .env.online && cp .env.offline .env.local`,
  `pnpm db:migrate && pnpm seed --reset && pnpm sla:backfill`, `pnpm build && pnpm demo:offline`.
  **Rehearsed end to end:** 4/4 containers healthy, seeded in 2.9 s, all 13 demo beats passing, and
  53 of 53 model calls at fallback level 2 with no call to any external service.
  **One difference to expect:** the rule tier answers at 0.45 confidence and a level-2 answer never
  overwrites a classification, so the hero challenge stops at SUBMITTED in the `/admin/triage` queue
  instead of reaching the gate. Accept the proposal there, then carry on from 2:30. Say why out loud —
  "offline it will not act on a 0.45-confidence guess, it asks a human" is a better beat than the one
  it replaces. Restore afterwards with `cp .env.online .env.local`.
- The database is unreachable → restore from `backups/phase3-demo.sql`; see README.
