/**
 * Ground-truth transcripts for the seeded voice notes.
 *
 * Declared stub, and we say it exactly this way on the slide: **the voice stage
 * demonstrates the ASR pipeline with a seeded artifact. Live multilingual ASR
 * is not what we are showing.**
 *
 * What is real: the pipeline P0 runs, the transcript it produces flows into S1
 * and S2 like any other text, the audio player and the original-language
 * transcript and the English working copy all render side by side, and the
 * live ASR path is implemented and works (Groq's whisper-large-v3). What is
 * seeded: the transcript for the one recording used in the demo, so that a
 * fifteen-second Hindi clip recorded on a phone in a noisy hall does not decide
 * whether the demo works.
 *
 * Keyed by the SHA-256 of the audio bytes — the same content hash Storage keys
 * the object by — so the lookup cannot drift onto the wrong recording.
 *
 * HUMAN: after recording `seed-data/voice-note.mp3`, run
 *
 *     node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('seed-data/voice-note.mp3')).digest('hex'))"
 *
 * and paste the hash in as the key below. Until then the file is 0 bytes, no
 * media row exists, and P0 falls through to the live path.
 */

export interface SeededTranscript {
  /** The speaker's own language, verbatim. This is the record. */
  original: string;
  lang: string;
  /** The English working copy. Rendered beside the original, never instead. */
  english: string;
  speaker: string;
  note: string;
}

export const SEEDED_TRANSCRIPTS: Record<string, SeededTranscript> = {
  // HUMAN: replace this placeholder key with the recording's real SHA-256.
  // The value is already the authored ground truth from
  // seed-data/voice-note.transcript.txt, checked against that file by
  // `pnpm p0:verify`.
  "0000000000000000000000000000000000000000000000000000000000000000": {
    original:
      "मेरा नाम सुनीता उरांव है, मैं गुमला ज़िला के बसिया से बोल रही हूँ। हमारे टोला के बगल में कोयल नदी का मिट्टी का बांध है, उसमें पुलिया के पास दरार आ गई है। पिछले बरसात में एक हाथ की थी, अब पूरा हाथ अंदर चला जाता है और गांव की तरफ बढ़ रही है। जुलाई में पानी चढ़ा तो चालीस घर और स्कूल डूब जाएंगे। मुखिया को दो बार बताया, कोई देखने नहीं आया।",
    lang: "hi",
    english:
      "My name is Sunita Oraon, I am speaking from Basia in Gumla district. Next to our tola there is a mud embankment on the Koel river, and a crack has opened in it near the culvert. Last monsoon it was one hand wide; now my whole arm goes inside and it is growing towards the village side. If the water rises in July, forty houses and the school will go under. We told the mukhiya twice, nobody has come to look.",
    speaker: "Sunita Oraon, Basia block, Gumla",
    note:
      "Seeded ground-truth transcript. The ASR pipeline is real and the live path is implemented; " +
      "this recording is transcribed from the authored transcript so the demo does not depend on " +
      "a phone recording made in a noisy hall.",
  },
};

/** The empty-file hash, so the seed can tell "not recorded yet" from "missing". */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function seededTranscriptFor(contentHash: string): SeededTranscript | null {
  return SEEDED_TRANSCRIPTS[contentHash] ?? null;
}
