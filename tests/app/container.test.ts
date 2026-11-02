import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/app/container";
import { parseEnv } from "../../src/config/env";
import { createHelper } from "../../src/tools/handlers/helper";

describe("buildContainer", () => {
  it("returns the same service instances on repeated property access", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      REDIS_URL: "redis://localhost:6379",
      MCP_PORT: "3000",
    });
    const c = buildContainer(env);
    expect(c.redisService).toBe(c.redisService);
    expect(c.sessionService).toBe(c.sessionService);
    expect(c.signatureService).toBe(c.signatureService);
    expect(c.authService).toBe(c.authService);
  });

  it("createHelper uses container redis without constructing a new RedisService", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      REDIS_URL: "redis://localhost:6379",
      MCP_PORT: "3000",
    });
    const c = buildContainer(env);
    const helper = createHelper(c);
    expect(helper).toBeDefined();
    expect(typeof helper.fetchApiInternal).toBe("function");
    expect(typeof helper.fetchGraphqlApi).toBe("function");
  });

  it("isolates mainnet vs testnet REST clients", () => {
    const env = parseEnv({ NODE_ENV: "test", MCP_PORT: "3000" });
    const c = buildContainer(env);
    expect(c.clientsByNetwork.mainnet.restClient).not.toBe(c.clientsByNetwork.testnet.restClient);
    expect(c.clientsByNetwork.mainnet.graphqlClient).not.toBe(c.clientsByNetwork.testnet.graphqlClient);
  });
});
