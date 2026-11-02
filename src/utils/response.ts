import type { ToolResponse } from "../tools/definitions/definition_type";
import type { ToolErrorPayload } from "./errors";

/**
 * MCP `CallToolResult.structuredContent` must be a JSON **object** (record of string keys).
 * Zod validates it as `z.record(z.string(), z.unknown())` — a top-level **array** fails with
 * "expected record, received array". Primitives and `null` are also invalid as the root value.
 *
 * `content[0].text` carries the same payload as compact JSON for clients that ignore
 * `structuredContent` (spec backwards-compatibility); compact keeps token usage low.
 */
function toStructuredContentRecord(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { data };
}

const TIMESTAMP_FIELDS = new Set(["createdAt", "updatedAt"]);

function transformTimestamps(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(transformTimestamps);
  }
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => {
        if (TIMESTAMP_FIELDS.has(key) && typeof value === "number") {
          // Upstream mixes seconds and milliseconds; anything past year ~5138 in seconds is ms.
          const ms = value > 1e11 ? value : value * 1000;
          return [key, new Date(ms).toISOString()];
        }
        return [key, transformTimestamps(value)];
      }),
    );
  }
  return data;
}

export function ok(data: unknown): ToolResponse {
  const structured = toStructuredContentRecord(transformTimestamps(data));
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
    isError: false,
  };
}

/**
 * Error results carry only text content (no `structuredContent`) so clients never try to
 * validate them against the tool's success `outputSchema`.
 */
export function toolError(payload: ToolErrorPayload, meta?: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: payload }) }],
    isError: true,
    ...(meta ? { _meta: meta } : {}),
  };
}
