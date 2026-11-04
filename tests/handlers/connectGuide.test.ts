import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContainer } from "../../src/app/container";
import { parseEnv } from "../../src/config/env";
import { createMcpApp } from "../../src/handlers/mcpHandler";

describe("GET /connect (end-user setup guide)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createMcpApp(buildContainer(parseEnv({ NODE_ENV: "test" })), []).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves docs/CONNECT.md as markdown at /connect and /connect.md", async () => {
    for (const route of ["/connect", "/connect.md"]) {
      const res = await fetch(`${base}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      expect(await res.text()).toContain("claude mcp add --transport http --scope user tronsave");
    }
  });

  it("keeps the Cursor install link in sync with the OAuth endpoint", async () => {
    const text = await (await fetch(`${base}/connect`)).text();
    const config = /config=([A-Za-z0-9+/=]+)/.exec(text)?.[1] ?? "";
    expect(JSON.parse(Buffer.from(config, "base64").toString("utf8"))).toEqual({ url: "https://mcp.tronsave.io/oauth/mcp" });
  });
});
