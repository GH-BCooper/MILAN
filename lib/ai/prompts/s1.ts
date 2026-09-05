/**
 * S1 — safety and grievance triage. The single most important classifier.
 *
 * It decides three things and decides none of them alone: it returns facts and
 * a confidence, and `lib/ai/stages/s1.ts` applies the thresholds. Getting this
 * wrong in the unsafe direction publishes something that hurts someone. Getting
 * it wrong in the grievance direction sends a solvable complaint to a lab, or
 * sends a research problem to an officer who has no mandate to solve it.
 *
 * Bump VERSION when SYSTEM, FEWSHOT or render() changes: it is part of the
 * cache key, so an unbumped edit would keep serving the old answer.
 */
import type { S1Input } from "../schemas";

export const VERSION = "1.3.0";
// 1.3.0 — same eight boundaries, roughly half the tokens. Measured, this prompt
// was 2,131 tokens against Groq's 8,000-per-minute ceiling, which made a batch
// backfill impossible and put avoidable prefill latency on the live demo path.
// Every example was cut to the sentence that actually teaches the boundary.
// 1.2.0 — the same run also forwarded the Medininagar heat-stress report and the
// Littipara dry-toilet report, both of which end by asking for a method that does
// not exist ("how would we know in advance when the heat will be lethal", "we need
// a toilet that works with the little water we have"). The rule was already in the
// system prompt; it needed to be the FIRST test rather than a caveat, and it needed
// examples. Two added below.
// 1.1.0 — the first `pipeline:run --all` forwarded two research problems as
// grievances: the Dhalbhumgarh elephant raids ("compensation comes after a year")
// and the Garu forest fires ("forest guard says he has no people"). Both mention
// an unhelpful official, and the model read that as the whole report. Fixed with
// two few-shot examples and one sharpened line below, per PHASE_2_LEARN 9.2 —
// the fix for a misclassification is an example, never a hard-coded id.

export const SYSTEM = `You are the intake triage classifier for Milan, a Government of Jharkhand
platform that turns citizens' local problems into research assignments for university teams.

You classify one report. You do not decide what happens to it — you return facts and a confidence,
and deterministic code makes every decision. Report what is in the text, not what you infer might
be true.

Decide two things.

1. is_unsafe — true ONLY when the text contains a threat of violence, a statement of intent to
   self-harm, a report of sexual violence, a child-safety emergency, or targeted harassment of a
   named person. A report of a dangerous SITUATION (a cracked embankment, subsidence under houses,
   workers fainting in the heat) is NOT unsafe: that is exactly the work Milan exists for. Set
   unsafe_category to one of SELF_HARM, VIOLENCE_THREAT, SEXUAL_VIOLENCE, CHILD_SAFETY,
   TARGETED_HARASSMENT, or null.

2. is_grievance — apply this test FIRST, before anything else in this section:
   if the report asks for a WAY to do something, says the writer wants to KNOW something, or
   describes something nobody has a working method for, is_grievance is FALSE. Stop there. It does
   not matter how much of the paragraph is complaint.

   Otherwise: is_grievance is true when the problem has a KNOWN fix and an accountable officer, and what is
   missing is delivery, money or enforcement. Sanctioned work not done, an asset installed but not
   working, a pension or ration entitlement withheld, a bribe demanded. These belong to CPGRAMS or
   JharSewa and Milan forwards them.
   is_grievance is FALSE when nobody knows what the fix is — when the problem needs investigation,
   measurement, design or new engineering. That is Milan's own work.
   A report can describe official inaction AND still be a research problem: "we told the mukhiya
   twice and nobody came" about a cracking embankment is a research problem, because no officer
   has a ready answer for a cracking embankment. Weigh what would solve it, not who was told.
   Mentioning an absent officer, a slow compensation payment, or an under-staffed department does
   NOT make a report a grievance. Ask one question: if the responsible officer did their job
   perfectly tomorrow, would the problem be solved? If yes, it is a grievance. If the officer has
   no method that would work — nobody knows how to keep an elephant herd out of a field, or where
   a forest fire will start — it is Milan's work, however loudly the report complains.
   When a citizen asks for a WAY to do something, or says they want to KNOW something, that is a
   research problem regardless of everything else in the paragraph.
   Set grievance_target to CPGRAMS or JharSewa when is_grievance is true, otherwise null.

confidence is your own calibrated certainty in the pair of judgements, 0 to 1. Be honest and use
low values freely: a low confidence sends the item to a human reviewer, which is a good outcome.

rationale is one sentence, at most 240 characters, in English, quoting the phrase that decided it.

Reports arrive in Hindi, Santali, Nagpuri or English. Judge the original text.`;

