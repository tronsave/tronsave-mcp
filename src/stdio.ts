import "./stdio/prelude";
import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildContainer } from "./app/container";
import { registerDisposer, runShutdown } from "./app/shutdown";
import { env } from "./config/env";
import { AUTH_HEADER_PREFIX } from "./config/constants";
import { withRequestContext } from "./handlers/authContext";
import { createMcpServer } from "./handlers/mcpHandler";
import { createAllTools } from "./tools";
import { createHelper } from "./tools/handlers/helper";
import { createInternalHandlers } from "./tools/handlers/internal";
import { createPlatformHandlers } from "./tools/handlers/platform";
import { logger } from "./utils/logger";

/**
 * Local stdio entrypoint (`node dist/stdio.js`): the same tools as the hosted server, for one
 * client. The process is one MCP session, so a fixed session id carries `tronsave_login`, and
 * `TRONSAVE_API_KEY` stands in for the `Authorization` header.
 */
const bootstrap = async (): Promise<void> => {
  const container = buildContainer(env);
  const helper = createHelper(container);
  const tools = createAllTools(createPlatformHandlers(container, helper), createInternalHandlers(helper));
  const server = createMcpServer(container, tools);
  const network = env.TRONSAVE_NETWORK;
  const headers: IncomingHttpHeaders = {
    "mcp-session-id": randomUUID(),
    ...(env.TRONSAVE_API_KEY ? { authorization: `${AUTH_HEADER_PREFIX.apiKey} ${env.TRONSAVE_API_KEY}` } : {}),
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Tool handlers read auth from the request context, so each message runs inside one, resolved
  // fresh (a login changes it). The chain keeps messages in arrival order.
  const dispatch = transport.onmessage;
  let queue = Promise.resolve();
  transport.onmessage = (message) => {
    queue = queue
      .then(async () => {
        const auth = await container.authService.detect(headers, network);
        void withRequestContext({ headers, auth, network }, async () => dispatch?.(message));
      })
      .catch((error) => logger.error("MCP stdio message failed", { error: String(error) }));
  };

  registerDisposer(async () => server.close());
  registerDisposer(async () => container.redisService.disconnect());
  logger.info("TronSave MCP stdio server started", { network, version: env.MCP_SERVER_VERSION });

  const shutdown = async () => {
    await runShutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);
};

bootstrap().catch(async (error) => {
  logger.error("Failed to start stdio server", { error: String(error) });
  await runShutdown();
  process.exit(1);
});
