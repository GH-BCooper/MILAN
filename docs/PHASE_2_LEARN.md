# Phase 2 — LEARN

**Phase 2 = the intelligence.** The five-stage pipeline, the live animated trace, the explainable
priority score, capability routing with written reasons, the human gate, and the HEI claim flow.
This is the phase judges actually watch.

Read before handing over `PHASE_2_BUILD.md`. Time: **2 hours.** This is the phase where you will be
challenged in Q&A, so learn the *reasoning*, not the API calls.

---

## 1. The one idea that makes this phase defensible

> **The model returns structured facts with a confidence. Deterministic code makes every decision.**

Every hard question a judge asks in this space — "what if the AI is wrong?", "how do you know it
isn't hallucinating?", "is this just a ChatGPT wrapper?" — is answered by that sentence plus a demo.

Concretely:
- S1 returns `{is_unsafe, is_grievance, confidence}`. **Our code** decides to reject, forward or continue.
- S2 returns `{domain, hazard, hazard_strength, severity, confidence}`. **Our code** decides whether
  confidence is high enough or the item drops to the human queue.
- S3 uses **cosine distance**, a number, with fixed thresholds. The LLM only adjudicates the
  ambiguous middle band.
- S4 has **no model call at all**. It is a weighted sum in a versioned, unit-tested pure function.
- S5 computes a hybrid match score in code, then hands the model the **top three contributing terms**
  and asks it to write one sentence. It cannot invent a reason it was not given.

Say that last line on stage. It is the difference between "AI-powered" and "AI-assisted with
verifiable grounding".

---

## 2. Structured output from an LLM

A normal LLM call returns prose you have to parse. That is fragile and it is how demos die.
Both Gemini and Groq support constraining output to a JSON schema.

The pattern:
```ts
const S2Schema = z.object({
  domain: z.enum(DOMAINS),
  hazard: z.enum(HAZARDS),
  hazard_strength: z.number().min(0).max(1),
  severity: z.number().min(0).max(1),
  rationale: z.string().max(240),
  confidence: z.number().min(0).max(1),
});
// call with responseMimeType: "application/json" + responseSchema
const out = S2Schema.parse(JSON.parse(raw));   // parse, never trust
```

Three things to internalise:
1. **Zod-parse the output even when the API guarantees the schema.** A provider fallback may not
   guarantee it, and a parse failure must be caught and fall through the chain, not crash a page.
2. **Ask for a `confidence` field and use it.** It is the input to the human-queue threshold. A model
   is not calibrated, but a low self-reported confidence is still strongly correlated with being
   wrong, and it costs nothing.
3. **Ask for a short `rationale`.** It goes on screen. Explainability is the pitch.

### Few-shot, not fine-tuning
We have no labelled dataset and no GPU budget, so we do not fine-tune, and **we say so on the slide**.
Instead each prompt carries 6–10 curated Jharkhand examples covering the tricky boundaries
(grievance vs. unsolved problem, water vs. flood hazard, a "my village" report that should roll up).
Curating those examples is a human task and it is worth an hour of somebody's day.

### The embedding kNN prior
Before we call the model for S2, we look up the k nearest already-classified challenges by embedding
and pass their labels in as a prior: *"the 5 most similar prior challenges were classified WATER/FLOOD,
WATER/FLOOD, WATER/DROUGHT..."*. This is a cheap, honest substitute for fine-tuning and it improves
with every human correction. **This is a real answer to "your AI is thin" — the system learns from
its own corrected history without retraining anything.**

---

## 3. Embeddings, vectors and pgvector

An **embedding** turns text into a fixed-length list of numbers (we use 768 dimensions) such that
texts with similar meaning land near each other in that space.

**Cosine similarity** measures the angle between two vectors: 1.0 = identical direction,
0.0 = unrelated. It ignores magnitude, which is what we want for text of different lengths.
pgvector's `<=>` operator gives cosine *distance*, so `similarity = 1 - distance`.

```sql
SELECT id, title, 1 - (embedding <=> $1) AS similarity
FROM challenges
WHERE block_code = $2                 -- cheap prefilter first
ORDER BY embedding <=> $1
LIMIT 10;
```

**HNSW** (Hierarchical Navigable Small World) is the index type. Without it, that query scans every
row; with it, it is a graph walk. At 25 rows it makes no difference — build it anyway, because
"would this work at 250,000 challenges?" is a guaranteed judge question and the honest answer is
"yes, and here is the index".

