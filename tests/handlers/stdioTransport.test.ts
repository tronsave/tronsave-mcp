import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(__dirname, "../..");

// Runs the real entrypoint in a child process: stdout must carry only MCP messages for the client to parse.
describe("stdio entrypoint", () => {
  const client = new Client({ name: "stdio-test", version: "1.0.0" });

  beforeAll(async () => {
    await client.connect(
      new StdioClientTransport({
        command: path.join(ROOT, "node_modules/.bin/tsx"),
        args: [path.join(ROOT, "src/stdio.ts")],
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", LOG_LEVEL: "info", TRONSAVE_NETWORK: "testnet" },
        stderr: "pipe",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  it("initializes and lists every tool", async () => {
    expect(client.getServerVersion()).toMatchObject({
      name: "TronSave MCP Server",
      title: "TronSave",
      icons: [expect.objectContaining({ mimeType: "image/png" })],
    });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(53);
  });

  it("runs tools inside a request context bound to the configured network", async () => {
    const result = await client.callTool({ name: "tronsave_get_session_status", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ authenticated: false, network: "testnet" });
  });

  it("reports auth errors as tool results", async () => {
    const result = await client.callTool({ name: "tronsave_get_internal_account", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("SESSION_REQUIRED");
  });
});
