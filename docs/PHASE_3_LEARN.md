# Phase 3 — LEARN

**Phase 3 = accountability.** The SLA engine, the escalation ladders, the bounty board, the DC
dashboard, the hash-chained provenance ledger, the credit chain, licensing and access logs, the
citizen confirmation loop, the industry feed, and the judge console.

This phase contains the two strongest claims in the whole pitch — *"no challenge may silently die"*
and *"we make it impossible to erase who did it"* — and both are among the cheapest things in the
build. Read this properly. Time: **2 hours.**

---

## 1. Durable deadlines, not timers

A `setTimeout` for 45 days is a joke on a serverless platform: the function ends in seconds and the
timer dies with it. Even on a long-lived server, a redeploy or a crash loses every pending timer.

So: **a deadline is a row.**

```
sla_deadlines(id, challenge_id, project_id, kind, due_at, fired_at, cancelled_at, payload)
```

A **reaper** runs every 5 minutes (Vercel Cron) and does one query:

```sql
SELECT * FROM sla_deadlines
WHERE fired_at IS NULL AND cancelled_at IS NULL AND due_at <= clock_now()
ORDER BY due_at LIMIT 100;
```

That is the entire engine. It survives restarts, redeploys, cold starts and a laptop closing. Say
exactly that when a judge asks how a 45-day deadline works on a free tier.

Three properties you must be able to defend:

- **Idempotency.** The reaper may run twice on the same row (retries, overlapping crons). Fire the
  action and set `fired_at` **in the same transaction**, and take a row lock
  (`FOR UPDATE SKIP LOCKED`) so two concurrent reapers never process the same row.
- **Cancellation, not deletion.** When a challenge is claimed, the pending `WIDEN` and `OPEN_ALL`
  deadlines are `cancelled_at`-stamped, never deleted. The history of what *would* have happened is
  part of the audit trail.
- **Creation is coupled to state.** `deadlinesFor(status)` returns the deadline rows a state implies,
  and they are written in the **same transaction** as the state change. That coupling is what makes
  the invariant provable rather than aspirational.

### The invariant
> **Zero challenges may sit in a non-terminal state with no open `sla_deadlines` row.**

A scheduled query returning a row means the workflow has a hole. This runs in CI. It is one table,
one cron and one test, and it is the strongest claim in the pitch. Learn the sentence.

---

## 2. `clock_now()` and the fast-forward

Every timestamp in Milan reads `clockNow()`, which is `real time + demo_state.clock_offset_days`.
The `/demo` console can add 7, 14, 21 or 45 days with a button; the reaper then sees deadlines as
due and fires the ladder for real — the same code path that would run in July, running in ten
seconds on stage.

This is why `CLAUDE.md` forbids `Date.now()` in application code. One stray raw timestamp and the
fast-forward produces an inconsistent world in front of a judge.

**Be honest about it if asked**: the offset is a demo affordance, it is stored in a table, it is
visible in the UI as a banner when non-zero, and production runs at offset 0.

---

## 3. The three ladders — memorise them

**Ladder 1 — on the institutions, until someone claims.**

| Time | Action |
|---|---|
| T+0 | `ROUTED` — top 3 notified, with reasons and a countdown |
| +7 d | **Widen** to the next five matched institutions |
| +14 d | **Open to all** HEIs and independent innovators |
| +21 d | **SLA breach** flag on the District Collector dashboard, and posted to the **Bounty Board** |
| +45 d | Added to the annual **Jharkhand Grand Challenges** set (feeds SIH, state hackathons, PhD topic lists) |
| +365 d | Parked items are auto re-reviewed, rescored and rerouted |

**Ladder 2 — on the team, once a claim exists.**

| Time | Action |
|---|---|
| Proposal due +14 d | Nudge the lead and the HOD; the claim is **released** at +21 d |
| Silent +30 d | Mentor nudge and a public `AT_RISK` flag |
| Silent +45 d | **Fork rights open** — a new team may take it up, and the prior team's partial work is preserved and attributed |

**Ladder 3 — on the ground, once an implementation is claimed.**

| Time | Action |
|---|---|
| Impact not confirmed +30 d | A second SMS to the citizen; the claim is marked **unconfirmed** in every dashboard and every CSR report |

The sentence that ties them together: *"Ladder 1 keeps the clock on the institutions, Ladder 2 moves
it onto the team, Ladder 3 moves it onto the ground — because a claim of completion is not
completion."*

