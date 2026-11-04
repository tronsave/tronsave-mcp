import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContainer } from "../../src/app/container";
import { parseEnv } from "../../src/config/env";
import { createMcpApp } from "../../src/handlers/mcpHandler";

describe("GET /metrics with METRICS_TOKEN", () => {
  const token = "metrics-token-0123456789";
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const container = buildContainer(parseEnv({ NODE_ENV: "test", METRICS_TOKEN: token }));
    server = createMcpApp(container, []).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects missing or wrong tokens", async () => {
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("serves metrics with the right token", async () => {
    const res = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("tronsave_mcp_");
  });
});
