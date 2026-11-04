import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";

/**
 * Tool definition interface
 * Each tool must have a name, description, input schema, and handler
 */
export type ToolResponse = CallToolResult;
/** Shared input shape for tool handlers, reused across internal/platform modules. */
export type ToolInput = Record<string, unknown>;
export type ToolHandler<TInput extends ToolInput = ToolInput> = (
  args: TInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => ToolResponse | Promise<ToolResponse>;

export type ToolAuthMode = "public" | "session" | "signature-session";

/**
 * Optional MCP tool annotations forwarded to the SDK at registration time.
 *
 * These map 1:1 to the MCP spec `ToolAnnotations` (see SDK `types.ts`).
 * They are advisory hints used by clients/LLMs for routing and safety
 * heuristics — they do NOT change runtime authorization. Do not rely on
 * them as a security boundary.
 *
 * Spec reference:
 * - `readOnlyHint`     true if the tool does not modify state.
 * - `destructiveHint`  true if the tool may delete/cancel/revoke; ignored
 *                      when `readOnlyHint` is true.
 * - `idempotentHint`   true when calling the tool repeatedly with the
 *                      same args produces the same effect (e.g. cancel
 *                      already-cancelled = no-op).
 * - `openWorldHint`    true if the tool talks to an external system
 *                      (network, blockchain, third-party API). All
 *                      TronSave tools are open-world.
 * - `title`            short human label; falls back to `ToolDefinition.title`.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  auth: { mode: ToolAuthMode };
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  /**
   * Optional MCP-spec annotations forwarded to `server.registerTool`. Use
   * this to declare safety/routing hints alongside the description.
   */
  annotations?: ToolAnnotations;
  /** Output carries secret material (e.g. a freshly minted API key): never log the body. */
  sensitiveOutput?: boolean;
  handler: ToolHandler;
}
