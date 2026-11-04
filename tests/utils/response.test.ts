import { describe, expect, it } from "vitest";
import { ok, toolError } from "../../src/utils/response";

describe("response.ok", () => {
  it("wraps an object into a CallToolResult with compact JSON text", () => {
    const result = ok({ a: 1, b: "x" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ a: 1, b: "x" });
    expect(result.content).toEqual([{ type: "text", text: '{"a":1,"b":"x"}' }]);
  });

  it("wraps arrays and primitives under `data` (structuredContent must be an object)", () => {
    expect(ok([1, 2]).structuredContent).toEqual({ data: [1, 2] });
    expect(ok("x").structuredContent).toEqual({ data: "x" });
    expect(ok(null).structuredContent).toEqual({ data: null });
  });

  it("converts createdAt/updatedAt from seconds or milliseconds to ISO", () => {
    const seconds = ok({ createdAt: 1_700_000_000 }).structuredContent as { createdAt: string };
    const millis = ok({ nested: [{ updatedAt: 1_700_000_000_000 }] }).structuredContent as {
      nested: Array<{ updatedAt: string }>;
    };
    expect(seconds.createdAt).toBe("2023-11-14T22:13:20.000Z");
    expect(millis.nested[0].updatedAt).toBe("2023-11-14T22:13:20.000Z");
  });
});

describe("response.toolError", () => {
  it("returns isError with a JSON error envelope and no structuredContent", () => {
    const result = toolError({ code: "X", message: "m", retryable: false, hint: "h" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      error: { code: "X", message: "m", retryable: false, hint: "h" },
    });
  });
});
