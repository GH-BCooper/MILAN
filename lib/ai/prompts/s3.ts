/**
 * S3 — duplicate adjudication, for the ambiguous cosine band only.
 *
 * Above 0.86 the code merges without asking. Below 0.72 the code keeps them
 * apart without asking. The model is consulted only in between, which is what
 * keeps clustering cheap, fast and mostly deterministic.
 *
 * The asymmetry stated in the system prompt is deliberate: invariant 9 says
 * duplicates are signal, not noise. An over-eager merge buries a second
 * reporter's distinct problem inside someone else's; an under-eager one leaves
 * a duplicate for a human to spot. We take the second failure.
 */
import type { S3AdjudicateInput } from "../schemas";

export const VERSION = "1.0.0";

export const SYSTEM = `You compare two citizen reports from Jharkhand and decide whether they
describe THE SAME physical problem at THE SAME place — not merely the same kind of problem.

Same problem: the same embankment, the same hand pump, the same stretch of road, the same school.
Different problems: two different wells in the same block; flooding of two different colonies;
the same hazard affecting two separate hamlets.

Two reports can be the same problem even when they are in different languages, use different
landmarks, or give different numbers — citizens estimate differently.

When you are unsure, answer false. Merging two different problems erases the second reporter's
report; leaving a duplicate merely leaves work for a human. Those costs are not equal.

Return same_problem, a calibrated confidence 0 to 1, and one sentence of rationale in English,
at most 240 characters, naming the shared or differing landmark that decided it.`;

/**
 * HUMAN: add curated Jharkhand examples here.
 * The three planted near-duplicates in `seed-data/challenges.csv` (the Basia
 * embankment, rows 1-3) and the two genuinely different water challenges
 * (Garhwa drought wells, Chandil dam flooding) are the calibration set. Worth
 * adding: a Hindi/English pair of the same problem, and two different hand
 * pumps in the same village, which is the hardest negative in the set.
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input:
      "A: Crack spreading along the South Koel embankment near Basia, beside the culvert.\n" +
      "B: The Koel river bund near the Basia culvert is splitting and water seeps through in rains.",
    output: JSON.stringify({
      same_problem: true,
      confidence: 0.93,
      rationale: "Both name the same structure at the same landmark: the Koel embankment beside the Basia culvert.",
    }),
  },
  {
    input:
      "A: All the wells in our village have dried and the women walk three kilometres for water.\n" +
      "B: Chandil dam water enters the village every monsoon and stands in the houses for weeks.",
    output: JSON.stringify({
      same_problem: false,
      confidence: 0.96,
      rationale: "One is groundwater failure in a drought block, the other is reservoir flooding: different problems entirely.",
    }),
  },
  {
    input:
      "A: The hand pump near the anganwadi gives brown water and the children's teeth are stained.\n" +
      "B: The hand pump at the far tola stopped working last month and has not been repaired.",
    output: JSON.stringify({
      same_problem: false,
      confidence: 0.85,
      rationale: "Two different hand pumps in the same village, and two different failures: contamination versus breakdown.",
    }),
  },
];

export function render(input: S3AdjudicateInput): string {
  const lines = [
    `These two reports have an embedding cosine similarity of ${input.similarity.toFixed(3)}, which`,
    "falls in the ambiguous band. Decide whether they are the same physical problem.",
    "",
    `Report A (${input.a.trackingId}, block ${input.a.block ?? "unknown"})`,
    `Title: ${input.a.title}`,
    input.a.body,
    "",
    `Report B (${input.b.trackingId}, block ${input.b.block ?? "unknown"})`,
    `Title: ${input.b.title}`,
    input.b.body,
    "",
    "Worked examples:",
  ];
  for (const shot of FEWSHOT) {
    lines.push("", shot.input, `Answer: ${shot.output}`);
  }
  return lines.join("\n");
}
