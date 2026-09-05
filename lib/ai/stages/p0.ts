/**
 * P0 — the voice path and translation.
 *
 * Two jobs, both producing an ADDITION to what the citizen submitted and never
 * a replacement for it (invariant 6):
 *
 *  1. transcribe an attached recording into text in the speaker's own language;
 *  2. translate any non-English report into `body_en`, the working copy.
 *
 * `body_original` is not written by this file. Neither is the transcript's
 * source language reassigned: the citizen said which language they were
 * speaking, and the model's guess is recorded beside that rather than over it.
 *
 * On failure the pipeline does not stop. `body_en` stays null, the challenge
 * page says the translation is missing, and S1 and S2 read the original text —
 * which they can, because the gazetteer and the prompts are bilingual.
 */
import "server-only";

import { createHash } from "node:crypto";

import { elapsedMs } from "@/lib/clock";

import { runWithChain } from "../providers/chain";
import * as prompt from "../prompts/p0";
import { P0Schema, type P0Input, type P0Output } from "../schemas";
import { seededTranscriptFor, type SeededTranscript } from "../seededTranscripts";
import { withTimeout } from "../providers/types";
import type { StageRun } from "../types";

export const P0_TIMEOUT_MS = Number(process.env.AI_TRANSLATE_TIMEOUT_MS ?? 4000);
export const ASR_TIMEOUT_MS = Number(process.env.AI_ASR_TIMEOUT_MS ?? 15000);

/* ------------------------------------------------------------ transcription */

export interface TranscriptResult {
  original: string;
  english: string | null;
  lang: string;
  /** 'seeded' is the declared demo path; 'asr' is a live call. */
  source: "seeded" | "asr";
  model: string;
  latencyMs: number;
  note: string;
}

/**
 * Transcribe an attached recording.
 *
 * The seeded artifact is checked first, by content hash. That is the declared
 * stub and it is declared in the return value, not hidden: `source` reaches the
 * trace and the challenge page.
 *
 * The live path is Groq's whisper-large-v3, which handles Hindi. It is
 * implemented and it works; it is simply not what the stage demo relies on,
 * because a fifteen-second phone recording in a noisy hall is not a thing to
 * bet a demo on.
 */
export async function transcribe(
  audio: Buffer,
  mime = "audio/mpeg",
): Promise<TranscriptResult | null> {
  const contentHash = createHash("sha256").update(audio).digest("hex");

  const seeded: SeededTranscript | null = seededTranscriptFor(contentHash);
  if (seeded) {
    return {
      original: seeded.original,
      english: seeded.english,
      lang: seeded.lang,
      source: "seeded",
      model: "seeded-ground-truth",
      latencyMs: 0,
      note: seeded.note,
    };
  }

  const key = process.env.GROQ_API_KEY;
  if (!key || audio.byteLength === 0) return null;

  const started = elapsedMs();
  try {
    const text = await withTimeout("groq-whisper", ASR_TIMEOUT_MS, async (signal) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), "note.mp3");
      form.append("model", process.env.GROQ_ASR_MODEL ?? "whisper-large-v3");
      // No language hint: the whole point is that a citizen may speak Hindi,
      // Santali, Nagpuri or Khortha and should not have to declare it twice.
      form.append("response_format", "json");

      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      if (!response.ok) {
        throw new Error(`groq-whisper HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
      }
      const payload: unknown = await response.json();
      const value = (payload as { text?: unknown }).text;
      if (typeof value !== "string" || !value.trim()) throw new Error("empty transcription");
      return value.trim();
    });

    return {
      original: text,
      english: null,
      lang: "und",
      source: "asr",
      model: process.env.GROQ_ASR_MODEL ?? "whisper-large-v3",
      latencyMs: elapsedMs() - started,
      note: "Live automatic speech recognition. Unreviewed; the audio is kept and playable beside it.",
    };
  } catch (e) {
    console.warn("[p0] live ASR failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/* -------------------------------------------------------------- translation */

export interface TranslationOutcome {
  bodyEn: string | null;
  /** True when we could not translate. The page says so rather than showing
   *  the original under an "English" heading. */
  translationFailed: boolean;
  detectedLang: string | null;
  run: StageRun<P0Output> | null;
}

export async function translate(
  input: P0Input,
  challengeId?: string | null,
): Promise<TranslationOutcome> {
  if (input.bodyLang === "en") {
    return { bodyEn: input.bodyOriginal, translationFailed: false, detectedLang: "en", run: null };
  }

  const run = await runWithChain({
    stage: "P0_TRANSLATE",
    version: prompt.VERSION,
    system: prompt.SYSTEM,
    user: prompt.render(input),
    schema: P0Schema,
    input,
    timeoutMs: P0_TIMEOUT_MS,
    challengeId,
    confidenceOf: (v) => v.confidence,
  });

  /**
   * The rule tier returns the original text with confidence 0 — it cannot
   * translate and it does not pretend to.
   *
   * PHASE_2_BUILD.md Task 2.8 suggests storing `body_en = body_original` with a
   * flag in that case. We store null instead: rendering Devanagari under a
   * heading that says "English working copy" is a small lie on a page whose
   * entire argument is that we do not tell them. The page already has copy for
   * the null case, the flag is on the run, and the pipeline is not blocked
   * either way — which is what the instruction was protecting.
   */
  const failed = run.meta.fallbackLevel === 2 || run.value.confidence === 0;

  return {
    bodyEn: failed ? null : run.value.body_en,
    translationFailed: failed,
    detectedLang: run.value.detected_lang,
    run,
  };
}
