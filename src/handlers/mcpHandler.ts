import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AppContainer } from "../app/container";
import { registerDisposer } from "../app/shutdown";
import type { ToolDefinition } from "../tools/definitions/definition_type";
import { withRequestContext } from "./authContext";
import { registerTools } from "../tools";
import { registerAgentGuide, SERVER_INSTRUCTIONS } from "../mcp/agentGuide";
import { logger } from "../utils/logger";
import { metrics, renderMetrics } from "../utils/metrics";
import { safeEqual } from "../utils/crypto";
import { AppError } from "../utils/errors";
import { toRequestIdentityLog } from "../utils/requestIdentity";
import { NETWORK_ENDPOINTS, type Network } from "../config/constants";
import { TronSaveOAuthProvider } from "../oauth/provider";
import { createOAuthRouter, protectedResourceMetadataUrl } from "../oauth/router";

interface LegacySessionTransport {
  transport: SSEServerTransport;
  server: McpServer;
  createdAt: number;
}

/**
 * Re-attaches a fresh transport to an existing MCP session id so any replica (or a restarted
 * process) can serve it. The SDK exposes no public API for this; the field names are locked
 * by `tests/handlers/mcpHandler.test.ts` so an SDK upgrade that renames them fails CI.
 */
export const rehydrateTransport = (transport: StreamableHTTPServerTransport, sessionId: string): void => {
  const inner = (transport as unknown as { _webStandardTransport?: { sessionId?: string; _initialized?: boolean } })
    ._webStandardTransport;
  if (!inner || !("_initialized" in inner)) {
    throw new Error("Unsupported MCP SDK transport internals: cannot rehydrate session");
  }
  inner.sessionId = sessionId;
  inner._initialized = true;
};

/** Logo shown by clients and registries; served from the public repository. */
export const SERVER_ICON_URL = "https://raw.githubusercontent.com/tronsave/tronsave-mcp/main/assets/logo/tronsave-icon-512.png";

