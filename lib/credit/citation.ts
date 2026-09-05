/**
 * The citation string.
 *
 * A final-year project that cannot be cited is a project that does not count
 * towards anybody's career, and a citizen who cannot be cited is a citizen whose
 * contribution evaporates the moment a paper is written. So the originator is
 * named first, in the author position, before the institution.
 *
 * Pure: no database, no `server-only`. The same function renders the string on
 * the public challenge page, in the BibTeX download and in the PDF export.
 */

export interface CitationInput {
  trackingId: string;
  /** The citizen who reported it. Named, unless they submitted anonymously. */
  originatorName: string | null;
  /** e.g. "BIT Sindri Civil Engineering Team". Null before anyone claims it. */
  teamName: string | null;
  title: string;
  /** District or block, for the "where" clause. */
  place: string | null;
  year: number;
  host: string;
}

/** "Oraon, S." from "Sunita Oraon". Returns null for an anonymous report. */
export function surnameInitial(fullName: string | null): string | null {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map((p) => `${p[0].toUpperCase()}.`).join(" ");
  return `${surname}, ${initials}`;
}

export function citationUrl(input: Pick<CitationInput, "host" | "trackingId">): string {
  const host = input.host.replace(/\/+$/, "");
  return `${host}/c/${input.trackingId}`;
}

/**
 * The house style:
 *   Oraon, S. (originator), BIT Sindri Civil Engineering Team (2026).
 *   "Embankment fissure early warning, South Koel."
 *   Milan JH-2026-GUM-0042. https://host/c/JH-2026-GUM-0042
 */
export function citationString(input: CitationInput): string {
  const originator = surnameInitial(input.originatorName);
  const authors = [
    originator ? `${originator} (originator)` : "Anonymous reporter (originator)",
    input.teamName,
  ]
    .filter(Boolean)
    .join(", ");

  const titleWithPlace = input.place ? `${input.title}, ${input.place}` : input.title;
  return `${authors} (${input.year}). "${titleWithPlace}." Milan ${input.trackingId}. ${citationUrl(input)}`;
}

/** BibTeX, because a faculty member will ask for it before they ask for anything else. */
export function bibtex(input: CitationInput): string {
  const originator = surnameInitial(input.originatorName) ?? "Anonymous reporter";
  const authors = [originator, input.teamName].filter(Boolean).join(" and ");
  const key = input.trackingId.replace(/-/g, "");
  const titleWithPlace = input.place ? `${input.title}, ${input.place}` : input.title;

  return [
    `@misc{milan${key},`,
    `  author       = {${authors}},`,
    `  title        = {{${titleWithPlace}}},`,
    `  year         = {${input.year}},`,
    `  howpublished = {Milan, Government of Jharkhand},`,
    `  note         = {Milan tracking identifier ${input.trackingId}. Originating report by ${originator}.},`,
    `  url          = {${citationUrl(input)}}`,
    `}`,
  ].join("\n");
}
