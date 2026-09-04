import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted, so `{a:1,b:2}` and `{b:2,a:1}` hash the
 * same. Without this the cache misses on nothing more than key order and the
 * "identical input, identical output" claim quietly stops being true.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The cache key and `ai_runs.input_hash`: stage + prompt version + input. */
export function stageInputHash(stage: string, version: string, input: unknown): string {
  return sha256(`${stage} ${version} ${canonicalJson(input)}`);
}
