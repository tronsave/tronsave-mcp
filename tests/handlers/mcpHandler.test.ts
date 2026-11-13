import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import z from "zod";
import { buildContainer } from "../../src/app/container";
import { runShutdown } from "../../src/app/shutdown";
import { parseEnv } from "../../src/config/env";
import { createMcpApp } from "../../src/handlers/mcpHandler";
import type { ToolDefinition } from "../../src/tools/definitions/definition_type";

const createUrl = (server: Server, pathname: string): string => {
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}${pathname}`;
};

const parseJsonRpcResponse = async <T>(response: Response): Promise<T> => {
  const bodyText = await response.text();
  if (bodyText.trim().startsWith("{")) {
    return JSON.parse(bodyText) as T;
  }

  // Streamable HTTP may use SSE framing:
  // event: message
  // data: {"jsonrpc":"2.0", ...}
  const dataLine = bodyText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`Expected JSON-RPC payload in response body, got: ${bodyText}`);
  }
  return JSON.parse(dataLine.slice("data:".length).trim()) as T;
};

describe("mcp operational endpoints", () => {
  afterEach(async () => {
    await runShutdown();
  });

  it("GET /healthz returns static liveness", async () => {
    const container = buildContainer(parseEnv({ NODE_ENV: "test", MCP_PORT: "3000" }));
    const app = createMcpApp(container, []);
    const server = app.listen(0);

    try {
      const res = await fetch(createUrl(server, "/healthz"));
      const body = (await res.json()) as { status: string };
      expect(res.status).toBe(200);
      expect(body.status).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("GET /readyz returns 503 when redis ping fails", async () => {
    const container = buildContainer(parseEnv({ NODE_ENV: "test", MCP_PORT: "3000" }));
    vi.spyOn(container.redisService, "ping").mockRejectedValueOnce(new Error("redis down"));
    const app = createMcpApp(container, []);
    const server = app.listen(0);

    try {
      const res = await fetch(createUrl(server, "/readyz"));
      const body = (await res.json()) as { status: string };
      expect(res.status).toBe(503);
      expect(body.status).toBe("not_ready");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("POST /mcp keeps streamable session state across initialize and tools/list", async () => {
    const container = buildContainer(parseEnv({ NODE_ENV: "test", MCP_PORT: "3000" }));
    const echoTool: ToolDefinition = {
      name: "test_echo",
      title: "test_echo",
      description: "Test tool for MCP streamable-session state.",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ echoed: z.string() }),
      auth: { mode: "public" },
      handler: async (input) => ({ echoed: String(input.value) }),
    };
    const app = createMcpApp(container, [echoTool]);
    const server = app.listen(0);

    try {
      const url = createUrl(server, "/mcp");
      const commonHeaders = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };

      const initResponse = await fetch(url, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "vitest-client", version: "1.0.0" },
          },
        }),
      });
      expect(initResponse.status).toBe(200);
      const mcpSessionId = initResponse.headers.get("mcp-session-id");
      expect(mcpSessionId).toBeTruthy();

      const initializedResponse = await fetch(url, {
        method: "POST",
        headers: {
          ...commonHeaders,
          "mcp-session-id": mcpSessionId ?? "",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }),
      });
      expect(initializedResponse.status).toBeGreaterThanOrEqual(200);
      expect(initializedResponse.status).toBeLessThan(300);

      const callResponse = await fetch(url, {
        method: "POST",
        headers: {
          ...commonHeaders,
          "mcp-session-id": mcpSessionId ?? "",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-tool",
          method: "tools/call",
          params: {
            name: "test_echo",
            arguments: { value: "ok" },
          },
        }),
      });
      expect(callResponse.status).toBe(200);
      const listBody = await parseJsonRpcResponse<{
        error?: { message?: string };
        result?: Record<string, unknown>;
      }>(callResponse);
      expect(listBody.error).toBeUndefined();
      expect(listBody.result).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("advertises PUBLIC_BASE_URL on /.well-known/mcp.json and /llms.txt", async () => {
    const configured = "https://preview.tronsave.io";
    const container = buildContainer(
      parseEnv({ NODE_ENV: "test", MCP_PORT: "3000", PUBLIC_BASE_URL: configured }),
    );
    const app = createMcpApp(container, []);
    const server = app.listen(0);
    try {
      const card = (await (await fetch(createUrl(server, "/.well-known/mcp.json"))).json()) as {
        endpoints: Record<string, string>;
        authorization?: { type: string; metadata: string };
      };
      expect(card.endpoints).toEqual({
        mainnet: `${configured}/mcp`,
        testnet: `${configured}/testnet/mcp`,
        oauthMainnet: `${configured}/oauth/mcp`,
        oauthTestnet: `${configured}/oauth/testnet/mcp`,
      });
      expect(card.authorization).toEqual({
        type: "oauth2",
        metadata: `${configured}/.well-known/oauth-authorization-server`,
      });
      const llms = await (await fetch(createUrl(server, "/llms.txt"))).text();
      expect(llms).toContain(`POST ${configured}/mcp (mainnet)`);
      expect(llms).toContain(`POST ${configured}/oauth/mcp (mainnet)`);
      expect(llms).toContain(`${configured}/.well-known/oauth-authorization-server`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("advertises the production origin when PUBLIC_BASE_URL is unset", async () => {
    const container = buildContainer(parseEnv({ NODE_ENV: "test", MCP_PORT: "3000" }));
    const app = createMcpApp(container, []);
    const server = app.listen(0);
    try {
      const card = (await (await fetch(createUrl(server, "/.well-known/mcp.json"))).json()) as {
        endpoints: Record<string, string>;
        authorization?: unknown;
      };
      expect(card.endpoints).toEqual({
        mainnet: "https://mcp.tronsave.io/mcp",
        testnet: "https://mcp.tronsave.io/testnet/mcp",
      });
      expect(card.authorization).toBeUndefined();
      const llms = await (await fetch(createUrl(server, "/llms.txt"))).text();
      expect(llms).toContain("POST https://mcp.tronsave.io/mcp (mainnet)");
      expect(llms).toContain("POST https://mcp.tronsave.io/testnet/mcp (testnet)");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
