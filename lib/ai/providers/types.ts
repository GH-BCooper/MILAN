import type { ZodType } from "zod";

import type { FallbackLevel, StageName } from "../types";

/**
 * One interface, three implementations, and the chain does not care which one
 * answered. Level 2 has no network at all, which is the whole point.
 */
export interface CompleteArgs<T> {
  /** Which stage is asking. Level 2 dispatches on this; levels 0 and 1 log it. */
  stage: StageName;
  system: string;
  user: string;
  schema: ZodType<T>;
  timeoutMs: number;
  /**
   * The stage's structured input.
   *
   * Levels 0 and 1 read the rendered `user` string. Level 2 reads this instead:
   * a rule engine that parses its own prompt back out of prose would be a
   * comedy. Passing both keeps the interface uniform without pretending the
   * rule tier is a language model.
   */
  input: unknown;
  /** Constrained-decoding hint, derived from `schema` by `jsonSchema.ts`. */
  responseSchema?: JsonSchemaNode;
}

export interface CompleteResult<T> {
  value: T;
  model: string;
  latencyMs: number;
}

export interface LLMProvider {
  name: string;
  /** 0 gemini, 1 groq, 2 rules. */
  level: FallbackLevel;
  /** False when the provider has no credentials; the chain skips it silently. */
  available(): boolean;
  complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>>;
}

/** A provider failed in a way the chain should absorb and step past. */
export class ProviderFailure extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}

export class ProviderTimeout extends ProviderFailure {
  constructor(provider: string, timeoutMs: number) {
    super(provider, `${provider} exceeded its ${timeoutMs}ms budget`);
    this.name = "ProviderTimeout";
  }
}

/** The subset of JSON Schema both Gemini and Groq accept. */
export interface JsonSchemaNode {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  nullable?: boolean;
}

/**
 * A hard timeout around any promise. Never `await` a provider open-endedly:
 * a hung call is the one failure mode our per-stage budget cannot absorb, and
 * it is exactly what kills a live demo.
 */
export function withTimeout<T>(
  provider: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeout(provider, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([run(controller.signal), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Models wrap JSON in prose or fences more often than their docs admit. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost brace pair before giving up on this level.
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first !== -1 && last > first) return JSON.parse(candidate.slice(first, last + 1));
    throw new Error(`no JSON object found in provider output: ${candidate.slice(0, 160)}`);
  }
}
