import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAllTools } from "../../src/tools";

type JsonSchema = {
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
};

const handlers = new Proxy({}, { get: () => async () => ({ content: [], structuredContent: {} }) }) as never;

const undescribed = (schema: JsonSchema, path: string, out: string[]): string[] => {
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!child.description) out.push(`${path}.${key}`);
    undescribed(child, `${path}.${key}`, out);
  }
  if (schema.items) undescribed(schema.items, `${path}[]`, out);
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    undescribed(branch, path, out);
  }
  return out;
};

// Registries (Glama TDQS) and agents read these descriptions to fill arguments; an
// undescribed parameter, even a nested one, is a guess for the model.
describe("tool input descriptions", () => {
  it("describes every input parameter, including nested fields", () => {
    const missing = createAllTools(handlers, handlers).flatMap((tool) =>
      undescribed(z.toJSONSchema(tool.inputSchema, { io: "input" }) as JsonSchema, tool.name, []),
    );
    expect(missing).toEqual([]);
  });
});