**Caching:** embeddings are deterministic for the same input, so we key them on the SHA-256 of the
input text. Re-running the pipeline on a seeded challenge costs nothing. This is also what makes
every stage **idempotent and replayable**, which is what makes the live trace animation safe to
re-run on stage.

### The S3 thresholds — memorise these numbers
| Cosine similarity | Action |
|---|---|
| ≥ 0.86 | auto-merge; the new report becomes a **corroboration** of the existing challenge |
| 0.72 – 0.86 | ambiguous → LLM adjudication with both texts |
| < 0.72 | a distinct challenge |

And the roll-up rule: **three child challenges across two panchayats create a `BLOCK_SYSTEMIC`
parent.** Children are linked, never deleted.

Why thresholds and not "ask the model every time": cost, latency, and determinism. The same input
gives the same answer every time, which you can demonstrate. Be ready to say the thresholds were
tuned by hand on the seed set and that a production system would tune them on labelled data.

---

## 4. The priority score — the most important 40 lines in the repo

`packages/scoring` is a **pure function**: no network, no database, no clock. Input is a plain
object, output is a score and a full breakdown. It is versioned (`scoring_version: "1.0.0"`) and
unit-tested. That purity is what lets us re-score every challenge nightly and show a judge that the
number is reproducible.

Seven terms, each normalised to 0–1, then a weighted sum:

| Term | Weight | Where it comes from |
|---|---|---|
| Severity | 0.22 | S2 |
| Hazard linkage | 0.20 | S2 (`hazard_strength`, 0 if `NONE`) |
| People affected | 0.15 | intake, log-normalised |
| Block vulnerability index | 0.15 | seeded from JSDMA district plans |
| Corroborations | 0.12 | S3, with **diminishing returns** |
| Recurrence | 0.10 | intake |
| Official endorsement | 0.06 | block officer verification |

Design points you must be able to defend:
- **Log-normalise people affected.** Linear scaling means one large-town report always outranks every
  village. `log(1+n)/log(1+n_max)` keeps small settlements visible. *Equity is a design choice we
  made explicitly, and we can point at the line of code.*
- **Diminishing returns on corroborations** (`sqrt` or `log`) so 200 reports do not swamp a severe
  single report — and so a brigading attack has a bounded payoff. Combine with the geographic and
  identity dedup from Phase 1 (loophole row 7).
- **Hazard linkage carries 0.20**, second-highest, because this is a Disaster Management PS and
  mitigation of a hazard-linked problem is the mandate.
- **The breakdown is shown to everyone.** Every term, its raw value, its normalised value, its
  weight, its contribution, and the total. "No citizen is deprioritised by a black box" is only true
  if the breakdown is on the public page — which it is.

Be ready for: *"who chose those weights?"* Honest answer: we did, informed by NDMA's risk framing;
they are stored as a versioned config, every score records the version it was computed under, and a
state authority can change them without a redeploy. That is a better answer than pretending they are
objective.

---

## 5. Capability routing — the hybrid score

S5 matches a challenge against the **Institutional Capability Graph** (departments, labs, faculty
specialisations, declared capacity, location). The match score is a weighted blend:

| Signal | Weight | How |
|---|---|---|
| Semantic fit | 0.45 | cosine(challenge embedding, capability embedding) |
| Tag overlap | 0.20 | Jaccard over `specialisation_tags` vs. domain/hazard keywords |
| Distance | 0.15 | decay over road-ish distance from the challenge to the institution |
| Declared capacity | 0.12 | free capstone slots in the relevant window, 0 if the window is closed |
| Track record | 0.08 | past claimed + delivered challenges in this domain |

Then: rank, take the **top 3**, multicast with a **7-day claim window**.

**"Push, never browse"** is the product claim this implements. A professor never goes looking; the
notification arrives with a direct action link. Say it exactly that way.

**The reason sentence.** We take the top three contributing terms by `weight × value`, hand them to
the model as structured facts, and it writes one sentence around them:
> *"Matched to BIT Sindri, Civil Engineering — Flood Resilience Lab: strong specialisation overlap
> with embankment and flood mitigation, 148 km from Gumla, and 3 capstone slots declared open for
> Aug–Dec 2026."*
The model cannot cite a fact it was not handed. That is a structural guarantee, not a prompt request.

---

## 6. Server-Sent Events — how the pipeline animates live

