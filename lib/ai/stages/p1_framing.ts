/**
 * P1 — the AI problem framing.
 *
 * The AI only ever PROPOSES wording here. Nothing is stored as
 * `framed_statement` until the citizen ticks approval; if they decline, their
 * own text is used and that decision is recorded and shown on the page. There
 * is no path in Milan by which an AI puts words in a citizen's mouth.
 *
 * `body_original` is never touched by this stage. The database says so too —
 * see the column comment in migration 0006.
 */
import "server-only";

import { runWithChain } from "../providers/chain";
import * as prompt from "../prompts/p1";
import { P1Schema, type P1Input, type P1Output } from "../schemas";
import type { StageRun } from "../types";

/**
 * Framing runs while the citizen is still filling in the form, so it gets a
 * longer budget than a pipeline stage: waiting four seconds on a screen where
 * you are reading is very different from waiting four seconds on a screen where
 * you are watching a spinner.
 */
export const P1_TIMEOUT_MS = Number(process.env.AI_FRAMING_TIMEOUT_MS ?? 6000);

export async function runP1(
  input: P1Input,
  challengeId?: string | null,
): Promise<StageRun<P1Output>> {
  return runWithChain({
    stage: "P1_FRAMING",
    version: prompt.VERSION,
    system: prompt.SYSTEM,
    user: prompt.render(input),
    schema: P1Schema,
    input,
    timeoutMs: P1_TIMEOUT_MS,
    challengeId,
    confidenceOf: (v) => v.confidence,
  });
}

/**
 * How the framing is described wherever it appears.
 *
 * Three states, and the difference between them is the whole point of the
 * feature, so it is never left implicit.
 */
export function framingProvenance(args: {
  framedStatement: string | null;
  approved: boolean;
}): { label: string; detail: string } {
  if (!args.framedStatement) {
    return {
      label: "Reporter's own wording",
      detail: "No rewrite was proposed, so the report reads exactly as it was written.",
    };
  }
  if (args.approved) {
    return {
      label: "Wording proposed by AI, approved by the reporter",
      detail:
        "Milan suggested a clearer statement of the problem and the person who reported it read " +
        "it, edited it and approved it. Their original words are above, unchanged.",
    };
  }
  return {
    label: "Reporter's own wording",
    detail:
      "Milan proposed a rewrite and the reporter declined it, so their own wording stands. " +
      "That decision is recorded.",
  };
}
