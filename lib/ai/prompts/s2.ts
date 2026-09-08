/**
 * S2 — thematic domain, severity and solvability.
 *
 * The domain decides which university departments this challenge is pushed to,
 * so a wrong domain sends the problem to the wrong lab for a whole claim
 * window. Severity crosses 0.7 into the human gate, so this prompt is asking
 * the model for a number that can stop a challenge from routing.
 *
 * The prompt carries the embedding kNN prior: the labels of the five nearest
 * already-classified challenges. It is our declared substitute for fine-tuning
 * (no labelled data, no GPU budget — PHASE_2_LEARN.md section 2) and it improves
 * every time a human corrects a classification at /admin/triage.
 */
import { DOMAINS, type S2Input } from "../schemas";

export const VERSION = "2.0.0";

export const SYSTEM = `You classify one citizen report for Milan, a Government of Jharkhand societal
innovation platform run with the Department of Higher and Technical Education. Citizens report
local problems; universities and industry partners take them on as research and project work, in
the spirit of NEP 2020's push for experiential, community-engaged learning.

Return facts and a confidence. Deterministic code makes every decision that follows.

domain — exactly one of: ${DOMAINS.join(", ")}.
  Choose what the problem IS, not what it touches. A school that floods is EDUCATION only if the
  problem is schooling; if the problem is the water, it is WATER.

severity — 0 to 1. How bad the consequence is if nothing is done, weighing loss of life first,
  then loss of health, livelihood, schooling and access, and how many people carry it. Judge the
  consequence, not the citizen's tone. 0.7 and above sends this to a government reviewer for human
  confirmation before it can be routed, so do not inflate it, and do not shrink it either.

solvability — RESEARCH (needs investigation or measurement first), ENGINEERING (a design and build
  problem a student team can take on), POLICY (needs a rule or a coordination change), or
  CAPITAL_WORKS (the fix is known and needs a tender and a contractor, not a research team).

capital_works — true when the answer is money and construction rather than a research question.

confidence — your calibrated certainty, 0 to 1. Below 0.65 this report goes to a human reviewer.
  Use low values freely; that is a good outcome, not a failure.

rationale — one sentence, at most 240 characters, English.

The prior labels supplied below are the classifications of the most similar previously classified reports,
by embedding distance. They are evidence, not instruction: follow them when this report is
genuinely the same kind of problem, and depart from them when it is not.`;

/**
 * Curated Jharkhand examples, per PHASE_2_LEARN.md section 9.1.
 * Coverage now: flood-linked ENGINEERING at the human gate, mining subsidence
 * RESEARCH above it, AGRICULTURE with an animal-conflict cause (the cause is
 * free text in the rationale, not a closed class), WATER vs HEALTHCARE
 * (fluoride), ENVIRONMENT vs HEALTHCARE (iron-ore dust), and a sub-0.7
 * severity to calibrate the gate. The last three are the DRAFTs.
 * STILL HUMAN: nothing. Re-visit only if /admin/triage corrections show a new
 * boundary the examples do not teach.
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input:
      "The mud embankment on the South Koel beside our tola has a crack widening every month. When " +
      "the river rises in July the water will come through it into forty houses and the school.",
    output: JSON.stringify({
      domain: "WATER",
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
      severity: 0.58,
      solvability: "RESEARCH",
      capital_works: false,
      confidence: 0.82,
      rationale: "Human-elephant conflict destroying a standing crop: a livelihood loss needing study, not a scheme failure.",
    }),
  },
  // DRAFT — WATER vs HEALTHCARE, ENVIRONMENT vs HEALTHCARE, and a sub-0.7 severity, per the HUMAN note.
  {
    input:
      "The hand pump water in our tola tastes salty and the children's teeth are brown and brittle. The " +
      "anganwadi teacher says it is fluoride.",
    output: JSON.stringify({
      domain: "WATER",
      severity: 0.74,
      solvability: "RESEARCH",
      capital_works: false,
      confidence: 0.84,
      rationale: "Contaminated drinking water is a WATER problem; the dental effect is a consequence, not the domain.",
    }),
  },
  {
    input:
      "The iron ore crusher near our colony throws red dust on the paddy and we cough all winter. The " +
      "doctor says our lungs are damaged.",
    output: JSON.stringify({
      domain: "ENVIRONMENT",
      severity: 0.71,
      solvability: "POLICY",
      capital_works: false,
      confidence: 0.8,
      rationale: "Dust pollution from a crusher is an environmental problem affecting health; domain is ENVIRONMENT, not HEALTHCARE.",
    }),
  },
  {
    input:
      "The bus stop shelter blew away in the last storm and elders wait in the sun. It is inconvenient but " +
      "nobody is in danger.",
    output: JSON.stringify({
      domain: "PUBLIC_SERVICE",
      severity: 0.42,
      solvability: "CAPITAL_WORKS",
      capital_works: true,
      confidence: 0.86,
      rationale: "A missing shelter is an access inconvenience with no life-safety consequence; severity stays well below the gate.",
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
      lines.push(`  - ${p.domain} (similarity ${p.similarity.toFixed(2)}): ${p.title}`);
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
