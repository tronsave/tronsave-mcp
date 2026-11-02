import { defineConfig } from "vitest/config";

/**
 * Vitest runs TypeScript tests in Node (same runtime as the MCP server).
 *
 * Coverage `include` now covers ALL business surfaces the team actively maintains
 * (services, clients, infra, handlers, utils, tools registration). `exclude` skips
 * pure declarative wiring (tool definitions, GraphQL strings, GraphQL response types)
 * and the entry point because they carry little branch logic.
 *
 * Threshold sits just under the measured baseline (~69% lines after the session-flow
 * and HTTP client suites). Ratchet it up whenever new tests land; never lower it.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/app/**/*.ts",
        "src/clients/**/*.ts",
        "src/config/env.ts",
        "src/handlers/**/*.ts",
        "src/infra/**/*.ts",
        "src/services/**/*.ts",
        "src/tools.ts",
        "src/tools/adapters/**/*.ts",
        "src/tools/handlers/**/*.ts",
        "src/utils/**/*.ts",
      ],
      exclude: [
        "src/**/*.d.ts",
        "src/index.ts",
        "src/tools/handlers/platform/gql/**",
        "src/tools/handlers/platform/types/**",
        "src/tools/definitions/**",
      ],
      thresholds: {
        lines: 65,
        branches: 70,
      },
    },
  },
});
