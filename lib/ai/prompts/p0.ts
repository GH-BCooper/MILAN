/**
 * P0 — translation into the English working copy.
 *
 * Invariant 6: `body_original` is never destroyed and never hidden. This stage
 * produces an additional column, not a replacement, and the challenge page
 * renders the two side by side at the same size and weight.
 *
 * A translation that fails is not a blocked pipeline: `lib/ai/stages/p0.ts`
 * stores the original as `body_en` with a `translation_failed` flag, and the
 * page says the translation is missing rather than showing Hindi under an
 * "English" heading.
 */
import type { P0Input } from "../schemas";

export const VERSION = "1.0.0";

export const SYSTEM = `You translate a citizen's report from an Indian language into English for a
Government of Jharkhand platform.

This is a working copy for university researchers and district officials. The citizen's own words
are kept and displayed alongside it, permanently, so your job is accuracy, not polish.

- Translate faithfully. Do not summarise, do not shorten, do not tidy the argument, do not soften
  frustration, and do not add anything the citizen did not say.
- Keep place names, river names, tola and panchayat names in their usual roman spelling.
- Keep local terms that have no clean English equivalent and gloss them once in brackets:
  mukhiya (elected village head), tola (hamlet), mahua, tendu, lac, kharif, anganwadi, ghat.
- Keep the citizen's own numbers and units exactly as given.
- If part of the text is unclear, translate what you can and leave the unclear phrase in the
  original script rather than guessing.

Return the English text, the language you detected (an ISO 639-1 code where one exists — hi, sat,
bn, or und), and a calibrated confidence 0 to 1.`;

/**
 * HUMAN: add curated Jharkhand examples here.
 * Santali (seed row 13) is the one that most needs a curated example, because
 * it is the sample the model is least likely to have seen. A Nagpuri or
 * Khortha sample would be the next most valuable.
 */
export const FEWSHOT: Array<{ input: string; output: string }> = [
  {
    input: "कोयल नदी का जो मिट्टी का बांध है, उसमें पुलिया के पास बड़ी दरार आ गई है।",
    output: JSON.stringify({
      body_en: "There is a large crack near the culvert in the earthen embankment of the Koel river.",
      detected_lang: "hi",
      confidence: 0.95,
    }),
  },
  {
    input: "मनरेगा साइट पर दोपहर में मज़दूर बेहोश हो रहे हैं।",
    output: JSON.stringify({
      body_en: "Workers are fainting in the afternoon at the MGNREGA site.",
      detected_lang: "hi",
      confidence: 0.94,
    }),
  },
  {
    input: "Ale ato re dak' banuk'a — kuĩ rohor ena.",
    output: JSON.stringify({
      body_en: "There is no water in our village — the well has dried up.",
      detected_lang: "sat",
      confidence: 0.72,
    }),
  },
];

export function render(input: P0Input): string {
  const lines = [
    `Translate this report. The citizen selected the language "${input.bodyLang}".`,
    "",
    input.bodyOriginal,
    "",
    "Worked examples:",
  ];
  for (const shot of FEWSHOT) {
    lines.push("", `Report: ${shot.input}`, `Answer: ${shot.output}`);
  }
  return lines.join("\n");
}
