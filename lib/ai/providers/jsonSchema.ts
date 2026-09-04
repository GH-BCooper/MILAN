/**
 * Zod schema to the JSON Schema subset Gemini and Groq accept.
 *
 * We keep one Zod schema per stage as the single source of truth (CLAUDE.md
 * section 3: "one schema, shared contracts") and derive the provider's response
 * schema from it here. Deriving rather than hand-writing means the constrained
 * decoder and the Zod parse can never drift apart.
 *
 * Deliberately narrow: it handles exactly the shapes our stage schemas use.
 * Anything else throws at build time rather than producing a schema the provider
 * silently ignores.
 */
import { z, type ZodTypeAny } from "zod";

import type { JsonSchemaNode } from "./types";

export function toJsonSchema(schema: ZodTypeAny): JsonSchemaNode {
  const description = schema.description;
  const node = convert(schema);
  return description ? { ...node, description } : node;
}

function convert(schema: ZodTypeAny): JsonSchemaNode {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, JsonSchemaNode> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = toJsonSchema(value);
      if (!isOptional(value)) required.push(key);
    }
    return { type: "object", properties, required };
  }

  if (schema instanceof z.ZodArray) return { type: "array", items: toJsonSchema(schema.element) };

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options as string[] };
  }

  if (schema instanceof z.ZodString) return { type: "string" };

  if (schema instanceof z.ZodNumber) {
    const node: JsonSchemaNode = { type: schema.isInt ? "integer" : "number" };
    if (schema.minValue !== null) node.minimum = schema.minValue;
    if (schema.maxValue !== null) node.maximum = schema.maxValue;
    return node;
  }

  if (schema instanceof z.ZodBoolean) return { type: "boolean" };

  // Unwrap the modifiers our schemas actually use. `nullable` is marked so the
  // provider knows null is legal rather than inventing a placeholder string.
  if (schema instanceof z.ZodNullable) return { ...toJsonSchema(schema.unwrap()), nullable: true };
  if (schema instanceof z.ZodOptional) return toJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return toJsonSchema(schema.removeDefault());
  if (schema instanceof z.ZodEffects) return toJsonSchema(schema.innerType());

  throw new Error(`toJsonSchema: unsupported Zod type ${schema.constructor.name}`);
}

function isOptional(schema: ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}
