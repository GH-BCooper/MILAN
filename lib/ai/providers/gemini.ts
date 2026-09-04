/**
 * Level 0 — Gemini 2.5 Flash, constrained to JSON.
 *
 * Called over plain `fetch` rather than through the Google SDK: one dependency
 * fewer, one bundle smaller, and an `AbortSignal` we control end to end. The
 * hard timeout is the point of this file as much as the model is.
 */
import type { ZodType } from "zod";

import { toJsonSchema } from "./jsonSchema";
import {
  ProviderFailure,
  extractJson,
  withTimeout,
  type CompleteArgs,
  type CompleteResult,
  type JsonSchemaNode,
  type LLMProvider,
} from "./types";

/**
 * CLAUDE.md section 3 locks the stack to "Gemini 2.5 Flash". As of this build
 * the API answers `models/gemini-2.5-flash` with a 404: "no longer available to
 * new users ... use models/gemini-3.6-flash". So we run the current Flash tier
 * of the same family, pinned rather than floating on `-latest` so that demo day
 * gets the model we tested. Overridable with GEMINI_MODEL.
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Gemini's `responseSchema` is OpenAPI-flavoured: it wants uppercase types and
 *  `propertyOrdering`, and it rejects `required` on a nullable field. */
function toGeminiSchema(node: JsonSchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: node.type.toUpperCase() };
  if (node.description) out.description = node.description;
  if (node.nullable) out.nullable = true;
  if (node.enum) out.enum = node.enum;
  if (node.items) out.items = toGeminiSchema(node.items);
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
    // Ordering matters to Gemini's decoder; without it the model is free to
    // emit fields in an order that makes long outputs less reliable.
    out.propertyOrdering = Object.keys(node.properties);
    if (node.required?.length) out.required = node.required;
  }
  return out;
}

export const geminiProvider: LLMProvider = {
  name: "gemini",
  level: 0,

  available() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new ProviderFailure("gemini", "GEMINI_API_KEY is not set");

    const responseSchema = args.responseSchema ?? toJsonSchema(args.schema as ZodType<T>);
    const started = Date.now();

    const value = await withTimeout("gemini", args.timeoutMs, async (signal) => {
      const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${key}`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.system }] },
          contents: [{ role: "user", parts: [{ text: args.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(responseSchema),
            // Classification, not composition. Determinism is worth more to us
            // than variety, and it makes the cache honest.
            temperature: 0,
            candidateCount: 1,
            maxOutputTokens: 2048,
            // Thinking is on by default in this model family and costs whole
            // seconds. Our per-stage budget is 2500ms and the task is
            // classification against a fixed schema, not reasoning, so we buy
            // latency back here. Raise it if a stage starts misclassifying.
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderFailure("gemini", `HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      const payload: unknown = await response.json();
      const text = firstText(payload);
      if (!text) throw new ProviderFailure("gemini", "empty candidate in response");

      // Parse even though the API guarantees the schema. A guarantee we did not
      // verify is a guarantee we cannot show a judge (PHASE_2_LEARN.md 2.1).
      return args.schema.parse(extractJson(text));
    });

    return { value, model: MODEL, latencyMs: Date.now() - started };
  },
};

/** Dig the first text part out of the candidate, tolerating a shape change. */
function firstText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) return text;
  }
  return null;
}
