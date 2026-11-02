import type { Server } from "node:http";
import { buildContainer } from "./app/container";
import { registerDisposer, runShutdown } from "./app/shutdown";
import { env } from "./config/env";
import { createMcpApp } from "./handlers/mcpHandler";
import { createAllTools } from "./tools";
import { createHelper } from "./tools/handlers/helper";
import { createInternalHandlers } from "./tools/handlers/internal";
import { createPlatformHandlers } from "./tools/handlers/platform";
import { logger } from "./utils/logger";

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const bootstrap = async (): Promise<void> => {
  const container = buildContainer(env);
  const helper = createHelper(container);
  const internalHandlers = createInternalHandlers(helper);
  const platformHandlers = createPlatformHandlers(container, helper);
  const tools = createAllTools(platformHandlers, internalHandlers);

  const app = createMcpApp(container, tools);
  const server = app.listen(env.MCP_PORT, () => {
    logger.info("TronSave MCP streamable server started", {
      port: env.MCP_PORT,
      name: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
    });
  });

  registerDisposer(async () => closeServer(server));
  registerDisposer(async () => container.redisService.disconnect());

  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("Shutting down server");
    await runShutdown();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
};

bootstrap().catch(async (error) => {
  logger.error("Failed to bootstrap server", { error: String(error) });
  await runShutdown();
  process.exit(1);
});