/** One MCP server with every tool, the agent guide and the server instructions (HTTP and stdio share it). */
export const createMcpServer = (container: AppContainer, tools: ToolDefinition[]): McpServer => {
  const server = new McpServer(
    {
      name: container.env.MCP_SERVER_NAME,
      title: "TronSave",
      version: container.env.MCP_SERVER_VERSION,
      description: "Rent TRON energy and bandwidth on the TronSave market: quotes, orders, auto-buy/auto-sell and account tools.",
      websiteUrl: "https://tronsave.io",
      icons: [{ src: SERVER_ICON_URL, mimeType: "image/png", sizes: ["512x512"] }],
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, tools);
  registerAgentGuide(server);
  return server;
};

const getSessionHeader = (req: Request): string | undefined => {
  const header = req.headers["mcp-session-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const containsInitialize = (body: unknown): boolean =>
  Array.isArray(body) ? body.some((message) => isInitializeRequest(message)) : isInitializeRequest(body);

const sendJsonRpcError = (res: Response, status: number, code: number, message: string): void => {
  if (!res.headersSent) {
    res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
  }
};

/**
 * Streamable HTTP is served statelessly per request (ADR 004): every POST builds a new
 * McpServer + transport and disposes it when the response closes. Session continuity lives
 * in Redis (transport marker + login), so restarts and multiple replicas are transparent to
 * clients and no per-session memory accumulates.
 */
export const createMcpApp = (container: AppContainer, tools: ToolDefinition[]) => {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.set("trust proxy", container.env.TRUST_PROXY);
  const baseUrl = container.env.PUBLIC_BASE_URL;
  if (baseUrl) {
    const provider = new TronSaveOAuthProvider(container.oauthStore, container.signatureService);
    app.use(createOAuthRouter(container, container.oauthStore, provider, baseUrl));
  }
  const legacyTransports: Record<string, LegacySessionTransport> = {};
  let quickstartMarkdownCache: string | null = null;
  let connectMarkdownCache: string | null = null;

  // Origin advertised to crawlers and registries. Matches the OAuth issuer when PUBLIC_BASE_URL is set.
  const PUBLIC_BASE_URL = baseUrl ?? "https://mcp.tronsave.io";
  const firstSentence = (text: string): string => {
    const end = text.indexOf(". ");
    return (end === -1 ? text : text.slice(0, end + 1)).trim();
  };
  // Built once: an `llms.txt`-style capability map for AI crawlers/agents (https://llmstxt.org).
  const llmsTxt = [
    `# ${container.env.MCP_SERVER_NAME}`,
    "",
    "> MCP server for the TronSave resource market: buy, sell, and extend TRON ENERGY/BANDWIDTH via typed tools over Streamable HTTP.",
    "",
    `Transport: Streamable HTTP. Endpoints: POST ${PUBLIC_BASE_URL}/mcp (mainnet), POST ${PUBLIC_BASE_URL}/testnet/mcp (testnet).`,
    ...(baseUrl
      ? [
          `OAuth 2.1 sign-in (API key or TRON wallet): POST ${PUBLIC_BASE_URL}/oauth/mcp (mainnet), POST ${PUBLIC_BASE_URL}/oauth/testnet/mcp (testnet); authorization server metadata at ${PUBLIC_BASE_URL}/.well-known/oauth-authorization-server.`,
        ]
      : []),
    "",
    SERVER_INSTRUCTIONS,
    "",
    `## Tools (${tools.length})`,
    ...tools.map((t) => `- \`${t.name}\` (${t.auth.mode}) — ${firstSentence(t.description)}`),
    "",
    "## Docs",
    "- https://docs.tronsave.io/developers/api-reference/mcp",
    `- Quickstart: ${PUBLIC_BASE_URL}/quickstart.md`,
    `- Setup guide for Claude Code, Cursor and Claude: ${PUBLIC_BASE_URL}/connect.md`,
  ].join("\n");

  const resolveNetworkFromPath = (requestPath: string): Network =>
    requestPath.includes("/testnet/") ? "testnet" : "mainnet";

  /** RFC 6750 / MCP authorization challenge for the MCP endpoint at `requestPath`. */
  const bearerChallenge = (requestPath: string, error?: { code: string; description: string }): string | undefined =>
    baseUrl
      ? [
          `Bearer resource_metadata="${protectedResourceMetadataUrl(baseUrl, requestPath)}"`,
          `scope="tronsave"`,
          ...(error ? [`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`] : []),
        ].join(", ")
      : undefined;

  const sendUnauthorized = (res: Response, challenge: string | undefined, message: string): void => {
    if (challenge) {
      res.set("WWW-Authenticate", challenge);
    }
    sendJsonRpcError(res, 401, -32001, message);
  };

  const janitor = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [sessionId, entry] of Object.entries(legacyTransports)) {
      if (now - entry.createdAt <= container.env.SESSION_TTL_SECONDS) {
        continue;
      }
      delete legacyTransports[sessionId];
      void entry.server.close().catch(() => undefined);
    }
  }, 5 * 60 * 1000);
  janitor.unref();
  registerDisposer(async () => {
    clearInterval(janitor);
    for (const [sessionId, entry] of Object.entries(legacyTransports)) {
      delete legacyTransports[sessionId];
      await entry.server.close().catch(() => undefined);
    }
  });

  const getServer = (): McpServer => createMcpServer(container, tools);

  const resolveAuth = async (req: Request, network: Network) =>
    container.authService.detect(req.headers, network);

  const trackHttp = (route: string, res: Response): void => {
    res.on("finish", () => metrics.httpRequests({ route, status: String(res.statusCode) }));
  };

  const postHandler = async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();
    const network = resolveNetworkFromPath(req.path);
    const requireOAuth = req.path.startsWith("/oauth/");
    trackHttp(req.path, res);
    try {
      const sessionId = getSessionHeader(req);
      const isInitialize = containsInitialize(req.body);

      const auth = await resolveAuth(req, network);
      if (auth.authError?.code === "OAUTH_INVALID_TOKEN") {
        sendUnauthorized(
          res,
          bearerChallenge(req.path, { code: "invalid_token", description: auth.authError.message }),
          auth.authError.message,
        );
        return;
      }
      if (requireOAuth && auth.via !== "oauth") {
        sendUnauthorized(res, bearerChallenge(req.path), "Authorization required: sign in to TronSave via OAuth.");
        return;
      }

      if (!isInitialize) {
        if (!sessionId) {
          sendJsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required. Send `initialize` first.");
          return;
        }
        if (!(await container.sessionService.hasTransportSession(sessionId))) {
          // Spec: unknown/expired session -> 404 so compliant clients re-initialize automatically.
          sendJsonRpcError(res, 404, -32001, "Session not found or expired. Re-send `initialize` (and `tronsave_login` if you were logged in).");
          return;
        }
        void container.sessionService.touchTransportSession(sessionId).catch(() => undefined);
      }

      const caller = toRequestIdentityLog(auth);
      const server = getServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: isInitialize || !sessionId ? () => randomUUID() : () => sessionId,
        enableJsonResponse: true,
        onsessioninitialized: async (newSessionId) => {
          await container.sessionService.registerTransportSession(newSessionId);
        },
      });
      if (!isInitialize && sessionId) {
        rehydrateTransport(transport, sessionId);
      }
      res.on("close", () => {
        void server.close().catch(() => undefined);
      });
      await server.connect(transport);
      const oauthChallenge = bearerChallenge(req.path);
      await withRequestContext({ headers: req.headers, auth, network, oauthChallenge }, async () => {
        await transport.handleRequest(req, res, req.body);
      });

      logger.info("MCP POST handled", {
        path: req.path,
        caller,
        network,
        initialize: isInitialize,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error("MCP POST request failed", { error: String(error) });
      const isConnectionClosed = error instanceof Error && error.message.includes("Connection is closed.");
      if (isConnectionClosed) {
        sendJsonRpcError(res, 503, -32002, "Session store unavailable. Retry shortly.");
      } else if (error instanceof AppError) {
        sendJsonRpcError(res, error.statusCode, -32001, error.message);
      } else {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  };

  const streamHandler = async (_req: Request, res: Response): Promise<void> => {
    res
      .status(405)
      .set("Allow", "POST, DELETE")
      .send("Method Not Allowed: this server does not open a standalone SSE stream; use POST (Streamable HTTP).");
  };

  const deleteHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = getSessionHeader(req);
    if (!sessionId) {
      res.status(400).send("Missing mcp-session-id");
      return;
    }
    try {
      if (!(await container.sessionService.hasTransportSession(sessionId))) {
        res.status(404).send("Unknown MCP session");
        return;
      }
      await container.sessionService.terminateTransportSession(sessionId);
      res.status(200).json({ status: "closed", sessionId });
    } catch (error) {
      logger.error("MCP DELETE failed", { error: String(error) });
      res.status(503).send("Session store unavailable");
    }
  };

  const healthHandler = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({ status: "ok" });
  };

  const readyHandler = async (_req: Request, res: Response): Promise<void> => {
    try {
      const redisPing = await container.redisService.ping();
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), container.env.READINESS_UPSTREAM_TIMEOUT_MS);
      let upstreamReachable = false;
      try {
        const upstream = await fetch(NETWORK_ENDPOINTS.mainnet.tronsaveRestBaseUrl, {
          method: "HEAD",
          signal: timeoutController.signal,
        });
        upstreamReachable = upstream.status < 500;
      } catch {
        // Optional upstream probe: do not hard fail readiness if provider rejects HEAD.
        upstreamReachable = false;
      } finally {
        clearTimeout(timer);
      }

      if (redisPing !== "PONG") {
        res.status(503).json({ status: "not_ready", checks: { redis: redisPing, upstreamReachable } });
        return;
      }
      res.status(200).json({ status: "ok", checks: { redis: redisPing, upstreamReachable } });
    } catch (error) {
      res.status(503).json({
        status: "not_ready",
        checks: { redis: "FAILED", upstreamReachable: false },
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const metricsToken = container.env.METRICS_TOKEN;
  const metricsHandler = async (req: Request, res: Response): Promise<void> => {
    if (metricsToken && !safeEqual(req.headers.authorization ?? "", `Bearer ${metricsToken}`)) {
      res.status(401).set("WWW-Authenticate", 'Bearer realm="metrics"').type("text/plain").send("Unauthorized");
      return;
    }
    res.status(200).type("text/plain; version=0.0.4; charset=utf-8").send(renderMetrics());
  };

  const infoHandler = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      name: container.env.MCP_SERVER_NAME,
      version: container.env.MCP_SERVER_VERSION,
      transport: "streamable-http",
      endpoints: {
        mainnet: "/mcp",
        testnet: "/testnet/mcp",
        ...(baseUrl ? { oauthMainnet: "/oauth/mcp", oauthTestnet: "/oauth/testnet/mcp" } : {}),
        legacySse: "/sse",
      },
      oauth: baseUrl ? { issuer: baseUrl, metadata: `${baseUrl}/.well-known/oauth-authorization-server` } : null,
      tools: tools.length,
      docs: "/quickstart",
      connect: "/connect",
    });
  };

  const legacySseGetHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const transport = new SSEServerTransport("/messages", res);
      const server = getServer();
      legacyTransports[transport.sessionId] = {
        transport,
        server,
        createdAt: Math.floor(Date.now() / 1000),
      };
      transport.onclose = () => {
        delete legacyTransports[transport.sessionId];
      };
      await server.connect(transport);
      logger.info("MCP legacy SSE stream opened", { path: req.path });
    } catch (error) {
      logger.error("MCP legacy SSE GET failed", { error: String(error) });
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  };

  const legacySsePostHandler = async (req: Request, res: Response): Promise<void> => {
    const network: Network = "mainnet";
    try {
      const sessionIdRaw = req.query.sessionId;
      const sessionId = Array.isArray(sessionIdRaw) ? sessionIdRaw[0] : sessionIdRaw;
      if (typeof sessionId !== "string" || !sessionId) {
        throw new AppError("Missing sessionId query parameter", 400, "INVALID_MCP_SESSION");
      }
      const legacy = legacyTransports[sessionId];
      if (!legacy) {
        throw new AppError("No SSE session for this sessionId", 404, "INVALID_MCP_SESSION");
      }
      // The SSE session id doubles as the login key so `tronsave_login` works on legacy clients too.
      req.headers["mcp-session-id"] = sessionId;
      const auth = await resolveAuth(req, network);
      await withRequestContext({ headers: req.headers, auth, network }, async () => {
        await legacy.transport.handlePostMessage(req, res, req.body);
      });
    } catch (error) {
      logger.error("MCP legacy SSE POST failed", { error: String(error) });
      if (!res.headersSent) {
        const status = error instanceof AppError ? error.statusCode : 500;
        const message = error instanceof AppError ? error.message : "Internal server error";
        res.status(status).send(message);
      }
    }
  };

  const quickstartMarkdownHandler = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (!quickstartMarkdownCache) {
        quickstartMarkdownCache = await readFile(path.resolve(process.cwd(), "MCP_SERVER_QUICKSTART.md"), "utf8");
      }
      res.status(200).type("text/markdown; charset=utf-8").send(quickstartMarkdownCache);
    } catch (error) {
      logger.error("Quickstart markdown endpoint failed", { error: String(error) });
      res.status(500).json({ error: "Unable to load quickstart markdown" });
    }
  };

  // End-user setup guide (Claude Code, Cursor, Claude) at a shareable URL.
  const connectMarkdownHandler = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (!connectMarkdownCache) {
        connectMarkdownCache = await readFile(path.resolve(process.cwd(), "docs/CONNECT.md"), "utf8");
      }
      res.status(200).type("text/markdown; charset=utf-8").send(connectMarkdownCache);
    } catch (error) {
      logger.error("Connect guide endpoint failed", { error: String(error) });
      res.status(500).json({ error: "Unable to load connect guide" });
    }
  };

  const llmsTxtHandler = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).type("text/plain; charset=utf-8").send(llmsTxt);
  };

  // Machine-readable server metadata for automated MCP discovery (endpoints, capabilities, tool list).
  const wellKnownMcpHandler = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      name: "io.github.tronsave/mcp",
      title: "TronSave MCP",
      version: container.env.MCP_SERVER_VERSION,
      description:
        "MCP server for the TronSave resource market: buy, sell, and extend TRON ENERGY/BANDWIDTH via typed tools over Streamable HTTP.",
      instructions: SERVER_INSTRUCTIONS,
      transport: "streamable-http",
      endpoints: {
        mainnet: `${PUBLIC_BASE_URL}/mcp`,
        testnet: `${PUBLIC_BASE_URL}/testnet/mcp`,
        ...(baseUrl ? { oauthMainnet: `${PUBLIC_BASE_URL}/oauth/mcp`, oauthTestnet: `${PUBLIC_BASE_URL}/oauth/testnet/mcp` } : {}),
      },
      ...(baseUrl
        ? { authorization: { type: "oauth2", metadata: `${PUBLIC_BASE_URL}/.well-known/oauth-authorization-server` } }
        : {}),
      documentation: "https://docs.tronsave.io/developers/api-reference/mcp",
      tools: tools.map((t) => t.name),
    });
  };

  app.post("/mcp", postHandler);
  app.get("/mcp", streamHandler);
  app.delete("/mcp", deleteHandler);
  app.post("/testnet/mcp", postHandler);
  app.get("/testnet/mcp", streamHandler);
  app.delete("/testnet/mcp", deleteHandler);
  if (baseUrl) {
    app.post("/oauth/mcp", postHandler);
    app.get("/oauth/mcp", streamHandler);
    app.delete("/oauth/mcp", deleteHandler);
    app.post("/oauth/testnet/mcp", postHandler);
    app.get("/oauth/testnet/mcp", streamHandler);
    app.delete("/oauth/testnet/mcp", deleteHandler);
  }
  app.get("/", infoHandler);
  app.get("/quickstart", quickstartMarkdownHandler);
  app.get("/quickstart.md", quickstartMarkdownHandler);
  app.get("/connect", connectMarkdownHandler);
  app.get("/connect.md", connectMarkdownHandler);
  app.get("/llms.txt", llmsTxtHandler);
  app.get("/.well-known/mcp.json", wellKnownMcpHandler);
  app.get("/healthz", healthHandler);
  app.get("/readyz", readyHandler);
  app.get("/metrics", metricsHandler);
  app.get("/sse", legacySseGetHandler);
  app.post("/messages", legacySsePostHandler);

  return app;
};
