import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

describe("server.json (official MCP Registry manifest)", () => {
  const manifest = read("server.json");

  it("tracks the package version", () => {
    expect(manifest.version).toBe(read("package.json").version);
  });

  it("keeps the Cursor plugin manifest on the same version and endpoint", () => {
    expect(read(".cursor-plugin/plugin.json").version).toBe(read("package.json").version);
    expect(read(".cursor-plugin/mcp.json").mcpServers.tronsave.url).toBe("https://mcp.tronsave.io/oauth/mcp");
  });

  it("respects registry limits", () => {
    expect(manifest.name).toMatch(/^io\.github\.tronsave\/[a-z0-9-]+$/);
    expect(manifest.description.length).toBeLessThanOrEqual(100);
    for (const remote of manifest.remotes) {
      expect(remote.type).toBe("streamable-http");
      expect(remote.url).toMatch(/^https:\/\/mcp\.tronsave\.io\/(oauth\/)?(testnet\/)?mcp$/);
    }
  });
});
