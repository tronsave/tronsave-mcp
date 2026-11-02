import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVE_KEYS, redactSensitive } from "../../src/utils/redact";

describe("redactSensitive", () => {
  it("redacts nested sensitive keys case-insensitively", () => {
    const input = {
      user: { ApiKey: "secret-key", name: "ok" },
      items: [{ Signature: "sig", id: 1 }],
    };
    const out = redactSensitive(input, DEFAULT_SENSITIVE_KEYS) as Record<string, unknown>;
    expect(out.user).toEqual({ ApiKey: "[REDACTED]", name: "ok" }); // key casing preserved, match is case-insensitive
    expect((out.items as unknown[])[0]).toEqual({ Signature: "[REDACTED]", id: 1 });
  });

  it("redacts mixed-case authorization and mcp-session-id", () => {
    const out = redactSensitive(
      { Authorization: "Bearer x", "MCP-Session-Id": "sess" },
      DEFAULT_SENSITIVE_KEYS,
    ) as Record<string, unknown>;
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out["MCP-Session-Id"]).toBe("[REDACTED]");
  });

  it("does not crash on circular references", () => {
    const a: Record<string, unknown> = { ok: 1 };
    a.self = a;
    const out = redactSensitive(a, DEFAULT_SENSITIVE_KEYS) as Record<string, unknown>;
    expect(out.ok).toBe(1);
    expect(out.self).toBe("[REDACTED]");
  });
});
