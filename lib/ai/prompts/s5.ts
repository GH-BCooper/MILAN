/**
 * S5 — the routing reason sentence.
 *
 * CLAUDE.md invariant 4: the AI never invents a routing reason. The model is
 * handed the top three contributing terms (weight x value) computed in plain
 * TypeScript, plus three names, and it writes the sentence around them. It is
 * given no challenge text, no institution facts, no distances it did not
 * receive, and no capacity numbers it did not receive.
 *
 * The instruction below is not the guarantee. The guarantee is the numeric
 * check in `lib/ai/stages/s5.ts`, which rejects any output containing a number
 * that is not present in the input terms and falls back to the template.
 * Say it that way in Q&A: a structural guarantee, not a prompt request.
 */
import type { S5ReasonInput } from "../schemas";

export const VERSION = "1.0.0";

export const SYSTEM = `You write one sentence explaining why a citizen's problem was routed to a
particular university department.

You will be given: an institution name, a department, sometimes a laboratory name, and exactly
three scoring factors that caused the match.

Rules, absolutely:
- Use ONLY the facts supplied. Do not add context, history, reputation, rankings, or any claim
  about the institution that is not in the input.
- Do not state any number that is not in the supplied factors. No distances, no counts, no
  percentages, no years of your own.
- Do not describe the problem itself. You have not been shown it.
- One sentence. Between 30 and 300 characters. Plain English, no marketing language,
  no exclamation marks.
- Begin with "Matched to " followed by the institution and department.

Return the sentence and a calibrated confidence 0 to 1 that it is faithful to the supplied facts.`;

/**
 * HUMAN: add curated Jharkhand examples here.
 * These three cover the shapes the score actually produces. Worth adding once
 * the seed capabilities settle: a match driven mostly by distance (a nearby
 * polytechnic), and one where capacity is the third term rather than the first,
 * so the model does not learn to always lead on specialisation.
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input: JSON.stringify({
      institution: "BIT Sindri",
      department: "Civil Engineering",
      lab: "Hydraulics and Water Resources Laboratory",
      terms: [
        { label: "Specialisation overlap", detail: "lab tags cover embankment, flood and river-training work", contribution: 0.19 },
        { label: "Semantic fit", detail: "strong match between the report and the lab's declared work", contribution: 0.31 },
        { label: "Declared capacity", detail: "3 capstone team slots open in the current window", contribution: 0.12 },
      ],
    }),
    output: JSON.stringify({
      reason:
        "Matched to BIT Sindri, Civil Engineering — Hydraulics and Water Resources Laboratory: a strong semantic match to the lab's declared work, tags covering embankment, flood and river-training, and 3 capstone team slots open in the current window.",
      confidence: 0.93,
    }),
  },
  {
    input: JSON.stringify({
      institution: "Central University of Jharkhand",
      department: "Environmental Sciences",
      lab: null,
      terms: [
        { label: "Semantic fit", detail: "close match to the department's declared environmental monitoring work", contribution: 0.28 },
        { label: "Distance", detail: "62 km from the reported location", contribution: 0.11 },
        { label: "Track record", detail: "previous delivered work in this domain", contribution: 0.06 },
      ],
    }),
    output: JSON.stringify({
      reason:
        "Matched to Central University of Jharkhand, Environmental Sciences: a close fit to the department's declared environmental monitoring work, 62 km from the reported location, with previous delivered work in this domain.",
      confidence: 0.9,
    }),
  },
  {
    input: JSON.stringify({
      institution: "NIT Jamshedpur",
      department: "Civil Engineering",
      lab: "Geotechnical Engineering Laboratory",
      terms: [
        { label: "Specialisation overlap", detail: "tags cover slope stability and soil mechanics", contribution: 0.17 },
        { label: "Semantic fit", detail: "good match to the laboratory's declared work", contribution: 0.24 },
        { label: "Distance", detail: "148 km from the reported location", contribution: 0.08 },
      ],
    }),
    output: JSON.stringify({
      reason:
        "Matched to NIT Jamshedpur, Civil Engineering — Geotechnical Engineering Laboratory: a good match to the laboratory's declared work, tags covering slope stability and soil mechanics, and 148 km from the reported location.",
      confidence: 0.91,
    }),
  },
];

export function render(input: S5ReasonInput): string {
  const lines = [
    "Write the routing sentence for this match. These are the only facts you have.",
    "",
    JSON.stringify(
      {
        institution: input.institution,
        department: input.department,
        lab: input.lab,
        terms: input.terms,
      },
      null,
      2,
    ),
    "",
    "Worked examples:",
  ];
  for (const shot of FEWSHOT) {
    lines.push("", `Facts: ${shot.input}`, `Answer: ${shot.output}`);
  }
  return lines.join("\n");
}
