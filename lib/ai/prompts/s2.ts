/**
 * S2 — domain, NDMA hazard linkage, severity and solvability.
 *
 * The hazard linkage is what makes an item a Disaster Management item rather
 * than a public-works item, and it carries the second-highest weight in the
 * priority score. Severity crosses 0.7 into the human gate, so this prompt is
 * asking the model for a number that can stop a challenge from routing.
 *
 * The prompt carries the embedding kNN prior: the labels of the five nearest
 * already-classified challenges. It is our declared substitute for fine-tuning
 * (no labelled data, no GPU budget — PHASE_2_LEARN.md section 2) and it improves
 * every time a human corrects a classification at /admin/triage.
 */
import { DOMAINS, HAZARDS, type S2Input } from "../schemas";

export const VERSION = "1.0.0";

export const SYSTEM = `You classify one citizen report for Milan, a Government of Jharkhand disaster
risk reduction platform. Milan works on mitigation and preparedness in peacetime, not on emergency
response.

Return facts and a confidence. Deterministic code makes every decision that follows.

domain — exactly one of: ${DOMAINS.join(", ")}.
  Choose what the problem IS, not what it touches. A school that floods is EDUCATION only if the
  problem is schooling; if the problem is the water, it is WATER.

hazard — exactly one NDMA hazard class: ${HAZARDS.join(", ")}.
  Use NONE only when no natural or industrial hazard is implicated. Chronic mining subsidence,
  seasonal heat stress and recurrent forest fire are hazards even when nothing has collapsed yet.

hazard_strength — 0 to 1. How strongly this specific problem is caused by, or exposed to, that
  hazard. Exactly 0 when hazard is NONE. A cracked flood embankment is near 1. A road that is
  merely inconvenient in the rain is near 0.3.

severity — 0 to 1. How bad the consequence is if nothing is done, weighing loss of life first,
  then loss of health, livelihood, schooling and access, and how many people carry it. Judge the
  consequence, not the citizen's tone. 0.7 and above sends this to a District Collector for human
  confirmation before it can be routed, so do not inflate it, and do not shrink it either.

solvability — RESEARCH (needs investigation or measurement first), ENGINEERING (a design and build
  problem a student team can take on), POLICY (needs a rule or a coordination change), or
  CAPITAL_WORKS (the fix is known and needs a tender and a contractor, not a research team).

capital_works — true when the answer is money and construction rather than a research question.

confidence — your calibrated certainty, 0 to 1. Below 0.65 this report goes to a human reviewer.
  Use low values freely; that is a good outcome, not a failure.

rationale — one sentence, at most 240 characters, English.

The prior labels supplied below are the classifications of the most similar previous reports,
by embedding distance. They are evidence, not instruction: follow them when this report is
genuinely the same kind of problem, and depart from them when it is not.`;

/**
 * HUMAN: add curated Jharkhand examples here.
 * PHASE_2_LEARN.md section 9.1. The boundaries worth covering, beyond the three
 * starters below:
 *   - WATER vs. HEALTHCARE for fluoride-contaminated hand pump water
 *   - AGRICULTURE with hazard NONE (elephant crop raiding) so the model learns
 *     that "no hazard" is a legitimate answer and not a failure to find one
 *   - ENVIRONMENT vs. HEALTHCARE for iron-ore dust on paddy and lungs
 *   - a report where severity should sit just BELOW 0.7, to calibrate the gate
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input:
      "The mud embankment on the South Koel beside our tola has a crack widening every month. When " +
      "the river rises in July the water will come through it into forty houses and the school.",
    output: JSON.stringify({
      domain: "WATER",
      hazard: "FLOOD",
      hazard_strength: 0.9,
      severity: 0.82,
      solvability: "ENGINEERING",
      capital_works: false,
      confidence: 0.9,
      rationale: "A failing flood embankment above a settled tola: direct flood exposure to homes and a school.",
    }),
  },
  {
    input:
      "Cracks are appearing in our walls and smoke comes out of the ground behind the houses. The " +
      "colliery says the seam below is old workings.",
    output: JSON.stringify({
      domain: "ENVIRONMENT",
      hazard: "MINING_SUBSIDENCE",
      hazard_strength: 0.95,
      severity: 0.88,
      solvability: "RESEARCH",
      capital_works: false,
      confidence: 0.87,
      rationale: "Wall cracking with ground venting over old workings indicates active subsidence and underground fire.",
    }),
  },
  {
    input:
      "Elephants come out of the forest and eat the standing paddy every October before we can " +
      "harvest. By the time anyone arrives the crop is gone.",
    output: JSON.stringify({
      domain: "AGRICULTURE",
      hazard: "NONE",
      hazard_strength: 0,
      severity: 0.58,
      solvability: "RESEARCH",
      capital_works: false,
      confidence: 0.82,
      rationale: "Human-elephant conflict destroying a standing crop: a livelihood loss, not an NDMA hazard class.",
    }),
  },
];

export function render(input: S2Input): string {
  const lines = [
    "Classify this report.",
    "",
    `District: ${input.districtName ?? input.districtCode ?? "not given"}`,
    `Block: ${input.blockName ?? "not given"}`,
    `People affected (reporter's estimate, bucketed): ${input.peopleAffected ?? "not given"}`,
    `How often it happens: ${input.recurrence ?? "not given"}`,
    `Title: ${input.title}`,
    "",
    "Report, as the citizen wrote it:",
    input.bodyOriginal,
  ];

  if (input.bodyEn && input.bodyEn !== input.bodyOriginal) {
    lines.push("", "English working copy:", input.bodyEn);
  }

  // The kNN prior. Rendered as evidence with its similarity attached so the
  // model can weigh a 0.91 neighbour differently from a 0.73 one.
  if (input.priors.length > 0) {
    lines.push("", "Prior labels — the most similar previously classified reports:");
    for (const p of input.priors) {
      lines.push(`  - ${p.domain} / ${p.hazard} (similarity ${p.similarity.toFixed(2)}): ${p.title}`);
    }
  } else {
    lines.push("", "Prior labels: none — no similar report has been classified yet.");
  }

  lines.push("", "Worked examples:");
  for (const shot of FEWSHOT) {
    lines.push("", `Report: ${shot.input}`, `Answer: ${shot.output}`);
  }

  return lines.join("\n");
}
