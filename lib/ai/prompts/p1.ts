/**
 * P1 — the AI problem framing the citizen approves or rejects.
 *
 * The AI only ever PROPOSES wording here. Nothing is stored as
 * `framed_statement` until the citizen ticks approval, and if they decline
 * their own text is used and that decision is recorded and displayed.
 * An AI cannot put words in a citizen's mouth in Milan (PHASE_2_LEARN.md 8).
 *
 * The output has two jobs: give a student team a problem they can actually
 * start on, and give everyone a shared definition of done.
 */
import type { P1Input } from "../schemas";

export const VERSION = "1.0.1";

export const SYSTEM = `You turn a citizen's description of a local problem into a research-ready
problem statement for a final-year university project team in Jharkhand.

You are proposing wording to the citizen, who will read it, edit it and either approve it or
reject it. Write something they would recognise as their own problem.

framed_statement — 2 to 4 sentences. State what is wrong, where, who it affects and what is not
known. Keep every specific the citizen gave: the landmark, the measurements, the season, the
numbers. Do NOT add a cause, a diagnosis, a solution or any number they did not give. Do not use
the words "stakeholder", "leverage", "framework" or "ecosystem". Write it so a second-year student
understands it and a district engineer does not find it naive.

success_criteria — 1 to 3 sentences answering "how would we know this was actually solved?" It must
be something the citizen themselves could observe and confirm, because in Milan only the citizen's
confirmation counts as impact. Prefer an observable outcome over a deliverable: "the tola is not
cut off during the July rains" is better than "a report is submitted".

Return a calibrated confidence 0 to 1 that this framing is faithful to what the citizen wrote.`;

/**
 * HUMAN: add curated Jharkhand examples here.
 * Two starters below plus one deliberately messy input. What is still missing:
 * a report where the citizen has already proposed their own (wrong) solution,
 * so the model learns to frame the problem rather than adopt their diagnosis;
 * and a very short report, where the temptation to invent detail is strongest.
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input:
      "The mud embankment on the South Koel beside our tola has a crack that started after last " +
      "monsoon near the culvert. It was one hand wide in October, now I can put my whole arm in it " +
      "and it is getting longer towards the village side. When the river rises in July the water " +
      "will come straight through it into forty houses and the school.",
    output: JSON.stringify({
      framed_statement:
        "An earthen flood embankment on the South Koel river at Basia has developed a crack near the culvert that has widened from roughly a hand's width in October to an arm's width, and is extending towards the village. If it fails during the July river rise, water would reach around forty houses and the village school. Neither the cause of the crack nor the rate at which it is progressing has been established.",
      success_criteria:
        "The cause and rate of the crack are established, a repair or reinforcement approach suited to an earthen embankment is specified, and the residents of the tola confirm that the July rise passed without water entering the village.",
      confidence: 0.9,
    }),
  },
  {
    input:
      "Workers are fainting at the MGNREGA site in the afternoon. It has happened four or five times " +
      "this May. There is no shade and the water drum is empty by noon.",
    output: JSON.stringify({
      framed_statement:
        "Labourers at an MGNREGA worksite in Palamu have collapsed on four or five occasions during May afternoons. The site has no shade structure and the drinking water drum is empty by midday. It is not known what combination of work timing, shade and water provision would prevent this at the temperatures the site actually reaches.",
      success_criteria:
        "A worksite heat protocol suited to this site is defined and adopted, and workers report a May with no collapses.",
      confidence: 0.88,
    }),
  },
  {
    input:
      "sir water problem in our village very bad since 3 year no one listen well dry after march " +
      "women go 3 km hand pump also not working plz help",
    output: JSON.stringify({
      framed_statement:
        "A village in Garhwa has had no reliable drinking water for three years. The well dries after March and the hand pump is not working, so women walk roughly three kilometres to fetch water. It is not established whether the failure is a falling water table, the depth or condition of the existing sources, or both.",
      success_criteria:
        "The reason the sources fail after March is established, a year-round source is identified or restored, and the women of the village confirm they no longer walk to fetch water in the dry months.",
      confidence: 0.74,
    }),
  },
  // DRAFT — citizen's own (wrong) solution, and a very short report, per the HUMAN note above.
  {
    input:
      "The school roof leaks every monsoon. I think the solution is to build a new concrete roof on top of the " +
      "old one and that will surely fix it. Please assign this to someone.",
    output: JSON.stringify({
      framed_statement:
        "The school roof leaks during every monsoon, disrupting classes and leaving children in water. Whether a repair or a rebuild is appropriate, and the cause of the leak, have not been established; the citizen's proposed overlay is one unverified option among others.",
      success_criteria:
        "The cause of the leak is identified and a repair or rebuild chosen on that basis, and the teacher confirms a monsoon passes with no classes disrupted by leaking.",
      confidence: 0.82,
    }),
  },
  {
    input: "no water in our tola since May. help.",
    output: JSON.stringify({
      framed_statement:
        "A tola has had no drinking water since May. It is not established whether the source has failed, the supply line is broken, or demand has outgrown it.",
      success_criteria:
        "The cause of the outage is established, water is restored, and the residents confirm supply has returned through the dry season.",
      confidence: 0.7,
    }),
  },
];

export function render(input: P1Input): string {
  const where = [input.blockName, input.districtName].filter(Boolean).join(", ");
  const lines = [
    "Propose a framing for this report.",
    "",
    `Location: ${where || "not given"}`,
    "",
    "The citizen's own words:",
    input.bodyOriginal,
  ];

  if (input.bodyEn && input.bodyEn !== input.bodyOriginal) {
    lines.push("", "English working copy:", input.bodyEn);
  }

  lines.push("", "Worked examples:");
  for (const shot of FEWSHOT) {
    lines.push("", `Report: ${shot.input}`, `Answer: ${shot.output}`);
  }
  return lines.join("\n");
}
