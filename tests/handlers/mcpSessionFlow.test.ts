import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildContainer, type AppContainer } from "../../src/app/container";
import { runShutdown } from "../../src/app/shutdown";
import { parseEnv } from "../../src/config/env";
import { createMcpApp, rehydrateTransport } from "../../src/handlers/mcpHandler";
import { createAllTools } from "../../src/tools";
import { createHelper } from "../../src/tools/handlers/helper";
import { createInternalHandlers } from "../../src/tools/handlers/internal";
import { createPlatformHandlers } from "../../src/tools/handlers/platform";

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

type RpcBody = { result?: Record<string, unknown>; error?: { code: number; message: string } };

const buildApp = (container: AppContainer) => {
  const helper = createHelper(container);
  const tools = createAllTools(createPlatformHandlers(container, helper), createInternalHandlers(helper));
  return createMcpApp(container, tools);
};

const start = (container: AppContainer): Promise<{ server: Server; url: string }> =>
  new Promise((resolve) => {
    const server = buildApp(container).listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

const stop = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

const rpc = async (
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ status: number; body: RpcBody; sessionId: string | null }> => {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { ...HEADERS, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as RpcBody) : {}, sessionId: res.headers.get("mcp-session-id") };
};

const initialize = async (url: string, headers: Record<string, string> = {}) => {
  const init = await rpc(
    url,
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1.0.0" } },
    headers,
  );
  expect(init.status).toBe(200);
  expect(init.sessionId).toBeTruthy();
  return { sessionId: init.sessionId as string, result: init.body.result as Record<string, unknown> };
};

const toolText = (body: RpcBody) =>
  JSON.parse(((body.result?.content as Array<{ text: string }>) ?? [])[0]?.text ?? "{}") as Record<string, unknown>;

describe("streamable HTTP session flow", () => {
  let container: AppContainer;

  beforeAll(() => {
    container = buildContainer(parseEnv({ NODE_ENV: "test", MCP_PORT: "3000" }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await runShutdown();
  });

  it("advertises instructions, all tools, the guide resource and prompts", async () => {
    const { server, url } = await start(container);
    try {
      const { sessionId, result } = await initialize(url);
      expect(String(result.instructions)).toContain("tronsave_get_session_status");
      const h = { "mcp-session-id": sessionId };

      const tools = await rpc(url, "tools/list", {}, h);
      const list = tools.body.result?.tools as Array<{
        name: string;
        outputSchema?: { type: string };
        _meta?: Record<string, unknown>;
      }>;
      expect(list).toHaveLength(53);
      expect(list.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
      const authOf = (name: string) => list.find((tool) => tool.name === name)?._meta?.["io.tronsave/auth"];
      expect(authOf("tronsave_login")).toBe("public");
      expect(authOf("tronsave_internal_order_create")).toBe("session");
      expect(authOf("tronsave_create_auto_buy_setting")).toBe("signature-session");

      const resources = await rpc(url, "resources/list", {}, h);
      expect(JSON.stringify(resources.body)).toContain("tronsave://guide/agent");
      const prompts = await rpc(url, "prompts/list", {}, h);
      expect(JSON.stringify(prompts.body)).toContain("buy_resource");
    } finally {
      await stop(server);
    }
  });

  it("keeps a session usable across a process restart / another replica (Redis-backed)", async () => {
    const first = await start(container);
    const { sessionId } = await initialize(first.url);
    await stop(first.server);

    const second = await start(container);
    try {
      const status = await rpc(
        second.url,
        "tools/call",
        { name: "tronsave_get_session_status", arguments: {} },
        { "mcp-session-id": sessionId },
      );
      expect(status.status).toBe(200);
      expect(toolText(status.body)).toMatchObject({ authenticated: false, authMode: "none", network: "mainnet" });
    } finally {
      await stop(second.server);
    }
  });

  it("returns 404 for unknown sessions and after DELETE", async () => {
    const { server, url } = await start(container);
    try {
      const unknown = await rpc(url, "tools/list", {}, { "mcp-session-id": "does-not-exist" });
      expect(unknown.status).toBe(404);

      const { sessionId } = await initialize(url);
      const del = await fetch(`${url}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sessionId } });
      expect(del.status).toBe(200);
      const after = await rpc(url, "tools/list", {}, { "mcp-session-id": sessionId });
      expect(after.status).toBe(404);
    } finally {
      await stop(server);
    }
  });

  it("api-key login binds to the MCP session; logout removes it", async () => {
    const restClient = container.clientsByNetwork.mainnet.restClient;
    const request = vi.spyOn(restClient, "request").mockResolvedValue({
      data: { id: "acc", balance: "5000000", representAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", depositAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", apiKey: "super-secret-api-key" },
    } as never);
    const { server, url } = await start(container);
    try {
      const { sessionId } = await initialize(url);
      const h = { "mcp-session-id": sessionId };

      const denied = await rpc(url, "tools/call", { name: "tronsave_get_internal_account", arguments: {} }, h);
      expect(denied.body.result?.isError).toBe(true);
      expect(toolText(denied.body)).toMatchObject({ error: { code: "SESSION_REQUIRED" } });

      const login = await rpc(url, "tools/call", { name: "tronsave_login", arguments: { apiKey: "login-key-123" } }, h);
      expect(toolText(login.body)).toMatchObject({ authMode: "api-key", hasInternalApiKey: true, sessionId });

      const account = await rpc(url, "tools/call", { name: "tronsave_get_internal_account", arguments: {} }, h);
      const accountBody = account.body.result?.structuredContent as Record<string, unknown>;
      expect(accountBody.balance).toBe("5000000");
      expect(accountBody.apiKey).not.toBe("super-secret-api-key");
      const lastCall = request.mock.calls.at(-1)?.[1] as { headers: Record<string, string> };
      expect(lastCall.headers.apikey).toBe("login-key-123");

      await rpc(url, "tools/call", { name: "tronsave_logout", arguments: {} }, h);
      const status = await rpc(url, "tools/call", { name: "tronsave_get_session_status", arguments: {} }, h);
      expect(toolText(status.body)).toMatchObject({ authenticated: false });
    } finally {
      await stop(server);
    }
  });

  it("accepts a static `Authorization: ApiKey` header without calling tronsave_login", async () => {
    vi.spyOn(container.clientsByNetwork.mainnet.restClient, "request").mockResolvedValue({
      data: { id: "acc", balance: "1", representAddress: "T", depositAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
    } as never);
    const { server, url } = await start(container);
    try {
      const auth = { authorization: "ApiKey header-key-456" };
      const { sessionId } = await initialize(url, auth);
      const deposit = await rpc(
        url,
        "tools/call",
        { name: "tronsave_get_deposit_address", arguments: { amountTrx: 20 } },
        { ...auth, "mcp-session-id": sessionId },
      );
      expect(deposit.body.result?.isError).toBe(false);
      expect(deposit.body.result?.structuredContent).toMatchObject({
        depositAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        amountTrx: 20,
        minimumDepositTrx: 10,
      });
    } finally {
      await stop(server);
    }
  });

  it("does not fail a successful call when upstream omits or nulls fields (relaxed output schema)", async () => {
    vi.spyOn(container.clientsByNetwork.mainnet.graphqlClient, "request").mockResolvedValue({
      orders: { create: { success: true, message: "ok", code: null, data: { orderId: "abc", extra: 1 } } },
    } as never);
    const { server, url } = await start(container);
    try {
      const { sessionId } = await initialize(url, { authorization: "ApiKey k" });
      vi.spyOn(container.authService, "detect").mockResolvedValue({ type: "apiKey", apiKey: "k" });
      const res = await rpc(
        url,
        "tools/call",
        {
          name: "tronsave_create_order",
          arguments: {
            orderResourceType: "ENERGY",
            orderReceiver: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            orderUnitPrice: 60,
            orderDurationSec: 3600,
            orderResourceAmount: 65000,
            paymentMethod: "internal",
            paymentPaymentAmount: 3_900_000,
          },
        },
        { "mcp-session-id": sessionId },
      );
      expect(res.body.result?.isError).toBe(false);
      expect(res.body.result?.structuredContent).toMatchObject({ success: true, data: { orderId: "abc" } });
    } finally {
      await stop(server);
    }
  });
});

describe("rehydrateTransport", () => {
  it("still matches the SDK transport internals (fails loudly on SDK upgrades that rename them)", () => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => "x" });
    rehydrateTransport(transport, "abc");
    expect(transport.sessionId).toBe("abc");
  });
});
