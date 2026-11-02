/** Default keys whose values must never appear verbatim in logs (case-insensitive match on object keys). */
export const DEFAULT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "apikey",
  "signature",
  "signedtx",
  "paymentsignedtx",
  "authorization",
  "x-api-key",
  "mcp-session-id",
]);

const REDACTED = "[REDACTED]" as const;

const normalizeKey = (key: string): string => key.toLowerCase();

/**
 * Deep-clones JSON-like structures while replacing sensitive field values.
 * Uses a `WeakSet` for object identity so circular graphs do not infinite-loop.
 */
export function redactSensitive(
  value: unknown,
  sensitiveKeys: ReadonlySet<string> = DEFAULT_SENSITIVE_KEYS,
): unknown {
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) {
      return v;
    }
    if (typeof v !== "object") {
      return v;
    }
    if (seen.has(v)) {
      return REDACTED;
    }
    seen.add(v);

    if (Array.isArray(v)) {
      return v.map((item) => walk(item));
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(v as Record<string, unknown>)) {
      if (sensitiveKeys.has(normalizeKey(key))) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  };

  return walk(value);
}
