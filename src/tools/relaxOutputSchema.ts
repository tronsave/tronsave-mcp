import { z } from "zod";

/**
 * Returns a copy of an output schema where every object field is optional + nullable and
 * every object accepts unknown keys; leaf types and descriptions are preserved.
 *
 * Why: the MCP SDK validates `structuredContent` against the registered `outputSchema` AFTER
 * the handler ran. If TronSave adds/omits/nulls a field, a strict schema turns a successful
 * write (order created, key revoked) into a reported failure, and an agent may then repeat
 * it. Advertised field names, types and docs stay intact for `tools/list`; only presence
 * and null-ness are relaxed. A real type change (string → number) still fails loudly.
 */
export const relaxOutputSchema = <T extends z.ZodTypeAny>(schema: T): z.ZodTypeAny => relax(schema);

const withDescription = (next: z.ZodTypeAny, from: z.ZodTypeAny): z.ZodTypeAny =>
  from.description ? next.describe(from.description) : next;

const relax = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return withDescription(relax(schema.unwrap() as z.ZodTypeAny), schema);
  }
  if (schema instanceof z.ZodDefault) {
    return withDescription(relax(schema.unwrap() as z.ZodTypeAny), schema);
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      const inner = relax(field);
      shape[key] = withDescription(inner.nullable().optional(), field);
    }
    return withDescription(z.looseObject(shape), schema);
  }
  if (schema instanceof z.ZodArray) {
    return withDescription(z.array(relax(schema.element as z.ZodTypeAny)), schema);
  }
  return schema;
};
