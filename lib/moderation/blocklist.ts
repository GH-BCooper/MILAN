/**
 * A deterministic, offline pre-flight check on step 1 of the submit wizard.
 *
 * This is NOT the AI safety stage — S1 (lib/ai/stages/s1) already exists
 * downstream, reads the full text with a model, and decides REJECT_UNSAFE /
 * FORWARD_EXTERNAL / HUMAN_QUEUE with a real rationale. This module runs
 * before any of that, in the browser, with no network call and no model:
 * it exists only to stop the small, obvious cases — a slur, or "test test
 * test" — from ever reaching a human, before the citizen leaves step 1.
 * Invariant 8 (nothing on the demo path may depend on a live third-party API
 * succeeding) makes this a hard requirement, not a nicety: it must work with
 * the wifi off.
 *
 * Pure, no I/O, importable from client or server — same discipline as
 * `packages/scoring`. Kept small and curated on purpose: this is a blunt
 * pre-filter, not an NSFW classifier, and CLAUDE.md's "ship the deterministic
 * fallback" rule says a small honest wordlist beats a big fake-precise one.
 */

/** English profanity/abuse. Deliberately short — common, unambiguous terms
 *  only, not a scrape of every slur dictionary on the internet. */
const PROFANITY_EN: readonly string[] = [
  "fuck",
  "fucking",
  "fucker",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "cunt",
  "dick",
  "piss off",
  "whore",
  "slut",
  "retard",
  "retarded",
  "nigger",
  "nigga",
  "chutiya",
  "madarchod",
  "behenchod",
  "bhosdike",
  "randi",
  "gandu",
  "harami",
  "saala kutta",
];

/** Hindi (Devanagari) profanity/abuse — a small curated set, common forms. */
const PROFANITY_HI: readonly string[] = [
  "चूतिया",
  "मादरचोद",
  "बहनचोद",
  "भोसड़ीके",
  "भोसडीके",
  "रंडी",
  "गांडू",
  "गंडू",
  "साला कुत्ता",
  "कुत्ते",
  "हरामी",
  "कमीना",
  "कमीनी",
];

const ALL_PROFANITY = [...PROFANITY_EN, ...PROFANITY_HI];

/** Nonsense/low-effort phrases seen often enough to name outright, in
 *  addition to the structural heuristics below. */
const TROLL_PHRASES: readonly string[] = [
  "test test test",
  "asdf",
  "asdfasdf",
  "qwerty",
  "lorem ipsum",
  "blah blah blah",
  "nothing here",
  "just testing",
];

export interface ModerationResult {
  blocked: boolean;
  /** Why, for the inline message and for tests — never shown as a formal
   *  accusation ("profanity detected"), just steers the citizen to try again. */
  reason: "profanity" | "low_effort" | "repetitive" | null;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[.,!?;:"'()[\]{}\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-word / whole-phrase match so "class" does not trip on a substring
 *  inside a longer, innocent word. Devanagari has no word-boundary concept in
 *  JS regex `\b`, so those entries fall back to a plain substring test. */
function containsListed(normalised: string, list: readonly string[]): boolean {
  for (const term of list) {
    const isDevanagari = /[ऀ-ॿ]/.test(term);
    if (isDevanagari) {
      if (normalised.includes(term.toLowerCase())) return true;
      continue;
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i");
    if (re.test(` ${normalised} `)) return true;
  }
  return false;
}

/**
 * A single character (or a very short run) repeated past any plausible real
 * word — "aaaaaaaaaaaa", "!!!!!!!!!!!!" once punctuation is stripped down to
 * letters, "hahahahahaha" taken to an extreme. Real Hindi/English civic
 * reports do not look like this.
 */
function isCharacterSpam(normalised: string): boolean {
  const letters = normalised.replace(/\s/g, "");
  if (letters.length < 8) return false;
  // Smallest period the whole string tiles under, whatever its width —
  // "aaaaaaaa", "hahahahaha", "asdfasdfasdf" are all one short unit repeated,
  // just at different unit lengths, and a real word essentially never is.
  for (let period = 1; period <= Math.min(6, Math.floor(letters.length / 3)); period++) {
    if (letters.length % period !== 0) continue;
    const unit = letters.slice(0, period);
    if (unit.repeat(letters.length / period) === letters) return true;
  }
  return false;
}

/**
 * Mostly-repeated words — "test test test test", "abc abc abc" — which pass
 * a length floor but say nothing. Below three words there is not enough
 * signal to call it repetitive rather than just short.
 */
function isRepetitiveWords(normalised: string): boolean {
  const words = normalised.split(" ").filter(Boolean);
  if (words.length < 3) return false;
  const unique = new Set(words);
  return unique.size / words.length <= 0.34;
}

/** No length floor of its own — MIN_BODY_CHARS (schema.ts) already gates
 *  that, and duplicating the number here would just be two thresholds to
 *  keep in sync. This only judges what has actually been typed. */
export function moderate(text: string): ModerationResult {
  const normalised = normalise(text);
  if (!normalised) return { blocked: false, reason: null };

  if (containsListed(normalised, ALL_PROFANITY)) {
    return { blocked: true, reason: "profanity" };
  }
  if (containsListed(normalised, TROLL_PHRASES) || isCharacterSpam(normalised)) {
    return { blocked: true, reason: "low_effort" };
  }
  if (isRepetitiveWords(normalised)) {
    return { blocked: true, reason: "repetitive" };
  }
  return { blocked: false, reason: null };
}

/** The pure predicate the task asks for, for a one-line call site and for
 *  unit tests that only care about the yes/no. */
export function isBlocked(text: string): boolean {
  return moderate(text).blocked;
}

export const MODERATION_MESSAGE =
  "This doesn't read like a real civic or disaster problem. Please describe what is actually happening, in your own words.";
