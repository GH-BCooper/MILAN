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

export const VERSION = "1.0.0";

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

2. is_grievance — true when the problem has a KNOWN fix and an accountable officer, and what is
   missing is delivery, money or enforcement. Sanctioned work not done, an asset installed but not
   working, a pension or ration entitlement withheld, a bribe demanded. These belong to CPGRAMS or
   JharSewa and Milan forwards them.
   is_grievance is FALSE when nobody knows what the fix is — when the problem needs investigation,
   measurement, design or new engineering. That is Milan's own work.
   A report can describe official inaction AND still be a research problem: "we told the mukhiya
   twice and nobody came" about a cracking embankment is a research problem, because no officer
   has a ready answer for a cracking embankment. Weigh what would solve it, not who was told.
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
      "The mud embankment on the South Koel river beside our tola has a crack that started after " +
      "last monsoon. It was one hand wide in October, now I can put my whole arm in it. Nobody " +
      "from the block has come to see it even after we told the mukhiya twice.",
    output: JSON.stringify({
      is_unsafe: false,
      unsafe_category: null,
      is_grievance: false,
      grievance_target: null,
      confidence: 0.88,
      rationale:
        "A widening embankment crack needs survey and design work; official inaction does not make it a grievance.",
    }),
  },
  {
    input:
      "The PMGSY road to our village was sanctioned in 2022 and the board is still standing at the " +
      "turning, but not one metre has been laid. The contractor came once with a machine and left.",
    output: JSON.stringify({
      is_unsafe: false,
      unsafe_category: null,
      is_grievance: true,
      grievance_target: "CPGRAMS",
      confidence: 0.92,
      rationale: "Sanctioned scheme not delivered: a known fix with an accountable officer, not a research problem.",
    }),
  },
  {
    input:
      "Jal Jeevan Mission taps were fitted in every house in 2024 but not one day of water has come " +
      "through them. The overhead tank was built but the pump was never connected.",
    output: JSON.stringify({
      is_unsafe: false,
      unsafe_category: null,
      is_grievance: true,
      grievance_target: "CPGRAMS",
      confidence: 0.9,
      rationale: "Assets installed under a scheme but not commissioned: delivery failure, forwarded to the scheme owner.",
    }),
  },
];

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
