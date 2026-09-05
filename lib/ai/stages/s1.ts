/**
 * S1 — safety and grievance triage.
 *
 * A pure async function: it takes a plain input, returns a typed result, and
 * writes nothing to the challenges table.
 *
 * Every decision that follows from it lives in `lib/ai/triage.ts`, which has no
 * database, no network and no provider chain, and is re-exported here so
 * callers have one import site. That split is not tidiness: it is how the claim
 * "the AI proposes, deterministic code decides" gets a test suite.
 */
import "server-only";

import { runWithChain } from "../providers/chain";
import * as prompt from "../prompts/s1";
import { S1Schema, type S1Input, type S1Output } from "../schemas";
import type { StageRun } from "../types";

export * from "../triage";

export async function runS1(
  input: S1Input,
  challengeId?: string | null,
): Promise<StageRun<S1Output>> {
  return runWithChain({
    stage: "S1_TRIAGE",
    version: prompt.VERSION,
    system: prompt.SYSTEM,
    user: prompt.render(input),
    schema: S1Schema,
    input,
    challengeId,
    confidenceOf: (v) => v.confidence,
  });
}

