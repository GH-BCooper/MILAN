/**
 * Level 1 — Groq, OpenAI-compatible chat completions in JSON mode.
 *
 * Groq's `json_object` mode guarantees valid JSON but not our shape, so the
 * schema is also spelled out in the system message and the Zod parse is the
 * thing that actually enforces it. A shape failure here is not an error to
 * report to the user: it is a fall-through to level 2.
 */
import { toJsonSchema } from "./jsonSchema";
import {
  ProviderFailure,
  extractJson,
  withTimeout,
  type CompleteArgs,
  type CompleteResult,
  type LLMProvider,
} from "./types";

/** The strongest JSON-capable model Groq currently serves. Pinned, not floating. */
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export const groqProvider: LLMProvider = {
  name: "groq",
  level: 1,

  available() {
    return Boolean(process.env.GROQ_API_KEY);
  },

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new ProviderFailure("groq", "GROQ_API_KEY is not set");

    const responseSchema = args.responseSchema ?? toJsonSchema(args.schema);
    const started = Date.now();

    const value = await withTimeout("groq", args.timeoutMs, async (signal) => {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                `${args.system}\n\n` +
                `Reply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n` +
                `${JSON.stringify(responseSchema)}`,
            },
            { role: "user", content: args.user },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderFailure("groq", `HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      const payload: unknown = await response.json();
      const text = firstMessage(payload);
      if (!text) throw new ProviderFailure("groq", "empty choice in response");

      return args.schema.parse(extractJson(text));
    });

    return { value, model: MODEL, latencyMs: Date.now() - started };
  },
};

function firstMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}