**Terminal states, all five plus one:** `CLOSED` (implemented and confirmed), `MERGED`,
`FORWARDED_EXTERNAL`, `WITHDRAWN`, `REJECTED_UNSAFE`, and `PARKED` with a written reason and an
automatic annual re-review. Parked items return to routing, so **the loop never terminates silently.**

---

## 4. Hash chains — and why not blockchain

### SHA-256 in one paragraph
A cryptographic hash maps any input to a fixed 256-bit output. Change one character of the input and
the output changes completely and unpredictably. You cannot work backwards from the hash to the
input, and you cannot find a second input with the same hash. So a hash is a **fingerprint of
content**: publishing the hash at time T proves the content existed at time T, without publishing
the content.

### The chain
Each ledger entry stores:
```
content_hash = sha256(canonical_json(payload))
prev_hash    = entry_hash of the previous entry (by seq)
entry_hash   = sha256(seq || content_hash || prev_hash || author_id || created_at)
```
Because each entry commits to the previous one, **altering entry 40 changes every hash from 40
onwards**. A verifier walks the chain and recomputes. Tampering is not prevented — it is made
*detectable*, which is what matters for a credit dispute.

`content_hash` for a file (a photo, a report PDF) is the hash of the **file bytes**, and the storage
object is keyed by it. Same file uploaded twice = same key = automatic deduplication, and a
downloaded artifact can be verified against the ledger by anyone.

### Append-only, enforced
Convention is not enough. A Postgres rule/trigger raises an exception on `UPDATE` or `DELETE` against
`ledger_entries`. Say "no UPDATE, no DELETE at the database level" — and be able to open the
migration that proves it.

### The daily anchor
Once a day we hash the latest `entry_hash` and publish it — optionally to **OpenTimestamps**, which
writes a commitment into Bitcoin's timestamping infrastructure for free. That gives an external,
independently-verifiable proof of the chain's state at that time.

### Why not blockchain
> "A hash chain plus a public timestamp gives the same non-repudiation at zero cost and zero latency.
> Blockchain would add a token, a gas fee, a wallet and a dependency, and give us nothing we do not
> already have."

That is a better answer than putting "blockchain" on a slide, and it demonstrates judgement.

---

## 5. Provenance, credit and defensive publication

### The credit chain
An ordered contribution graph:
```
citizen (originator) → corroborators → team members with declared roles → mentor → funder → implementer
```
Stored as `credit_edges`, rendered as a chain on the public challenge page, and a **citation string
is auto-generated from the Milan ID** so a student can put it on a CV and a faculty member can put it
in a NAAC file.

### Staged disclosure
Title, problem and abstract are **always public**. Full artifacts carry a licence chosen at upload:
- **CC-BY** — free reuse, attribution mandatory.
- **RESTRICTED** — metadata public, access on request; **every download is logged against a verified
  identity** in `access_log`.

### The prior-art shield
Timestamped publication on Milan is a **defensive publication**: once an idea is publicly disclosed
with a verifiable timestamp, it becomes prior art and nobody else can obtain a patent on it. This is
the answer to *"won't industry steal the students' work?"* — and note the shape of the answer:

> "Openness is the protection, not the vulnerability. We do not stop people from sharing work. We
> make it impossible to erase who did it."

And if industry uses restricted work without credit: timestamped hash + access log +
attribution-mandatory licence = a documented, adjudicable licence breach. Not a vague grievance, an
evidence package.

---

## 6. Closing the loop — the hardest claim to fake

**The impact counter increments at `CITIZEN_VERIFIED` and nowhere else.** Not when a team publishes,
not when industry funds it, not when an implementer reports completion. Only when the citizen who
reported the problem — or one of the corroborators — confirms on the ground, by SMS or on
`/me/verify/[id]`.

Unconfirmed claims render **visibly grey** in every dashboard and every CSR export.

This is loophole row 14 ("implementation claimed but nothing changed") and it is the single most
credible thing in the product, because every other platform in this space counts outputs. Be ready
to say: *"most portals count submissions; we count confirmed outcomes, and we show you the gap."*

---

## 7. Why each actor turns up (no goodwill assumed)

Learn the selfish reason for each, because "who would actually use this?" is a certain question.

| Actor | Their selfish reason |
|---|---|
| Citizen | A tracking ID, visible status, permanent credit as originator, and the problem actually being fixed. Zero cost. |
| Student | A real final-year project instead of a fabricated one; a verifiable public credit record for placements; AICTE activity points. |
| Faculty / HEI | A supply of research problems with field data and a funding path; **NAAC Criterion III and VII** evidence; **NEP 2020** community engagement. |
| Industry / CSR | Audit-ready **Companies Act §135** reporting, de-risked innovation sourcing, first look at solutions, a visible talent pipeline. |
| Government / DC | A live verified district inventory of unsolved problems — direct input to the **district disaster management plan** — plus SLA visibility over institutions. |

