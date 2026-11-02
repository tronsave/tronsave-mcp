import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env";

describe("parseEnv", () => {
  it("applies defaults when optional vars are omitted", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      MCP_PORT: "3000",
      REDIS_URL: "redis://localhost:6379",
    });
    expect(env.GRAPHQL_TIMEOUT_MS).toBe(10_000);
    expect(env.REST_TIMEOUT_MS).toBe(10_000);
    expect(env.REST_RETRIES).toBe(2);
    expect(env.SIGN_MESSAGE_TTL_SECONDS).toBe(300);
    expect(env.SESSION_TTL_SECONDS).toBe(86_400);
    expect(env.AUTH_VERIFY_CACHE_TTL_SECONDS).toBe(60);
    expect(env.READINESS_UPSTREAM_TIMEOUT_MS).toBe(2_000);
    expect(env.MCP_SERVER_NAME).toBe("TronSave MCP Server");
  });

  it("throws on invalid LOG_LEVEL", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "test",
        MCP_PORT: "3000",
        LOG_LEVEL: "not-a-level",
      }),
    ).toThrow(/Invalid environment variables/);
  });
});
