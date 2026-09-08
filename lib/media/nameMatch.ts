import "server-only";

/**
 * Deterministic name-on-document matching.
 *
 * Org verification (HEI/Industry proof of affiliation) is, at bottom, one
 * question: does the name the applicant typed at registration appear on the
 * document they uploaded? CLAUDE.md invariant 3 says the AI proposes and
 * deterministic code decides — this IS that deterministic decision, written
 * so it can run the moment extracted document text exists (an OCR/PDF-text
 * stage bolted on later, or a reviewer pasting what they read) without any
 * change to the call site.
 *
 * Today nothing in this repo extracts text from the uploaded PDF/JPG/PNG
 * (no `pdf-parse`/`tesseract.js` in package.json, and CLAUDE.md invariant 8
 * forbids depending on a live third-party OCR API on the demo path with no
 * local fallback). Until that exists, `nameAppearsInText` is exercised by
 * the admin at /admin/verification, matching by eye — this function is the
 * same check they are making, written down so it is not just "read the
 * document and eyeball it."
 */

/** Words too short or too common to count as a meaningful part of a name on
 *  their own (an initial, or a title/connector that would match almost any
 *  document and prove nothing). */
const IGNORED_WORDS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "shri", "smt", "kumari",
  "the", "of", "and", "de", "van", "bin",
]);

function normalise(s: string): string {
  return s
    .toLowerCase()
    // Diacritics fold to their base letter so "R. Kumar" matches "R Kumar",
    // and punctuation drops so "O'Brien" matches "OBrien" — a document scan
    // or a typed name are never going to agree on apostrophes.
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulParts(fullName: string): string[] {
  return normalise(fullName)
    .split(" ")
    .filter((w) => w.length >= 2 && !IGNORED_WORDS.has(w));
}

export interface NameMatchResult {
  matched: boolean;
  /** Which parts of the typed name were actually found, in order — shown to
   *  a reviewer so "matched" is never a black box (CLAUDE.md invariant 10). */
  matchedParts: string[];
  missingParts: string[];
}

/**
 * Does `fullName` appear in `documentText`, as a whole or as its meaningful
 * parts, case- and diacritic-insensitively?
 *
 * A whole-string match is the strong case (the name reads the same on the
 * document as it was typed). Failing that, a document is accepted as a match
 * when a majority of the name's meaningful parts (first name, surname, etc.)
 * are each present as their own word — an ID card that abbreviates a middle
 * name, or a letter that renders "Kumar, R." instead of "R. Kumar", still
 * counts, because the requirement is "the name is on the document," not
 * "the document was typed by our form."
 */
export function nameAppearsInText(fullName: string, documentText: string): NameMatchResult {
  const haystack = normalise(documentText);
  const parts = meaningfulParts(fullName);

  if (parts.length === 0) {
    return { matched: false, matchedParts: [], missingParts: [] };
  }

  const whole = normalise(fullName);
  if (whole.length > 0 && haystack.includes(whole)) {
    return { matched: true, matchedParts: parts, missingParts: [] };
  }

  const boundary = (word: string) => new RegExp(`(?:^|[^a-z0-9])${word}(?:[^a-z0-9]|$)`);
  const matchedParts = parts.filter((p) => boundary(p).test(` ${haystack} `));
  const missingParts = parts.filter((p) => !matchedParts.includes(p));

  // A single-word name (rare, but real) needs that one word; a multi-word
  // name needs a majority of its parts — one shared surname alone should
  // not verify a stranger.
  const needed = parts.length === 1 ? 1 : Math.ceil(parts.length / 2) + 1 > parts.length ? parts.length : Math.ceil((parts.length + 1) / 2);
  return { matched: matchedParts.length >= needed, matchedParts, missingParts };
}
