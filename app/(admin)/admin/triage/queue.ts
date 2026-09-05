import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { S1_THRESHOLDS } from "@/lib/ai/stages/s1";
import { S2_THRESHOLDS } from "@/lib/ai/stages/s2";
import { TERMINAL_STATES } from "@/lib/db/stateMachine";

/**
 * The low-confidence human queue.
 *
 * Deliberately DERIVED rather than stored. There is no `needs_review` column
 * and no queue table: an item is in the queue exactly when its most recent run
 * of a stage came back under that stage's floor and no human has since recorded
 * a decision on that same input. Which means the queue can never disagree with
 * the runs it is built from, and every row in it is clickable through to the
 * `ai_runs` row that put it there — invariant 10, applied to our own workings.
 *
 * A human "accepting" the AI's proposal writes a `training_corrections` row
 * exactly as an override does, with `corrected` equal to `proposed`. That is
 * what removes it from the queue, and it is also a labelled example: knowing
 * the model was right is as useful as knowing it was wrong.
 */
export interface TriageItem {
  challengeId: string;
  trackingId: string;
  title: string;
  bodyOriginal: string;
  bodyLang: string;
  bodyEn: string | null;
  status: string;
  districtName: string | null;
  blockName: string | null;
  stage: string;
  runId: string;
  provider: string | null;
  model: string | null;
  fallbackLevel: number;
  confidence: number | null;
  inputHash: string | null;
  proposal: unknown;
  createdAt: Date;
  floor: number;
}

export async function triageQueue(limit = 50): Promise<TriageItem[]> {
  const terminal = TERMINAL_STATES.map((s) => `'${s}'`).join(",");

  const rows = await db.execute<{
    challenge_id: string;
    tracking_id: string;
    title: string;
    body_original: string;
    body_lang: string;
    body_en: string | null;
    status: string;
    district_name: string | null;
    block_name: string | null;
    stage: string;
    run_id: string;
    provider: string | null;
    model: string | null;
    fallback_level: number;
    confidence: string | null;
    input_hash: string | null;
    output: unknown;
    created_at: Date;
  }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (r.challenge_id, r.stage)
        r.id, r.challenge_id, r.stage, r.provider, r.model, r.fallback_level,
        r.confidence, r.input_hash, r.output, r.created_at
      FROM ai_runs r
      WHERE r.stage IN ('S1_TRIAGE', 'S2_CLASSIFY')
        AND r.challenge_id IS NOT NULL
      ORDER BY r.challenge_id, r.stage, r.created_at DESC
    )
    SELECT
      c.id           AS challenge_id,
      c.tracking_id, c.title, c.body_original, c.body_lang, c.body_en, c.status,
      d.name         AS district_name,
      b.name         AS block_name,
      l.stage, l.id  AS run_id, l.provider, l.model, l.fallback_level,
      l.confidence, l.input_hash, l.output, l.created_at
    FROM latest l
    JOIN challenges c ON c.id = l.challenge_id
    LEFT JOIN districts d ON d.code = c.district_code
    LEFT JOIN blocks b ON b.code = c.block_code
    WHERE c.status NOT IN (${sql.raw(terminal)})
      AND (
        (l.stage = 'S1_TRIAGE'   AND l.confidence < ${S1_THRESHOLDS.humanQueue})
        OR (l.stage = 'S2_CLASSIFY' AND l.confidence < ${S2_THRESHOLDS.humanQueue})
      )
      -- A human has already ruled on this exact input, so it is not waiting.
      AND NOT EXISTS (
        SELECT 1 FROM training_corrections t
        WHERE t.challenge_id = c.id
          AND t.stage = l.stage
          AND t.input_hash IS NOT DISTINCT FROM l.input_hash
      )
    ORDER BY l.confidence ASC, l.created_at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    challengeId: r.challenge_id,
    trackingId: r.tracking_id,
    title: r.title,
    bodyOriginal: r.body_original,
    bodyLang: r.body_lang,
    bodyEn: r.body_en,
    status: r.status,
    districtName: r.district_name,
    blockName: r.block_name,
    stage: r.stage,
    runId: r.run_id,
    provider: r.provider,
    model: r.model,
    fallbackLevel: r.fallback_level,
    confidence: r.confidence === null ? null : Number(r.confidence),
    inputHash: r.input_hash,
    proposal: (r.output as { value?: unknown } | null)?.value ?? null,
    createdAt: r.created_at,
    floor: r.stage === "S1_TRIAGE" ? S1_THRESHOLDS.humanQueue : S2_THRESHOLDS.humanQueue,
  }));
}
