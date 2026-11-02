import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TronWeb } from "tronweb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContainer, type AppContainer } from "../../src/app/container";
import { runShutdown } from "../../src/app/shutdown";
import { parseEnv } from "../../src/config/env";
import { createMcpApp } from "../../src/handlers/mcpHandler";
import { createAllTools } from "../../src/tools";
import { createHelper } from "../../src/tools/handlers/helper";
import { createInternalHandlers } from "../../src/tools/handlers/internal";
import { createPlatformHandlers } from "../../src/tools/handlers/platform";
import { AppError } from "../../src/utils/errors";

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const REDIRECT_URI = "http://127.0.0.1:9/callback";

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

describe("built-in OAuth 2.1 authorization server", () => {
  let container: AppContainer;
  let server: Server;
  let base: string;

  const rpc = async (path: string, method: string, params: Record<string, unknown>, headers: Record<string, string>) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { ...MCP_HEADERS, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : {} };
  };

  const initialize = (path: string, headers: Record<string, string>) =>
    rpc(path, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, headers);

  const callTool = async (path: string, name: string, headers: Record<string, string>) => {
    const init = await initialize(path, headers);
    const sessionId = init.res.headers.get("mcp-session-id") ?? "";
    return rpc(path, "tools/call", { name, arguments: {} }, { ...headers, "mcp-session-id": sessionId });
  };

  const register = async () => {
    const res = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test <script>alert(1)</script>",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { client_id: string };
  };

  /** Runs /authorize, returns the sign-in page html and its request id. */
  const startAuthorize = async (clientId: string, challenge: string, resourcePath = "/oauth/mcp") => {
    const url = new URL(`${base}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "st-123",
      resource: `${base}${resourcePath}`,
    }).toString();
    const res = await fetch(url, { redirect: "manual" });
    const html = await res.text();
    expect(res.status).toBe(200);
    const requestId = /name="request_id" value="([^"]+)"/.exec(html)?.[1] ?? "";
    return { html, requestId, res };
  };

  const signIn = (fields: Record<string, string>) =>
    fetch(`${base}/oauth/signin`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      redirect: "manual",
    });

  const token = async (fields: Record<string, string>) => {
    const res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
    return { status: res.status, body: (await res.json()) as Record<string, string> };
  };

  /** Full authorization-code flow with an API key; returns the token response. */
  const linkWithApiKey = async (resourcePath = "/oauth/mcp") => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const { requestId } = await startAuthorize(client.client_id, challenge, resourcePath);
    const signin = await signIn({ request_id: requestId, method: "apikey", api_key: "good-key" });
    const location = new URL(signin.headers.get("location") ?? "");
    const tokens = await token({
      grant_type: "authorization_code",
      code: location.searchParams.get("code") ?? "",
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      resource: `${base}${resourcePath}`,
    });
    return { client, tokens, location };
  };

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    container = buildContainer(parseEnv({ NODE_ENV: "test", MCP_PORT: String(port), PUBLIC_BASE_URL: base }));
    const helper = createHelper(container);
    const tools = createAllTools(createPlatformHandlers(container, helper), createInternalHandlers(helper));
    server = createMcpApp(container, tools).listen(port);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runShutdown();
  });

  const mockApiKeyVerification = () =>
    vi.spyOn(container.authService, "verifyApiKey").mockImplementation(async (key: string) => {
      if (key !== "good-key") {
        throw new AppError("Invalid API key", 401, "INVALID_API_KEY");
      }
      return { verifiedAt: 1 };
    });

  it("publishes authorization-server and protected-resource metadata", async () => {
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: `${base}/`,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ["S256"],
    });
    for (const path of ["/mcp", "/testnet/mcp", "/oauth/mcp", "/oauth/testnet/mcp"]) {
      const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource${path}`)).json()) as Record<string, unknown>;
      expect(prm).toMatchObject({ resource: `${base}${path}`, authorization_servers: [as.issuer] });
    }
  });

  it("advertises the OAuth endpoints in /.well-known/mcp.json and /llms.txt", async () => {
    const card = (await (await fetch(`${base}/.well-known/mcp.json`)).json()) as {
      endpoints: Record<string, string>;
      authorization?: { type: string; metadata: string };
    };
    expect(card.endpoints).toMatchObject({
      oauthMainnet: "https://mcp.tronsave.io/oauth/mcp",
      oauthTestnet: "https://mcp.tronsave.io/oauth/testnet/mcp",
    });
    expect(card.authorization?.type).toBe("oauth2");
    expect(await (await fetch(`${base}/llms.txt`)).text()).toContain("/oauth/mcp (mainnet)");
  });

  it("challenges unauthenticated requests on /oauth/mcp with RFC 9728 metadata", async () => {
    const { res } = await initialize("/oauth/mcp", {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/oauth/mcp"`,
    );
  });

  it("keeps /mcp open and adds an account-linking challenge to auth errors", async () => {
    const { body } = await callTool("/mcp", "tronsave_get_internal_account", {});
    expect(body.result.isError).toBe(true);
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  it("escapes the client name and re-renders the sign-in page on bad credentials", async () => {
    mockApiKeyVerification();
    const client = await register();
    const { html, requestId, res } = await startAuthorize(client.client_id, pkce().challenge);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

    const bad = await signIn({ request_id: requestId, method: "apikey", api_key: "wrong" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Invalid API key");
  });

  it("links an API key: code → tokens → authenticated MCP calls", async () => {
    mockApiKeyVerification();
    const restRequest = vi.spyOn(container.clientsByNetwork.mainnet.restClient, "request").mockResolvedValue({
      data: { id: "acc", balance: "7000000", representAddress: "T", depositAddress: "T" },
    } as never);
    const { tokens, location, client } = await linkWithApiKey();
    expect(location.searchParams.get("state")).toBe("st-123");
    expect(tokens.status).toBe(200);
    expect(tokens.body.access_token).toMatch(/^tsv_at_/);
    expect(tokens.body.refresh_token).toMatch(/^tsv_rt_/);

    const bearer = { authorization: `Bearer ${tokens.body.access_token}` };
    const status = await callTool("/oauth/mcp", "tronsave_get_session_status", bearer);
    expect(status.body.result.structuredContent).toMatchObject({ authenticated: true, authMode: "api-key", source: "oauth" });

    const account = await callTool("/oauth/mcp", "tronsave_get_internal_account", bearer);
    expect(account.body.result.structuredContent.balance).toBe("7000000");
    expect((restRequest.mock.calls.at(-1)?.[1] as { headers: Record<string, string> }).headers.apikey).toBe("good-key");

    // Refresh rotates: the old refresh token cannot be used twice.
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
      client_id: client.client_id,
    });
    expect(refreshed.status).toBe(200);
    const reused = await token({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token, client_id: client.client_id });
    expect(reused.status).toBe(400);

    // Revocation cuts access immediately.
    const revoke = await fetch(`${base}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshed.body.access_token, client_id: client.client_id }).toString(),
    });
    expect(revoke.status).toBe(200);
    const after = await initialize("/oauth/mcp", { authorization: `Bearer ${refreshed.body.access_token}` });
    expect(after.res.status).toBe(401);
    expect(after.res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("rejects authorization-code replay and wrong PKCE verifiers", async () => {
    mockApiKeyVerification();
    const client = await register();
    const { verifier, challenge } = pkce();
    const { requestId } = await startAuthorize(client.client_id, challenge);
    const signin = await signIn({ request_id: requestId, method: "apikey", api_key: "good-key" });
    const code = new URL(signin.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchange = (codeVerifier: string) =>
      token({ grant_type: "authorization_code", code, code_verifier: codeVerifier, client_id: client.client_id, redirect_uri: REDIRECT_URI });

    expect((await exchange(pkce().verifier)).status).toBe(400);
    expect((await exchange(verifier)).status).toBe(200);
    expect((await exchange(verifier)).status).toBe(400);
  });

  it("binds tokens to the network of the resource", async () => {
    mockApiKeyVerification();
    const { tokens } = await linkWithApiKey("/oauth/mcp");
    const wrongNetwork = await initialize("/oauth/testnet/mcp", { authorization: `Bearer ${tokens.body.access_token}` });
    expect(wrongNetwork.res.status).toBe(401);
  });

  it("links a TRON wallet signed in the browser", async () => {
    vi.spyOn(container.clientsByNetwork.mainnet.graphqlClient, "request").mockResolvedValue({
      user: { internalAcc: { apiKey: "wallet-key" } },
    } as never);
    const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
    const account = await tronWeb.createAccount();
    const client = await register();
    const { verifier, challenge } = pkce();
    const { html, requestId } = await startAuthorize(client.client_id, challenge);
    const sign = JSON.parse(/var sign = (\{[^;]+\});/.exec(html)?.[1] ?? "{}") as { message: string; timestamp: number };
    const signature = await tronWeb.trx.signMessageV2(sign.message, account.privateKey);

    const signin = await signIn({ request_id: requestId, method: "wallet", signature: `${signature}_${sign.timestamp}` });
    expect(signin.status).toBe(302);
    const code = new URL(signin.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const tokens = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
    });
    const status = await callTool("/oauth/mcp", "tronsave_get_session_status", {
      authorization: `Bearer ${tokens.body.access_token}`,
    });
    expect(status.body.result.structuredContent).toMatchObject({
      authMode: "signature",
      source: "oauth",
      walletAddress: account.address.base58,
      hasInternalApiKey: true,
    });
  });

  it("returns access_denied to the client when the user cancels", async () => {
    const client = await register();
    const { requestId } = await startAuthorize(client.client_id, pkce().challenge);
    const deny = await signIn({ request_id: requestId, method: "deny" });
    const location = new URL(deny.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("st-123");
  });
});
