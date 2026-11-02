import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerTools } from "../../src/tools";
import type { ToolDefinition } from "../../src/tools/definitions/definition_type";
import { withRequestContext } from "../../src/handlers/authContext";
import type { AuthContext } from "../../src/schemas/auth";
import { AppError } from "../../src/utils/errors";

type Runner = (args: unknown, extra: unknown) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const outputSchema = z.object({ ok: z.boolean() });

const buildRunner = (tool: ToolDefinition): Runner => {
  let runner: Runner | undefined;
  const server = {
    registerTool: (_name: string, _meta: unknown, fn: Runner) => {
      runner = fn;
    },
  };
  registerTools(server as never, [tool]);
  return runner!;
};

const baseTool = (
  authMode: ToolDefinition["auth"]["mode"],
  handler: ToolDefinition["handler"] = async () => ({
    content: [{ type: "text", text: "{}" }],
    structuredContent: { ok: true },
    isError: false,
  }),
  readOnly = true,
): ToolDefinition => ({
  name: `tool_${authMode}`,
  title: "tool",
  description: "desc",
  auth: { mode: authMode },
  annotations: { readOnlyHint: readOnly },
  inputSchema: z.object({}),
  outputSchema,
  handler,
});

const call = (tool: ToolDefinition, auth: AuthContext) =>
  withRequestContext({ headers: {}, network: "mainnet", auth }, async () => buildRunner(tool)({}, {}));

const errorOf = (result: Awaited<ReturnType<Runner>>) =>
  (JSON.parse(result.content[0].text) as { error: { code: string; retryable: boolean; hint?: string } }).error;

describe("registerTools auth mode gating", () => {
  it("returns SESSION_REQUIRED tool error for session tool without auth", async () => {
    const result = await call(baseTool("session"), { type: "none" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(errorOf(result)).toMatchObject({ code: "SESSION_REQUIRED", retryable: false });
    expect(errorOf(result).hint).toContain("tronsave_login");
  });

  it("surfaces rejected header credentials instead of a generic auth error", async () => {
    const result = await call(baseTool("session"), {
      type: "none",
      authError: { code: "INVALID_API_KEY", message: "Invalid API key" },
    });
    expect(errorOf(result).code).toBe("INVALID_API_KEY");
  });

  it("accepts a verified ApiKey header for session tools", async () => {
    const result = await call(baseTool("session"), { type: "apiKey", apiKey: "k" });
    expect(result.isError).toBe(false);
  });

  it("rejects signature-session tool for api-key session", async () => {
    const result = await call(baseTool("signature-session"), {
      type: "session",
      sessionId: "s",
      sessionAuthType: "api-key",
      apiKey: "k",
    });
    expect(errorOf(result).code).toBe("INVALID_SESSION_TYPE");
  });

  it("accepts signature-session tool for a verified Signature header", async () => {
    const result = await call(baseTool("signature-session"), {
      type: "signature",
      walletAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      signature: "0xabc_1700000000",
    });
    expect(result.isError).toBe(false);
  });
});

describe("registerTools error envelope", () => {
  it("marks upstream timeouts on writes as non-retryable with a verify hint", async () => {
    const tool = baseTool(
      "public",
      async () => {
        throw new AppError("timed out", 504, "UPSTREAM_TIMEOUT", { retryable: true });
      },
      false,
    );
    const error = errorOf(await call(tool, { type: "none" }));
    expect(error).toMatchObject({ code: "UPSTREAM_TIMEOUT", retryable: false });
    expect(error.hint).toMatch(/verify/i);
  });

  it("keeps upstream timeouts on reads retryable", async () => {
    const tool = baseTool("public", async () => {
      throw new AppError("timed out", 504, "UPSTREAM_TIMEOUT", { retryable: true });
    });
    expect(errorOf(await call(tool, { type: "none" }))).toMatchObject({ code: "UPSTREAM_TIMEOUT", retryable: true });
  });

  it("hides unexpected error details", async () => {
    const tool = baseTool("public", async () => {
      throw new Error("secret stack detail");
    });
    const error = errorOf(await call(tool, { type: "none" }));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("secret stack detail");
  });
});
