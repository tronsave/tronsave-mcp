import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_GUIDE_MARKDOWN } from "../../src/mcp/agentGuide";
import { createAllTools } from "../../src/tools/definitions";
import { renderToolDocs } from "../../src/tools/renderToolDocs";

const read = (name: string) => readFileSync(path.resolve(__dirname, "../../docs", name), "utf8");

describe("generated docs are up to date (run `npm run docs:tools`)", () => {
  it("docs/TOOLS.md matches the tool definitions", () => {
    expect(read("TOOLS.md")).toBe(renderToolDocs());
  });

  it("documents every registered tool", () => {
    const handlers = new Proxy({}, { get: () => async () => ({ content: [] }) }) as never;
    const names = createAllTools(handlers, handlers).map((tool) => tool.name);
    const doc = read("TOOLS.md");
    expect(doc).toContain(`${names.length} tools.`);
    for (const name of names) expect(doc).toContain(`## ${name}`);
  });

  it("docs/AGENT_GUIDE.md matches the server instructions", () => {
    expect(read("AGENT_GUIDE.md")).toContain(AGENT_GUIDE_MARKDOWN);
  });
});
