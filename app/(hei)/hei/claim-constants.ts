/**
 * Constants shared between the claim form and the claim action.
 *
 * They live outside both because a `"use server"` module may only export async
 * functions, and the client needs these at render time.
 */

/**
 * The declared roles a team member can carry on the credit chain.
 *
 * Deliberately concrete. "Member" tells nobody anything in five years' time;
 * "field survey" and "modelling and analysis" are what a person can point at
 * and say that was mine.
 */
export const DECLARED_ROLES = [
  "Team lead",
  "Field survey",
  "Modelling and analysis",
  "Design",
  "Software",
  "Community liaison",
  "Documentation",
] as const;

/** Normalise a comma, pipe or newline separated tag string into the array the
 *  capability graph stores and the match score reads. */
export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,|\n]/)
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter((t) => t.length >= 2 && t.length <= 40),
    ),
  ].slice(0, 40);
}
