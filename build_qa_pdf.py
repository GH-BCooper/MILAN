"""
Builds ApplicationQA_Answers.pdf — Milan's response to the 28 judge questions.
Uses ReportLab Platypus for professional layout.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white, grey
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

OUT = "/home/user/MILAN/ApplicationQA_Answers.pdf"

# ---------- Brand palette (Milan: deep teal / amber accent) ----------
NAVY = HexColor("#0F2A33")
TEAL = HexColor("#0E6B6B")
AMBER = HexColor("#B8741A")
INK = HexColor("#1B1B1B")
SOFT = HexColor("#5A5A5A")
LINE = HexColor("#D8D8D8")
BAND = HexColor("#F4F1EA")
PILL_BG = HexColor("#EAF2F1")

# ---------- Styles ----------
styles = getSampleStyleSheet()

H_TITLE = ParagraphStyle(
    "H_TITLE", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=22, leading=26, textColor=NAVY, spaceAfter=6, alignment=TA_LEFT,
)
H_SUB = ParagraphStyle(
    "H_SUB", parent=styles["Normal"], fontName="Helvetica",
    fontSize=11, leading=15, textColor=SOFT, spaceAfter=14, alignment=TA_LEFT,
)
H_SECTION = ParagraphStyle(
    "H_SECTION", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=15, leading=19, textColor=white, spaceBefore=8, spaceAfter=8,
    backColor=TEAL, leftIndent=8, rightIndent=8, borderPadding=(6, 8, 6, 8),
)
H_Q = ParagraphStyle(
    "H_Q", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=10, spaceAfter=4,
)
H_A = ParagraphStyle(
    "H_A", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=8.5, leading=11, textColor=AMBER, spaceBefore=2, spaceAfter=2,
)
BODY = ParagraphStyle(
    "BODY", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=10, leading=14, textColor=INK, spaceAfter=6, alignment=TA_JUSTIFY,
)
BULLET = ParagraphStyle(
    "BULLET", parent=BODY, leftIndent=14, bulletIndent=4, spaceAfter=3,
)
PILL = ParagraphStyle(
    "PILL", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=8, leading=10, textColor=TEAL,
)
FOOT = ParagraphStyle(
    "FOOT", parent=styles["Normal"], fontName="Helvetica",
    fontSize=8, leading=10, textColor=SOFT, alignment=TA_CENTER,
)


# ---------- Page frame (header + footer) ----------
def page_decoration(canv, doc):
    canv.saveState()
    w, h = A4

    # Top brand strip
    canv.setFillColor(NAVY)
    canv.rect(0, h - 1.4 * cm, w, 1.4 * cm, fill=1, stroke=0)
    canv.setFillColor(AMBER)
    canv.rect(0, h - 1.55 * cm, w, 0.15 * cm, fill=1, stroke=0)
    canv.setFillColor(white)
    canv.setFont("Helvetica-Bold", 9.5)
    canv.drawString(2 * cm, h - 0.95 * cm, "MILAN  ·  Application Q&A")
    canv.setFont("Helvetica", 9)
    canv.drawRightString(w - 2 * cm, h - 0.95 * cm,
                         "Smart India Hackathon 2026  ·  SIH26043")

    # Footer
    canv.setStrokeColor(LINE)
    canv.setLineWidth(0.4)
    canv.line(2 * cm, 1.3 * cm, w - 2 * cm, 1.3 * cm)
    canv.setFillColor(SOFT)
    canv.setFont("Helvetica", 8)
    canv.drawString(2 * cm, 1.0 * cm,
                    "Milan — a mitigation pipeline that runs in peacetime.")
    canv.drawRightString(w - 2 * cm, 1.0 * cm, f"Page {doc.page}")

    # Side rule
    canv.setStrokeColor(LINE)
    canv.setLineWidth(0.4)
    canv.line(1.4 * cm, 1.6 * cm, 1.4 * cm, h - 1.7 * cm)

    canv.restoreState()


# ---------- Q&A content ----------
QA = [
    # ============== PROBLEM & CONCEPT ==============
    ("Problem & Concept", [
        (
            "1. This is filed under Disaster Management, but you're talking about "
            "agriculture, water, education. Explain.",
            "Disaster management in India is overwhelmingly mitigation and preparedness, "
            "not response. The National Disaster Management Plan and the Sendai "
            "Framework both put the work *before* the event — reducing risk, building "
            "capacity, identifying vulnerabilities. An embankment that cracks in the dry "
            "season, a watershed that has lost its cover, a school that floods every "
            "monsoon, a public-health signal that precedes an epidemic — these are all "
            "disaster-management problems expressed through the sector they touch. "
            "Milan does not replace the agriculture, water or education departments; it "
            "routes unsolved problems from those sectors to a research lab so the "
            "fix exists before the disaster. Every challenge in Milan carries an "
            "explicit NDMA hazard linkage (FLOOD, DROUGHT, LANDSLIDE, HEATWAVE, "
            "MINING_SUBSIDENCE, EPIDEMIC, FOREST_FIRE, or NONE) and that linkage is a "
            "weighted term in the priority score. Agriculture, water and education "
            "problems that *do* carry a hazard are exactly the work DM exists to fund; "
            "problems without a hazard link still flow through, because what a citizen "
            "sees as \"education\" the system sees as \"school vulnerability\". Filed "
            "under DM, because the platform's organising idea is risk reduction."
        ),
        (
            "2. How is Milan different from CPGRAMS or JharSewa? Why build another portal?",
            "CPGRAMS and JharSewa route complaints with a *known fix* to an accountable "
            "officer. Milan routes *unsolved problems* to a lab, with a clock. "
            "Concretely: when a citizen reports a broken handpump with a sanctioned "
            "PHED contractor, that is a grievance — S1 detects it, Milan hands it off "
            "to the right grievance portal, and the citizen sees the exact JSON payload "
            "Milan would have POSTed and the reference number it would have received. "
            "When a citizen reports a recurring monsoon flood in a ward that has no "
            "engineering answer yet, CPGRAMS cannot help — there is no officer to "
            "complain to, because nobody knows the fix. Milan treats that as a "
            "research question, frames it, scores it, routes it to the university "
            "department whose capability graph best matches, opens a 7-day claim "
            "clock, and never lets it silently die. We are not a fourth portal. We are "
            "the pipeline that catches what grievance portals structurally cannot, and "
            "we hand back to them the things that *are* grievances, with full "
            "traceability."
        ),
        (
            "3. What is the actual core problem you are solving?",
            "Two compounding failures in Indian civic problem-solving. First, "
            "discovery is luck: most unsolved local problems never reach a researcher "
            "who can solve them, because there is no pipeline. Second, when a problem "
            "is picked up, contribution is invisible: a citizen's testimony, a "
            "student's fieldwork, a panchayat's local knowledge, a professor's "
            "guidance — none of it has a durable, verifiable record. So the same "
            "problems get re-surveyed badly every five years by different consultants "
            "who never know what came before. Milan fixes both: it pushes every "
            "verified problem to a matched university department with an SLA clock, "
            "and it writes every contribution into a hash-chained credit ledger that "
            "nobody can erase. The product is the join of those two fixes — that join "
            "is what does not exist today."
        ),
        (
            "4. Why would this work in Jharkhand specifically? Is it not too rural "
            "for a tech platform?",
            "Jharkhand is the right size and the right shape. It is small enough "
            "(24 districts, ~33 million people) that the entire state is in scope for "
            "one deployment, but large and varied enough (tribal heartland, mining "
            "districts, Kharif-dependent agriculture, recurring flood and drought "
            "corridors) that the platform is exercised across every hazard and "
            "domain. The seed already covers all 24 districts and 263 blocks against "
            "real Jharkhand boundary geometry. \"Too rural\" is the exact problem the "
            "design addresses: intake works on a 320px phone in Hindi, with offline "
            "drafts, an EXIF-stripping upload, a tap-to-blur privacy step, and an "
            "IVR/WhatsApp seam reserved for the next cut. The citizen never has to "
            "log in to confirm impact (a signed link, 90-day TTL, works on any "
            "device). What is *rural* in Jharkhand is also what is digitally "
            "underserved everywhere — solving it here generalises. Finally, the "
            "tribal languages are not a blocker to a typed or voice report: P0 "
            "transcribes voice notes (Groq whisper-large-v3), and the citizen's own "
            "words render at the same size as any English copy, never behind a toggle."
        ),
        (
            "5. How is Milan different from SIH itself?",
            "SIH is a once-a-year competition that produces a working prototype and "
            "then moves on. Milan is the after-SIH plumbing: a permanent registry of "
            "real problems, a permanent record of who solved them, and a permanent "
            "ladder that ensures the unsolved ones do not die in a drawer. SIH "
            "evaluates a team; Milan evaluates an outcome, against the citizen's own "
            "confirmation. SIH ends on a demo day; Milan is the demo day becoming a "
            "year-round pipeline, fed by the same citizen reports, scored the same "
            "way, claimed the same way, and the impact counter only moves when a real "
            "person says \"yes, this changed something in my village\". We are not "
            "replacing SIH; we are what SIH's winning teams need to exist inside, "
            "long after the hackathon is over."
        ),
    ]),

    # ============== AI & TECHNOLOGY ==============
    ("AI & Technology", [
        (
            "6. Walk us through how the AI works.",
            "Six stages, all in `lib/ai/pipeline.ts`, with every model call writing "
            "an `ai_runs` receipt. <b>P0 (Language)</b> transcribes any attached voice "
            "note and produces an English working copy of the report — the citizen's "
            "own words are never overwritten. <b>S1 (Safety/Triage)</b> classifies the "
            "report as unsafe, grievance, low-confidence, or a research problem. "
            "Unsafe content (confidence ≥ 0.60) is rejected with a helpline; "
            "grievances with textual evidence are forwarded to CPGRAMS/JharSewa "
            "form; everything below 0.60 confidence is held for a human at "
            "`/admin/triage` rather than auto-routed. <b>S2 (Domain/Hazard)</b> picks "
            "one of ten domains and one of eight NDMA hazards with a strength, and "
            "kicks off S5 in parallel. <b>S3 (Clustering)</b> does pgvector cosine "
            "matching against existing challenges: ≥ 0.86 auto-merges, 0.72–0.86 is "
            "adjudicated by a single yes/no model call, &lt; 0.72 is distinct. "
            "Duplicates are *signal* — the older report is preserved as the survivor, "
            "both reporters are credited, a corroboration row increments the count. "
            "<b>S4 (Priority score)</b> is a pure TypeScript function in "
            "`packages/scoring` — zero model calls, seven weighted terms that sum to "
            "exactly 1.00, all rendered visibly on the public challenge page. <b>S5 "
            "(Routing)</b> ranks institutions against the Institutional Capability "
            "Graph on five signals (semantic fit 0.45, specialisation 0.20, distance "
            "0.15, declared capacity 0.12, track record 0.08) and writes the top 3 "
            "distinct organisations. If severity ≥ 0.70, those three offers are "
            "written with `notified_at = null` — nothing is sent until a District "
            "Collector confirms at `/gov/gate`."
        ),
        (
            "7. What models are you using? Is this just ChatGPT wrapped in a UI?",
            "It is not a wrapper, and the distinction matters because we have to be "
            "right at the last mile, not at the prompt. The live chain is <b>Gemini "
            "Flash → Groq (openai/gpt-oss-120b) → deterministic rules</b>, tried in "
            "order, with a deliberately-appended rules fallback that means a "
            "provider outage is a fallback level, not an outage. Embeddings are 768-d "
            "and live in pgvector. We do <b>not</b> fine-tune — there is no labelled "
            "data and no GPU budget — but every human override at `/admin/triage` or "
            "`/gov/gate` writes a row to `training_corrections`, which is the labelled "
            "data for the next embedding kNN prior. So the system \"learns\" from "
            "human corrections without ever being trusted to act on its own "
            "uncertainties. We are also explicit about which decisions the model "
            "*cannot* make: the priority score (S4) is a pure function with no model "
            "calls reachable from it at all, the routing bar (85/100) is "
            "deterministic, the human gate at severity ≥ 0.70 is structural in code, "
            "and the routing reason sentences are post-validated by `guardReason()` "
            "which rejects any number not in the supplied facts. The model proposes; "
            "code decides. That's the invariant."
        ),
        (
            "8. How does the routing engine work? How does it know which university "
            "to send a problem to?",
            "Each institution publishes an <b>Institutional Capability Graph</b> — a "
            "set of capability rows (e.g. \"hydrology + flood modelling + Koshi "
            "basin\", \"rural water supply + Santhal Pargana\", \"soil stabilisation + "
            "laterite\") with department, tags, declared open capacity for the "
            "current window, location, and a track record. S5 computes a match score "
            "per institution: <b>0.45 × cosine(challenge embedding, capability "
            "embedding) + 0.20 × Jaccard(specialisation tags, domain+hazard keyword "
            "expansion) + 0.15 × exp(-km / 250) + 0.12 × declared capacity (capped at "
            "5) + 0.08 × Laplace-smoothed track record</b>. Ranked, then the top "
            "<b>3 distinct organisations</b> — never two labs at one college, because "
            "a shortlist of three departments in one place is not a shortlist. The "
            "model is then asked to write one sentence explaining the top three "
            "contributing terms for each of the three offers, but it is handed only "
            "those three terms — not the challenge text, not the institution facts. "
            "`guardReason()` then rejects any sentence containing a number that was "
            "not in the supplied facts. A rejected sentence falls back to a blunt "
            "template over the same three facts. This is a structural guarantee in "
            "code, not a prompt instruction."
        ),
        (
            "9. What happens when 200 people report the same broken water pipeline?",
            "Two layers, both running on every submission. <b>S3 (clustering)</b> "
            "treats it as one event, not 200. The first report becomes the survivor "
            "and keeps its tracking ID; reports 2–200 are marked `MERGED` (terminal) "
            "with a `CORROBORATOR` credit edge onto the survivor — nobody is "
            "discarded, nobody is double-counted, the older report is always "
            "preserved (older ID wins on a same-instant tie). Each merged report "
            "also writes a `CREDIT_EDGE` ledger entry that says \"nothing was "
            "discarded\". The survivor's `corroboration_count` increments; if it "
            "crosses three distinct reporters across two or more blocks, S3 also "
            "spawns a `BLOCK_SYSTEMIC` parent challenge that is itself scorable and "
            "routable. <b>Anti-brigading</b> runs on top: one account, one "
            "corroboration per challenge (unique index), corroboration weight "
            "decays with distance from the incident (full weight within 15 km, "
            "exponential decay beyond, never zero), a 5-per-hour submission rate "
            "limit per actor, and a decaying trust score (earned only at "
            "`CITIZEN_VERIFIED`, lost on `REJECTED_UNSAFE`, decayed nightly toward "
            "0.50) that weights the corroboration term in S4. So 200 reports from "
            "200 real neighbours, all within 15 km, all with high trust, genuinely "
            "do raise the priority — and 200 reports from one device fingerprint are "
            "exactly one report, with the fingerprint flagged and zeroed for "
            "transparency."
        ),
        (
            "10. How do you handle submissions in Santhali, Ho, or Mundari?",
            "Honestly, in the first cut we cover Hindi and English end-to-end, plus "
            "one Santhali sample for the demo. We say so on a slide rather than "
            "pretending. The path for the other languages is engineered: P0 uses "
            "Groq `whisper-large-v3` for voice transcription, which supports "
            "Santhali, Ho and Mundari in addition to the major Indic languages; for "
            "text, the S1/S2 prompts include few-shot examples in the target script. "
            "What we do <b>not</b> do, on purpose, is hide the citizen's own words "
            "behind a translation. The challenge page renders the original text at "
            "the same size and weight as the English working copy, side by side, "
            "and the database itself documents this with a column comment in "
            "migration 0006 — that is invariant 6. If a translation fails, `body_en` "
            "is left null rather than filled with the original; rendering the "
            "citizen's Hindi under a heading that says \"English working copy\" "
            "would be a small lie on a page whose whole argument is that nothing is "
            "hidden. The roadmap is: add a curated few-shot per language with a "
            "native speaker, expand transcription coverage, and let every human "
            "correction in `training_corrections` improve the next automatic answer."
        ),
        (
            "11. What is your tech stack?",
            "One Next.js 15 deployable, one Postgres 17 database, one outbox table "
            "standing in for a queue, one AI provider chain. Concretely: <b>Next.js "
            "15 (App Router, RSC) + React 19 + Tailwind v4 + shadcn/ui</b> on the "
            "front end; <b>Leaflet + Protomaps (PMTiles, offline-ready)</b> for maps; "
            "<b>Recharts</b> for the stats page; <b>Better Auth</b> with a "
            "hand-rolled OTP layer on top; <b>Drizzle ORM + Zod</b> for the schema "
            "and validation; <b>Supabase PostgreSQL 17 with pgvector (HNSW), FTS, "
            "and pg_trgm</b> for the database; <b>Supabase Storage (or MinIO "
            "offline)</b> keyed by content hash; <b>Gemini Flash → Groq → "
            "deterministic rules</b> for the LLM chain; <b>SSE</b> (native "
            "ReadableStream) for the pipeline trace; <b>Vercel + Vercel Cron</b> "
            "for hosting and scheduling; <b>GitHub Actions</b> for CI; <b>pnpm</b> "
            "workspaces. Deliberately excluded, with reasons: <b>blockchain</b> (a "
            "SHA-256 chain plus a public timestamp gives the same non-repudiation at "
            "zero cost and zero latency), <b>a separate vector database</b> (pgvector "
            "with HNSW scales to millions of rows), <b>Kafka</b> (a transactional "
            "outbox covers every event at this state scale), <b>fine-tuned "
            "models</b> (no labelled data, no GPU budget — few-shot + embedding kNN "
            "prior, declared honestly), and <b>a separate API and inference "
            "service</b> (one deployable, every module in its own folder so it "
            "splits out later without a rewrite)."
        ),
        (
            "12. How do you ensure AI decisions are fair and not a black box?",
            "Three layers. <b>Layer 1 — what the model cannot do.</b> S4 (priority "
            "score) is a pure TypeScript function with zero model calls reachable "
            "from it. The human gate at severity ≥ 0.70 is structural in code: "
            "`persistRoutes()` writes the shortlist with `notified_at = null`, and "
            "nothing is sent until a District Collector confirms at `/gov/gate`. "
            "The 85/100 routing bar is deterministic — anything below is `PARKED`, "
            "not \"low priority routed\". <b>Layer 2 — what the model is allowed to "
            "say.</b> `guardReason()` rejects any routing reason sentence that "
            "contains a number not present in the facts the model was given. A "
            "rejected sentence falls back to a template. The model never sees the "
            "challenge text when writing routing reasons — only the top three "
            "contributing terms — so it cannot leak demographic details into the "
            "sentence. <b>Layer 3 — what the public can see.</b> Every score is "
            "rendered on the public challenge page with the full breakdown — each "
            "term's raw value, normalised value, weight and contribution, the "
            "arithmetic visible and clickable. That is invariant 10. Every model "
            "call writes a receipt to `ai_runs` (provider, model, fallback level, "
            "confidence, latency, input hash) viewable at `/admin/ai-runs`. Every "
            "human override is logged to `audit_log` and to `training_corrections`, "
            "so the system's behaviour under override is itself auditable. We are "
            "not claiming the model is fair; we are claiming the system around the "
            "model constrains the model's room to be unfair, and shows its work."
        ),
    ]),

    # ============== LOOPHOLES & RISKS ==============
    ("Loopholes & Risks", [
        (
            "13. What if no university ever claims a challenge?",
            "There is a four-rung ladder, all on a clock. <b>+7 days (WIDEN)</b>: "
            "S5 is re-run and five more institutions are offered the challenge — the "
            "next-five-best from the original graph, with the shortlist reason "
            "rendered the same way. <b>+14 days (OPEN_ALL)</b>: the challenge is "
            "visible and claimable in every `/hei/challenge-bank` in the state, and "
            "the district officer is notified. <b>+21 days (BREACH)</b>: "
            "`sla_breached_at` is stamped, the challenge is listed on the public "
            "`/bounties` board, and the DC + admins are notified. <b>+45 days "
            "(GRAND_CHALLENGE)</b>: the challenge joins the annual Jharkhand Grand "
            "Challenges set, and an `ANNUAL_REVIEW` deadline (365 days, never "
            "compressed by Emergency Mode) keeps it visible. Importantly, none of "
            "this is a cron job someone remembered to write. Every non-terminal "
            "state carries a durable `sla_deadlines` row, opened in the same "
            "transaction as the state change itself, and a CI query fails the build "
            "if any challenge anywhere is without one. `tests/invariant.test.ts` is "
            "a required CI check that returns zero orphans. \"No one claimed it\" "
            "is a state, and that state has consequences."
        ),
        (
            "14. What if a team takes a challenge and then abandons it midway?",
            "Two further ladders, both on `projects.last_activity_at` (not the claim "
            "date — the last thing the team actually did). <b>Ladder 2 — silence on "
            "the proposal.</b> `CLAIMED` opens `PROPOSAL_DUE` at +14 days: the lead "
            "and the HOD are nudged, then re-nudged at +21 days. At +21 the claim "
            "is <b>released</b> — the project row is marked `RELEASED_UNDELIVERED` "
            "(never deleted), the offer routes clear back to `ROUTED`, and the "
            "prior team's project, credit edges, and any partial work are preserved "
            "and attributed permanently. \"We do not stop people from sharing work. "
            "We make it impossible to erase who did it\" applies to a team that "
            "failed to deliver as much as to one that succeeded. <b>Ladder 3 — "
            "silence mid-project.</b> `PROPOSAL_APPROVED`/`IN_RESEARCH` opens "
            "`SILENT_30` and `SILENT_45`. At 30 days the project is publicly flagged "
            "`AT_RISK` and the mentor is nudged. At 45 days <b>fork rights open</b> "
            "— another team may fork the work, with the original team's project and "
            "credit edges kept intact and visible on the fork."
        ),
        (
            "15. What if someone submits fake or malicious reports to game the system?",
            "Three concentric defences. <b>Input gating</b>: a deterministic offline "
            "moderation pre-filter (`lib/moderation/blocklist.ts`) catches "
            "profanity, low-effort/troll phrases, character-spam and repeated-word "
            "heuristics before the request hits the model; a 5-per-hour rate limit "
            "per actor; one account, one corroboration per challenge (unique "
            "index); corroboration weight decays with distance from the incident "
            "(full weight within 15 km, exponential decay beyond, never zero); more "
            "than 3 corroborations from one device fingerprint or more than 25 in "
            "one hour flags that fingerprint and zeroes its weight (never deletes "
            "it — it stays visible as evidence someone tried); corroborations from "
            "more than 150 km away are flagged as down-weighted. <b>Output "
            "correction</b>: S2's classification and S5's routing are reviewed by a "
            "human at `/admin/triage` and `/gov/gate`; overrides are written to "
            "`training_corrections` and become labelled data. <b>Trust as a "
            "structural disincentive</b>: a `REJECTED_UNSAFE` event costs the "
            "reporter −0.20 in trust, deliberately larger than five good events "
            "combined, so brigading a false narrative and then reporting something "
            "real does not net out to zero. Trust decays nightly toward a 0.50 "
            "baseline (good standing must be renewed; bad standing is forgivable). "
            "Finally, the impact counter — the only number anyone outside the system "
            "cares about — moves only on `CITIZEN_VERIFIED`, i.e. when the *citizen* "
            "says the problem was real and the fix worked. You can game the queue, "
            "but you cannot game the citizen's confirmation."
        ),
        (
            "16. What if a company steals a university's research and publishes it as "
            "their own?",
            "Two layers of defence. <b>Defensive publication as prior art.</b> "
            "Publication writes a ledger entry committing to the file's own SHA-256 "
            "at a timestamp. That does not stop a patent being filed — nothing can — "
            "but it makes the work prior art, which is what stops one being granted "
            "over it. The prior-art panel on `/artifacts/[id]` says exactly that, "
            "and the ledger entry is the timestamp a patent examiner will see. "
            "<b>Access logging on restricted files.</b> A CC-BY file is open to "
            "anyone with attribution; a RESTRICTED file is read only through a "
            "verified identity with a stated purpose, granted by the project lead, "
            "and every actual download writes an `access_log` row and an `ACCESS` "
            "ledger entry visible to the team and to the originating citizen. There "
            "is no anonymous read. If a company is later found using the work "
            "without permission, the access log shows who, when, and under what "
            "stated purpose. The MoU is generated from a template, SHA-256 hashed, "
            "and the hash is appended to the ledger; e-signature and payment rails "
            "are declared stubs, and the document says so on its own face. IP "
            "dispute adjudication is also a declared stub — but the evidence the "
            "dispute would be decided on is in place and verifiable."
        ),
        (
            "17. What if the AI misclassifies a serious problem — say, sends a "
            "flood-risk report to the wrong department?",
            "Three things make that rare, and one thing makes it reversible. "
            "<b>Rare, because the S2 classifier is constrained.</b> S2 is seeded "
            "with an embedding kNN prior over already-classified challenges — the "
            "closest thing this system has to \"learning\" without a fine-tune. "
            "Every human correction lands in `training_corrections` and improves "
            "the next prior. S2 also picks from a fixed taxonomy of ten domains and "
            "eight NDMA hazards, so the misclassification modes are enumerable. "
            "<b>Rare, because the routing reason is guardrailed.</b> `guardReason()` "
            "rejects any sentence containing a number not in the supplied facts — "
            "the model cannot invent \"five villages at risk\" if only two are in "
            "the input. <b>Rare, because the human gate stands in front of "
            "consequential routing.</b> At severity ≥ 0.70, `notified_at` is null "
            "until a District Collector confirms at `/gov/gate` — the wrong "
            "department would not be notified without a human's signature. <b>Reversible, "
            "because the state machine is explicit.</b> Every state change writes a "
            "`STATE_CHANGE` ledger entry and an `audit_log` row; admins can reroute "
            "from `/admin/routing` with a mandatory written reason, and from "
            "`/admin/challenges` with a state override that demands a reason. The "
            "original state and the override are both on the chain. \"Misclassified\" "
            "is detectable, attributable, and fixable — not silently absorbed."
        ),
        (
            "18. What if a citizen's report contains someone's face or personal data "
            "in a photo?",
            "Stronger than \"anonymised after upload\" — the unblurred original "
            "never leaves the device. The submit wizard has a photo step that opens "
            "a canvas mosaic; the citizen taps to place a blur box over faces, "
            "number plates, or anything else they do not want public, and only the "
            "blurred bytes are ever uploaded. `challenge_media.faces_blurred` "
            "records what the citizen actually blurred, so the audit trail is "
            "honest about whether the citizen did the work. The server then strips "
            "EXIF and GPS metadata from the processed image (`lib/media/upload.ts`, "
            "using `sharp`) and re-keys the object by the SHA-256 of the processed "
            "bytes. Automatic face and number-plate detection is a <b>declared "
            "stub</b> — we do not pretend to have it, and we do not need it, because "
            "the citizen-driven blur is a stronger privacy claim than an automated "
            "one (an automated detector that misses a face in shadow is worse than a "
            "human who can see the photo they took). Storage itself is keyed by "
            "content hash, so a citizen who deletes the original from their phone "
            "after upload still has the same hash on the platform; conversely, the "
            "platform holds only the blurred bytes, by construction."
        ),
        (
            "19. What stops the platform from becoming a ghost town after SIH?",
            "Three structural reasons it should not, and one acknowledgement. "
            "<b>Reason 1 — the supply is the demand.</b> Every citizen report is a "
            "real final-year project. We are not \"getting universities to "
            "participate\"; we are giving them work they were already going to invent "
            "badly, except this time it is real. 200,000 Indian students invent a "
            "fake final-year project every year. We give them real ones, with a "
            "real citizen, a real credit chain, and a real publication path. "
            "<b>Reason 2 — the citizen confirmation is the only number that "
            "moves.</b> The product never converges to \"shut up and count\". "
            "Confirmed, partly confirmed, and claimed-not-confirmed are three "
            "separate counters, never summed. A CSR report built on this data is "
            "one an auditor can defend. <b>Reason 3 — the platform has multiple "
            "constituencies with different retention curves.</b> Citizens return to "
            "confirm impact (a 90-day TTL signed link, no login). District "
            "Collectors use it because the SLA board is the only place they see "
            "their overdue items with a derivation. Industry uses it because the CSR "
            "export is the only one that won't collapse under audit. HEI members use "
            "it because their students get real credit, by name, on a public chain. "
            "<b>Acknowledgement</b>: with no sustained outreach, an empty portal is a "
            "real risk. The honest answer is: we do not stop the ghost-town risk by "
            "ourselves; we stop it by being the thing the Department of Disaster "
            "Management already wants (a mitigation pipeline), the thing CSR teams "
            "already need (defensible impact data), and the thing universities "
            "already do (real capstone projects). One product, three buyers, one "
            "shared ledger."
        ),
    ]),

    # ============== ADOPTION & ACTORS ==============
    ("Adoption & Actors", [
        (
            "20. Why would a citizen bother submitting? Most people don't trust these "
            "portals.",
            "Three reasons, in increasing order of importance. <b>It is easier than "
            "a tweet.</b> Six steps on a 320px phone, in Hindi, with offline drafts, "
            "an EXIF-stripping upload, a tap-to-blur privacy step, and a tracking "
            "ID sayable over a phone (\"JH-2026-GUM-0001\") so the citizen can call "
            "back and ask. <b>They get a real answer, not a reference number.</b> "
            "A grievance gets forwarded to CPGRAMS/JharSewa, with the exact JSON "
            "payload Milan would have POSTed shown on the public page. A research "
            "problem gets routed to a real university department, with a name and a "
            "clock. <b>The citizen's own words stay on the page, and the citizen is "
            "on the team.</b> A research problem that gets claimed credits the "
            "reporter as \"Domain Informant\" on the project by default; their name "
            "is in the citation string before the institution, in the author "
            "position. <b>And only the citizen moves the impact counter.</b> When "
            "someone eventually claims the problem is fixed, the only number that "
            "moves anywhere in Milan is the one that moves when the citizen says "
            "yes. Trust is built by giving people the one thing most portals do not: "
            "a final say, with their name on it."
        ),
        (
            "21. Why would a professor or HEI engage? They're already busy.",
            "Because the work is already on their plate, just done badly. Every "
            "Indian engineering programme has capstone projects, often invented; "
            "Milan replaces that invention with a real, citizen-anchored problem "
            "with publication, credit, and CSR funding on the path. The professor "
            "gets a real client (the citizen), a real problem statement with "
            "context, a real credit chain for the student that survives the "
            "project ending, and — if it goes well — a real publication and a "
            "potential industry funder. The HOD gets a real claim flow into their "
            "lab's capacity, so the lab is not running at 60% utilisation. The "
            "department's track record on the platform is public, so it becomes a "
            "signal to attract better students and better partners. We are not "
            "asking them to do more work; we are replacing a category of work they "
            "were already doing — and the replacement comes with a citizen, a "
            "credit chain, and a clock."
        ),
        (
            "22. Why would Tata Steel or an MSME use this instead of running their "
            "own CSR directly?",
            "Three reasons, each with a price. <b>Discovery cost.</b> Running your "
            "own CSR means paying a consultant to find problems you can fund — and "
            "they will re-survey the same blocks as the last consultant, badly, "
            "because there is no shared registry. Milan is the registry. <b>Audit "
            "cost.</b> The §135 CSR report from Milan is one SQL query, used "
            "identically by the screen, the CSV and the PDF — so the three can "
            "never disagree. \"Confirmed / Partly confirmed / Claimed but not "
            "confirmed\" are three separate counters, never summed. An auditor can "
            "defend this document; an auditor cannot defend the alternative. "
            "<b>Reputation cost.</b> Every contribution is on a public ledger, "
            "forever. A company that funds a real fix gets a real, verifiable "
            "record; a company that funds a brochure gets a brochure. Industry is "
            "also an opt-in `FUNDER` credit edge on the project, so the company is "
            "named on the project's public credit chain, not in a press release "
            "that ages out. We are not competing with CSR teams; we are giving them "
            "the only impact data their auditor, their board and their PR team can "
            "all agree on."
        ),
        (
            "23. What about independent experts who don't want to be associated with "
            "their employer?",
            "The role exists. `INDEPENDENT_INNOVATOR` is in the enum (along with "
            "`EXPERT_PANEL` and `ASSISTED_SUBMITTER` — the third and fourth roles "
            "with no dedicated onboarding screen this cut, declared on a slide). "
            "An individual can claim as an independent innovator with personal "
            "credit only; their employer is never named, and the UI on "
            "`/industry/discover` states that \"a legal entity is needed to receive "
            "money, not to participate\". So an expert can: submit a problem, "
            "corroborate, be credited on a project team, and have a public credit "
            "page at `/credit/[userId]` — all without any organisational affiliation "
            "ever appearing on the chain. The roadmap is a dedicated onboarding "
            "screen for the role, with a \"claim your credit, anonymously if you "
            "prefer\" path."
        ),
        (
            "24. How do you onboard users when the platform is new and empty?",
            "We do not start empty. The seed already has 24 districts (including "
            "the JDIP 4.1 reference columns), 263 blocks, 20 organisations "
            "(academia, industry, government, NGOs), 25 challenges and a fixed cast "
            "of demo accounts that walk the entire lifecycle — three challenges "
            "routed to BIT Sindri, one in research, one published with a CSR "
            "expression of interest, one citizen-confirmed, one SLA-breached to the "
            "bounty board. `pnpm seed:states` runs that cast through the real "
            "state machine (not stubs) so the public pages have shape from minute "
            "one. For real onboarding, the levers are different for each actor: "
            "<b>citizens</b> — an assisted-submitter workflow through panchayat "
            "offices and NGO partners, plus an IVR/WhatsApp intake seam reserved "
            "for the next cut; <b>HEIs</b> — pilot with three partner departments "
            "(BIT Sindri is in the seed) and let the credit chain + publication "
            "path do the word-of-mouth; <b>industry</b> — one pilot CSR report "
            "built on the data, with the confirmation-gap chart as the headline; "
            "<b>government</b> — the District Collector at `/gov/gate` and the SLA "
            "board at `/gov/sla` are the two surfaces a DC opens daily, and both "
            "have a real, structural reason to exist (severity-gated releases, SLA "
            "escalations). Empty is a state we do not ship; shape from minute one, "
            "real load by month three."
        ),
    ]),

    # ============== PROTOTYPE & DEMO ==============
    ("Prototype & Demo", [
        (
            "25. What exactly have you built and what is stubbed?",
            "Built and rehearsed end-to-end: <b>the full citizen wizard</b> at "
            "`/submit` (six steps, localStorage drafts, photo blur, EXIF strip, "
            "Nominatim place search + GPS + tap-to-pin + district/block dropdown, "
            "framing approval, server-side name from session); <b>the full AI "
            "pipeline</b> (P0 → S1 || S2 → S3 → S4 → S5) with the provider chain "
            "and the offline rules fallback; <b>the human gate</b> at `/gov/gate`; "
            "<b>the SLA engine</b> with the four ladders (WIDEN, OPEN_ALL, BREACH, "
            "GRAND_CHALLENGE) and the reaper driven by both Vercel Cron and the "
            "`/demo` console; <b>the provenance ledger</b> (append-only by trigger, "
            "SHA-256 hash chain, in-browser verification at `/ledger`); <b>the "
            "credit + trust system</b> with the merge-as-signal invariants and the "
            "v1.1.0 trust-weighted corroboration; <b>Emergency Mode</b> at "
            "`/gov/emergency` (reversible half-time compression, bounded ×1.25 "
            "display surge, `ANNUAL_REVIEW` exempt); <b>the public pages</b> "
            "(`/challenges`, `/c/[id]`, `/stats`, `/ledger`, `/bounties`, "
            "`/artifacts/[id]`, `/flagged`, `/credit/[userId]`, `/track`); "
            "<b>the §135 CSR export</b> at `/industry/csr` and the MoU generator; "
            "and <b>the offline story</b> — Postgres + MinIO + Mailpit, every AI "
            "stage at fallback level 2, 53 of 53 model calls answered offline in "
            "the last rehearsed run. <b>Declared stubs</b> (on a slide on purpose): "
            "IVR + WhatsApp Business intake (the seam is `/api/intake`, not built); "
            "SMS + WhatsApp delivery (mock inboxes, DLT registration needed for "
            "real); offline PWA sync (localStorage drafts stand in); fine-tuned "
            "models (no labelled data, no GPU budget — few-shot + embedding kNN "
            "prior instead); full ten-language coverage (Hindi, English, one "
            "Santhali sample); live CPGRAMS / JharSewa write API (the exact payload "
            "is rendered instead); self-serve institutional onboarding; e-signature "
            "and payment rails (the MoU is generated and hashed, never signed); "
            "patent/DOI integration and an IP dispute adjudication UI (the prior-art "
            "panel is what exists); automatic face / number-plate detection "
            "(citizen-driven blur is a stronger privacy claim, and the unblurred "
            "original never leaves the device); a separate live emergency response "
            "queue and automatic surge-routing (the compression + display surge "
            "are built; the rest is not); a PMTiles basemap (markers draw on a "
            "blank canvas and say so); block-level boundary geometry (districts are "
            "polygon-resolved against real Jharkhand boundaries; blocks remain "
            "nearest-centroid within the resolved district). The rule: every stub "
            "is named in a slide, not hidden in a footnote."
        ),
        (
            "26. Can you show us a live challenge being submitted and routed right now?",
            "Yes. From `/demo`, six minutes, no terminal. Sign in as "
            "`admin@milan.demo.milan.in` in one tab, sign in as "
            "`dc.gumla@jh.gov.demo.milan.in` in a second browser profile. The hero "
            "challenge, `JH-2026-GUM-0001`, is already in (Sunita Devi's report of "
            "the South Koel embankment crack near Basia, in Hindi), and `/demo` "
            "has six buttons that drive it through the real production server "
            "actions — never shortcuts. Beat by beat: <b>0:00</b> landing page, "
            "then `/demo` health strip, ledger head hash, open deadline count. "
            "<b>0:30</b> `/submit` wizard, six steps, photo step saying plainly "
            "that faces are not blurred automatically. <b>1:00</b> `/demo` → "
            "<b>Run the pipeline</b> (~8 s live) — P0, S1, S2, S3, S4, S5, with "
            "every receipt visible. <b>1:30</b> `/c/JH-2026-GUM-0001` — open the "
            "priority breakdown, point at the arithmetic, every number is "
            "clickable. <b>2:30</b> DC tab, `/gov/gate` — the proposal is there, "
            "the shortlist is marked \"not notified — held at this gate\". Back on "
            "`/demo`, press <b>DC confirms the gate</b> and <b>HOD claims it</b>. "
            "<b>3:15</b> `/demo` → <b>Publish the artifact</b>, open the artifact "
            "page, point at the SHA-256 ledgered into the chain. <b>4:15</b> "
            "`/demo` → <b>+21 days</b> — the reaper runs, the log fills, and the "
            "challenge hits the public `/bounties` board. <b>5:00</b> `/ledger` → "
            "<b>Verify chain</b> — green. Expand an entry, recompute the hash in "
            "the browser, no upload. <b>5:20</b> `/demo` → <b>Mark implemented</b>, "
            "read Sunita's SMS aloud, then <b>Citizen confirms</b> — the impact "
            "counter moves. <b>5:50</b> `/industry/csr` — the three separate "
            "blocks, the two beneficiary totals that are never summed, the close. "
            "If anything goes wrong, `/demo` → <b>Reset</b> restores the demo "
            "state in about a second."
        ),
        (
            "27. Why should we believe the AI pipeline is real and not hardcoded for "
            "the demo?",
            "Three independent proofs. <b>Proof 1 — the receipts.</b> Every model "
            "call — success, failure, cached, offline — writes a row to `ai_runs` "
            "with its provider, model, fallback level, confidence, latency and "
            "input hash. A cache hit still writes a row with `provider: \"cache\"` "
            "so the trace never overstates what actually ran. `/admin/ai-runs` is "
            "the full audit log, with p50/p95 per stage. <b>Proof 2 — the "
            "verifier.</b> `/ledger` → <b>Verify chain</b> runs the same hash-chain "
            "verification in the browser, recomputing every link from genesis. If "
            "anything in the demo were hardcoded, the chain would not verify. It "
            "verifies — try changing a byte in any entry and re-running it. "
            "<b>Proof 3 — the offline run.</b> The offline rehearsal goes through "
            "the full pipeline with `AI_PROVIDER_CHAIN=rules` and the wifi off. "
            "The last rehearsed run: 53 of 53 model calls answered at fallback "
            "level 2 (deterministic rules), 4/4 containers healthy, all 13 demo "
            "beats passing, no call to Gemini, Groq, Supabase or Resend. The "
            "offline run is the strongest possible proof that the pipeline is "
            "real: a hardcoded demo would not need a rules fallback, and an "
            "AI-wrapper would not be able to run with the wifi off. Finally, the "
            "code is the documentation: every stage is in `lib/ai/pipeline.ts`, "
            "every receipt in `ai_runs`, and `/admin/triage` is the live queue "
            "where the model hands off to a human at confidence &lt; 0.60 — not a "
            "demo feature, a production invariant."
        ),
        (
            "28. The provenance ledger sounds complex. How does it actually work in "
            "the demo?",
            "It is one table, one trigger, and one hash function. <b>The table</b> "
            "is `ledger_entries`: `(seq, content_hash, prev_hash, entry_hash, "
            "kind, payload, author_id, created_at)`. <b>The trigger</b> is in "
            "migration 0002 — a Postgres trigger that `RAISES` on any UPDATE or "
            "DELETE on the table. Append-only is enforced at the database level, "
            "not by application convention. <b>The hash function</b> is "
            "`lib/ledger/hash.ts`, pure, runs identically in the browser and on "
            "the server. `canonicalJson()` sorts object keys at every level, drops "
            "undefined/function values, serialises dates as ISO-8601 — so any "
            "third party can recompute a hash and get the same answer. "
            "`entryHash = sha256(canonical({seq, contentHash, prevHash, authorId, "
            "createdAt}))`. Changing any earlier payload changes its content hash, "
            "which changes its entry hash, which is the next entry's `prevHash` — "
            "verification fails from the tampered entry onward and names its "
            "`seq`. <b>Appending</b> (`lib/ledger/append.ts`) runs inside the "
            "caller's transaction (a state change, its ledger entry, its SLA "
            "deadlines and its outbox event are one atomic fact) and takes a "
            "Postgres advisory transaction lock first, so two concurrent appends "
            "cannot both read the same tip and fork the chain. In the demo: "
            "`/ledger` shows the chain paginated, with a <b>Verify chain</b> "
            "button that walks it from genesis and checks every link. Expand an "
            "entry to see the payload and the file-hash calculator — your browser "
            "computes the hash, nothing is uploaded. The proof: try tampering with "
            "any entry and re-running the verifier — it comes back red and names "
            "the sequence number. A verifier that can go red is the only kind "
            "worth having."
        ),
    ]),
]


# ---------- Five memorisable sentences ----------
MEMORABLE = [
    "Disaster management is mostly mitigation. We are a mitigation pipeline that runs in peacetime, "
    "and every challenge carries an explicit hazard linkage.",

    "CPGRAMS routes complaints to officers. We route unsolved problems to labs, with a clock. "
    "When something is a grievance, we forward it to CPGRAMS.",

    "Discovery is never luck. Every problem is pushed to matched departments, and every state has "
    "an SLA with an automatic escalation.",

    "Universities are not doing us a favour — 200,000 Indian students invent a fake final-year "
    "project every year. We give them real ones.",

    "We do not stop people from sharing work. We make it impossible to erase who did it.",
]


# ---------- Build the document ----------
def build():
    doc = SimpleDocTemplate(
        OUT, pagesize=A4,
        leftMargin=2.0 * cm, rightMargin=2.0 * cm,
        topMargin=2.1 * cm, bottomMargin=1.8 * cm,
        title="Milan — Application Q&A",
        author="Milan · SIH 2026 · SIH26043",
        subject="Judge Q&A response — Government of Jharkhand, Disaster Management",
    )

    story = []

    # Cover
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph("Milan", H_TITLE))
    story.append(Paragraph(
        "Application Q&amp;A — 28 judge questions, answered from the code.",
        H_SUB,
    ))

    cover_meta = [
        ["Problem statement", "SIH26043 — Government of Jharkhand, Disaster Management (Software)"],
        ["Edition", "Smart India Hackathon 2026"],
        ["One-line pitch",
         "Converts a citizen's verified local problem into a time-bound, routed research "
         "assignment for a university team, with a hash-chained credit ledger and an SLA clock."],
        ["Stack (one cut)",
         "Next.js 15 + React 19 · Tailwind v4 + shadcn/ui · Drizzle + Zod · "
         "Supabase Postgres 17 (pgvector HNSW) · Better Auth · Gemini → Groq → rules · SSE."],
        ["What is not here",
         "No blockchain. No separate vector DB. No Kafka. No fine-tuned models. No anonymous read."],
        ["Demo at", "/demo — health strip, six-button console, real production server actions, no terminal."],
    ]
    t = Table(cover_meta, colWidths=[4.2 * cm, 11.8 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), PILL_BG),
        ("TEXTCOLOR", (0, 0), (0, -1), TEAL),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.7 * cm))

    # The five sentences
    story.append(Paragraph("The five sentences to memorise", H_SECTION))
    for i, s in enumerate(MEMORABLE, 1):
        story.append(Paragraph(f"<b>{i}.</b> {s}", BODY))
    story.append(Spacer(1, 0.4 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceBefore=2, spaceAfter=8))
    story.append(PageBreak())

    # Q&A sections
    for section_title, items in QA:
        story.append(Paragraph(section_title, H_SECTION))
        story.append(Spacer(1, 0.15 * cm))
        for q, a in items:
            block = [
                Paragraph(f"Q. {q}", H_Q),
                Paragraph("A.", H_A),
                Paragraph(a, BODY),
            ]
            story.append(KeepTogether(block))
            story.append(HRFlowable(width="100%", thickness=0.3, color=LINE,
                                     spaceBefore=4, spaceAfter=6))

    doc.build(story, onFirstPage=page_decoration, onLaterPages=page_decoration)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