**Cold start order:** seed from government data first (district DM plans, JSDMA reports, clustered
historical grievances) so the platform is never empty; onboard **universities second, citizens
third** — universities need problems more than citizens need another portal.

**Ghost town after the hackathon?** Institutional owner (DoHTE + JSDMA), pre-seeded government data,
mandate-linked usage (NEP / NAAC / §135), and a deliberately cheap stack that costs almost nothing to
keep running.

---

## 8. Compliance vocabulary you should not fumble

- **DM Act 2005** — defines disaster management to include prevention, mitigation and preparedness,
  not only response. This is why Milan is a Disaster Management submission.
- **DPDP Act 2023** — India's data protection law. Our alignment: consent screens, EXIF stripping,
  purpose limitation, retention limits, face/plate blurring (declared as a stub this cut), and access
  logging. Do not claim "compliant"; claim "aligned, with these specific measures".
- **Companies Act §135** — mandatory CSR spend for qualifying companies. Our CSR export is
  audit-ready evidence for it.
- **NAAC Criterion III (Research, Innovation and Extension) and VII (Institutional Values)** — what
  an HEI needs evidence for. Milan produces that evidence as a by-product.
- **NEP 2020** — community engagement and multidisciplinary project-based learning.
- **CPGRAMS / JharSewa** — the grievance systems we forward to, not compete with.
- **NDMA hazards** — flood, drought, landslide, heatwave, mining subsidence, epidemic, forest fire.

---

## 9. Things you must do yourself after Phase 3

This is the last phase, so this list is really the demo-readiness list. **Day 6 is not a build day.**

1. **Freeze features at noon on Day 6.** Anything not in the demo script does not get built. Write
   this on a wall.
2. **Rehearse the 6-minute script five times, end to end, out loud, with a timer.** Not four. Five.
   The beats:
   - 0:00–0:45 the gap, and the hazard-linkage line
   - 0:45–1:30 Sunita submits; voice note → transcript → English copy; tracking ID issued
   - 1:30–3:00 the pipeline animates: S1 clean, not a grievance → S2 Water/Flood high → S3 merged with
     2 similar reports → S4 breakdown open → S5 shortlist with reasons
   - 3:00–3:30 high severity, so the human gate fires; DC Gumla confirms; ledger entry written
   - 3:30–4:15 the HOD opens it from the notification link, claims it, forms a team, adds Sunita as
     Domain Informant
   - 4:15–5:00 the counterfactual: rewind, nobody claims, widen at 7 d, open at 14 d, breach and
     bounty at 21 d — *discovery is never luck*
   - 5:00–5:45 report published CC-BY, industry interest, implemented, Sunita's SMS lands, impact
     counter increments, credit chain shown end to end
   - 5:45–6:00 **the judge types a brand-new problem live and the pipeline runs on it**
3. **Record a backup video** of the full demo, at the venue if possible, and put it on a phone, a
   laptop and a USB stick. If the wifi dies, you present the video and narrate it live. This has
   saved more teams than any feature.
4. **Prepare the offline path**: `docker-compose up` with local Postgres + pgvector, MinIO, Ollama,
   Mailpit, and the simulated phone inbox. Run the whole demo once with the wifi physically off.
5. **Drill the 16-row loophole table.** Every member answers any row. Do it as a rapid-fire round
   twice a day on Days 5 and 6.
6. **Build the "declared stubs" slide** from `PROGRESS.md`. Judges forgive honest stubs and punish
   fake depth. Put it up *before* they find one.
7. **Print a card** with demo credentials, the tracking ID of the hero challenge, and the five
   sentences.
8. **Reset the database to a clean seed immediately before you present** using `/demo → seed reset`,
   and set the clock offset to 0.
9. **Decide who touches the keyboard.** One driver, one narrator. Nobody else.

---

## 10. Self-check before you present

- How does a 45-day deadline survive a redeploy on a free serverless tier?
- State the invariant, exactly, and say where it is tested.
- Name all six terminal states and say what makes `PARKED` different.
- Walk Ladder 1 through its five steps with the day numbers.
- What exactly does `prev_hash` protect against, and what does it *not* prevent?
- Why not blockchain? (One sentence.)
- What is a defensive publication and why does it protect students?
- When does the impact counter increment, and what do unconfirmed claims look like?
- Give the selfish reason each of the five actors shows up.
- What happens if the venue wifi is down at 1:30 into your demo?
