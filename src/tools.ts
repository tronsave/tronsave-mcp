import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./tools/definitions/definition_type";

export { createAllTools } from "./tools/definitions/index";
import { getRequestContext } from "./handlers/authContext";
import { hasSignatureIdentity, isAuthenticated, type AuthContext } from "./schemas/auth";
import { relaxOutputSchema } from "./tools/relaxOutputSchema";
import { AppError, toToolErrorPayload } from "./utils/errors";
import { logger } from "./utils/logger";
import { metrics } from "./utils/metrics";
import { redactSensitive } from "./utils/redact";
import { toRequestIdentityLog } from "./utils/requestIdentity";
import { toolError } from "./utils/response";

/** Errors that a sign-in fixes: OAuth-capable hosts get a challenge to start account linking. */
const AUTH_ERROR_CODES = new Set([
  "SESSION_REQUIRED",
  "INVALID_SESSION_TYPE",
  "API_KEY_SESSION_REQUIRED",
  "UPSTREAM_UNAUTHORIZED",
]);

const LOGIN_HINT =
  "Api-key: call `tronsave_login` with `apiKey` (or set header `Authorization: ApiKey <key>`). " +
  "Wallet: call `tronsave_get_sign_message`, sign `message` in the wallet, then `tronsave_login` with `signature: \"<signature>_<timestamp>\"`. " +
  "Or reconnect the app through OAuth sign-in. Use `tronsave_get_session_status` to check the current auth state.";

/**
 * Gate enforced before every handler (`auth.mode` on the definition):
 * - `public`: anyone;
 * - `session`: any authenticated identity (login session or verified header);
 * - `signature-session`: a wallet-verified identity (signature login or `Signature` header).
 */
export const assertToolAccess = (tool: ToolDefinition, auth: AuthContext | undefined): void => {
  if (tool.auth.mode === "public") {
    return;
  }
  if (!isAuthenticated(auth)) {
    if (auth?.authError) {
      throw new AppError(`Header credentials were rejected: ${auth.authError.message}`, 401, auth.authError.code, {
        retryable: false,
        hint: LOGIN_HINT,
      });
    }
    throw new AppError(`\`${tool.name}\` requires authentication.`, 401, "SESSION_REQUIRED", {
      retryable: false,
      hint: LOGIN_HINT,
    });
  }
  if (tool.auth.mode === "signature-session" && !hasSignatureIdentity(auth)) {
    throw new AppError(
      `\`${tool.name}\` requires a wallet signature session; the current session is api-key only.`,
      403,
      "INVALID_SESSION_TYPE",
      {
        retryable: false,
        hint: "Call `tronsave_get_sign_message`, sign `message` in the wallet, then `tronsave_login` with `signature: \"<signature>_<timestamp>\"`.",
      },
    );
  }
};

/** `tools/list` `_meta` key carrying the tool's auth mode: public | session | signature-session. */
export const TOOL_AUTH_META_KEY = "io.tronsave/auth";

export const registerTools = (server: McpServer, tools: ToolDefinition[]): void => {
  for (const tool of tools) {
    const mutating = tool.annotations?.readOnlyHint !== true;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: relaxOutputSchema(tool.outputSchema),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        // Machine-readable login requirement, so clients and generated docs don't parse descriptions.
        _meta: { [TOOL_AUTH_META_KEY]: tool.auth.mode },
      },
      async (args, extra) => {
        const requestId =
          extra && typeof extra === "object" && "requestId" in extra
            ? String((extra as Record<string, unknown>).requestId)
            : undefined;
        const startedAt = Date.now();
        const requestContext = getRequestContext();
        const caller = requestContext ? toRequestIdentityLog(requestContext.auth) : { authType: "none" as const };
        logger.info("MCP tool call received", { tool: tool.name, requestId, caller });

        try {
          assertToolAccess(tool, requestContext?.auth);
          // Arguments were already validated against `inputSchema` by the SDK.
          const parsedArgs = (args ?? {}) as Record<string, unknown>;
          logger.debug("MCP tool input body", { tool: tool.name, requestId, inputBody: redactSensitive(parsedArgs) });
          const result = await tool.handler(parsedArgs, extra);
          const durationMs = Date.now() - startedAt;
          logger.info("MCP tool call succeeded", { tool: tool.name, requestId, durationMs });
          if (!tool.sensitiveOutput) {
            logger.debug("MCP tool output body", { tool: tool.name, requestId, outputBody: redactSensitive(result) });
          }
          metrics.toolCalls({ tool: tool.name, outcome: "ok" });
          metrics.toolDurationMs({ tool: tool.name }, durationMs);
          return result;
        } catch (error) {
          const payload = toToolErrorPayload(error, mutating);
          const durationMs = Date.now() - startedAt;
          logger.error("MCP tool call failed", {
            tool: tool.name,
            requestId,
            caller,
            durationMs,
            code: payload.code,
            error: error instanceof Error ? error.message : String(error),
          });
          metrics.toolCalls({ tool: tool.name, outcome: "error" });
          metrics.toolErrors({ tool: tool.name, code: payload.code });
          metrics.toolDurationMs({ tool: tool.name }, durationMs);
          const challenge = requestContext?.oauthChallenge;
          return AUTH_ERROR_CODES.has(payload.code) && challenge
            ? toolError(payload, {
                "mcp/www_authenticate": [
                  `${challenge}, error="insufficient_scope", error_description="${payload.message.replace(/["`]/g, "'")}"`,
                ],
              })
            : toolError(payload);
        }
      },
    );
  }
};
