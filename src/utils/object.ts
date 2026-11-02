/**
 * Recursively strips keys with `undefined` values to keep outbound payloads compact
 * and aligned with optional GraphQL/REST contract semantics.
 */
export const stripUndefinedDeep = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) {
      continue;
    }
    const next = stripUndefinedDeep(v);
    if (next !== undefined) {
      out[k] = next;
    }
  }
  return out;
};