The whole demo rests on the judge watching stages tick over. SSE is the simplest possible way to do
that: a normal HTTP response that stays open and streams `data: {...}\n\n` lines. No websocket
server, no library.

```ts
// app/api/pipeline/stream/route.ts
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));
      await runPipeline(challengeId, send);   // send() called after each stage
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", ... } });
}
```
The browser side is `new EventSource(url)` and `onmessage`.

Two gotchas worth knowing before they bite you on Day 3:
- **Buffering.** Some proxies buffer streamed responses. Set `Cache-Control: no-cache, no-transform`
  and `X-Accel-Buffering: no`.
- **Serverless timeouts.** Vercel Hobby caps function duration. Our budget (S1 1.5 s, S2 1.5 s,
  embed 200 ms, S3 200 ms, S4 < 5 ms, S5 300 ms ≈ **4–6 seconds**) is comfortably inside it, but a
  hung provider call is not — hence a hard per-stage timeout with a fallback, never an open-ended await.

Every visible tick on screen corresponds to **one real row in `ai_runs`** recording provider, model,
confidence, fallback level and latency. If a judge asks whether the animation is fake, open
`/admin/ai-runs` and show the rows.

---

## 7. The provider chain and why it exists

```
Gemini 2.5 Flash  →  Groq  →  deterministic rules (keywords + gazetteer, no network)
     level 0            1                    2
```

The rule fallback is not a joke tier. For S1 it is a keyword list for unsafe/criminal content plus a
grievance-phrase list ("sanctioned", "not built", "officer", "bribe"). For S2 it is a keyword →
domain/hazard gazetteer plus the block's known hazard profile. It is worse than the model. It is
**never unavailable**, and it means the demo cannot be killed by conference wifi.

`fallback_level` is recorded on every run and shown in the trace panel. Being visibly honest about
degradation is stronger than pretending it never happens.

---

## 8. The human gate and why it is the ethical core

**Severity ≥ 0.7 → the challenge does not route until a human confirms.** It appears in
`/gov/gate` for the District Collector's office. The AI's proposal is shown with its reasoning; the
human accepts or overrides; **every override is logged with a mandatory reason and becomes labelled
training data.**

This answers loophole rows 9 and 10 at once, and it is the thing to say when a judge asks about AI
in government: *the AI never takes a consequential action alone, and every human correction makes
the next one better.*

Related, and just as important: **the AI only proposes wording.** In the framing step the citizen
approves the rewritten statement, and `body_original` is stored and displayed forever. An AI cannot
put words in a citizen's mouth in Milan.

---

## 9. Things you must do yourself after Phase 2

1. **Curate the few-shot examples.** 6–10 per stage, drawn from your real seed challenges, covering
   the boundary cases. This is a human judgement task and it is the single highest-leverage hour in
   the whole build.
2. **Run the pipeline over all 25 seeded challenges and read every output.** Any misclassification
   you find now is one a judge will not find on stage. Fix by adding a few-shot example, not by
   hard-coding.
3. **Tune the S3 thresholds against your own near-duplicates.** Confirm your three planted duplicate
   reports actually merge, and that two genuinely different water problems do not.
4. **Sanity-check the routing.** For each seeded challenge, is the top match one you would defend
   out loud? If BIT Sindri Civil is not top for the embankment crack, fix the capability tags in
   `seed-data/capabilities.csv` — the data, not the algorithm.
5. **Test with the wifi off.** Every stage must degrade to the rule fallback and the UI must show
   `fallback_level = 2` rather than an error. Do this once with a stopwatch.
6. **Time the pipeline on the venue's likely network.** If it exceeds 8 seconds, pre-warm and cache
   the seeded path and only run live on the judge-typed problem.
7. **Write the routing-reasons panel copy** in Hindi as well as English.
8. **Drill loophole rows 5, 6, 7, 9, 10** — they are all Phase 2 rows.

---

## 10. Self-check before Phase 3

- Why does S4 contain no model call?
- What are the three S3 cosine bands and what happens in each?
- What creates a `BLOCK_SYSTEMIC` parent?
- Name the seven scoring terms and the two highest weights.
- Why is "people affected" log-normalised?
- Why can the routing model not invent a reason?
- What is `fallback_level` and where is it visible?
- What exactly happens at severity 0.7?
- What is the embedding kNN prior and why is it our answer to not fine-tuning?
- If the conference wifi dies mid-demo, what does the judge see?