/**
 * Few-shot examples covering the boundaries that actually matter here.
 *
 * HUMAN: add curated Jharkhand examples here.
 * PHASE_2_LEARN.md section 9.1 — 6 to 10 per stage, drawn from your own seed
 * challenges, covering the boundary cases. This is the single highest-leverage
 * hour in the whole build and it is a human judgement task, not a Claude one.
 * Three starters are below; the boundaries still uncovered are:
 *   - a Santali report (seed row 13) so the model sees the script
 *   - a report that mixes a grievance AND a research problem in one paragraph
 *   - a heat-stress report, which reads like a complaint but needs design work
 *   - a report naming an individual, to check TARGETED_HARASSMENT is not
 *     triggered by ordinary criticism of an office
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input:
      "The mud embankment on the South Koel has a crack that has widened since last monsoon. " +
      "Nobody from the block has come, even after we told the mukhiya twice.",
    output: shot(false, false, 0.88, "A widening embankment crack needs survey and design; official inaction does not make it a grievance."),
  },
  {
    input: "The PMGSY road was sanctioned in 2022 and not one metre has been laid.",
    output: shot(true, false, 0.92, "Sanctioned scheme not delivered: a known fix with an accountable officer.", "CPGRAMS"),
  },
  {
    input:
      "Jal Jeevan Mission taps were fitted in every house in 2024 but no water has ever come through them. " +
      "The tank was built and the pump was never connected.",
    output: shot(true, false, 0.9, "Assets installed under a scheme but never commissioned: a delivery failure.", "CPGRAMS"),
  },
  {
    input:
      "Elephants take our paddy every October. Compensation comes after a year and is small, and the forest " +
      "department arrives in the morning. We need a way to know the herd is coming that evening.",
    output: shot(false, false, 0.86, "They ask for a way to detect and deter a herd; no officer has a working method, so the slow compensation is context."),
  },
  {
    input:
      "Fire comes through the sal forest every March and burns our mahua and lac. The forest guard says he has " +
      "no people. We want to know where the fire will come from and how to stop it.",
    output: shot(false, false, 0.87, "They want fire prediction and prevention, which nobody has; an understaffed guard post is not a delivery failure."),
  },
  {
    input:
      "Two labourers collapsed at the pond-digging site this May and one died. There is no shade and no ORS. " +
      "Somebody should decide how we can know in advance when the heat will be lethal.",
    output: shot(false, false, 0.85, "They ask how lethal heat could be predicted and hours changed: research, not delivery."),
  },
  {
    input:
      "Every house got a toilet under the mission in 2019, but there is no water from February to June so " +
      "nobody uses them. We need a toilet that works with the little water we have.",
    output: shot(false, false, 0.83, "The scheme delivered the asset; what is missing is a low-water sanitation design, which is what they ask for."),
  },
  {
    input:
      "The anganwadi building was sanctioned two years ago and never built. Also the ground floods after every " +
      "rain and nobody knows why, because the water comes up rather than down.",
    output: shot(true, false, 0.68, "Two problems in one report: an undelivered building and unexplained groundwater. Low confidence sends it to a human to split.", "CPGRAMS"),
  },
];

/** Compact worked-example output. Keeping these terse matters: eight verbose
 *  examples cost more prompt tokens than the report being classified. */
function shot(
  grievance: boolean,
  unsafe: boolean,
  confidence: number,
  rationale: string,
  target: string | null = null,
): string {
  return JSON.stringify({
    is_unsafe: unsafe,
    unsafe_category: null,
    is_grievance: grievance,
    grievance_target: target,
    confidence,
    rationale,
  });
}

export function render(input: S1Input): string {
  const lines = [
    "Classify this report.",
    "",
    `District code: ${input.districtCode ?? "not given"}`,
    `Title: ${input.title}`,
    "",
    "Report, as the citizen wrote it:",
    input.bodyOriginal,
  ];

  if (input.bodyEn && input.bodyEn !== input.bodyOriginal) {
    lines.push("", "English working copy (a translation; the original above is the record):", input.bodyEn);
  }

  lines.push("", "Worked examples:");
  for (const shot of FEWSHOT) {
    lines.push("", `Report: ${shot.input}`, `Answer: ${shot.output}`);
  }

  return lines.join("\n");
}
