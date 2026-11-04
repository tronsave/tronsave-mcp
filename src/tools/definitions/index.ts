import type { InternalHandlers } from "../handlers/internal";
import type { PlatformHandlers } from "../handlers/platform";
import type { ToolDefinition } from "./definition_type";
import { createInternalTools } from "./internal/index";
import { createPlatformTools } from "./platform/index";
import { createInsightTools } from "./platform/insights";

/** Registers TronSave MCP tools using handler factories built from the composition root. */
export function createAllTools(
  platformHandlers: PlatformHandlers,
  internalHandlers: InternalHandlers,
): ToolDefinition[] {
  return [
    ...createInternalTools(internalHandlers),
    ...createPlatformTools(platformHandlers),
    ...createInsightTools(platformHandlers),
  ];
}
