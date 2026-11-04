import type { AppContainer } from "../../../app/container";
import { ok } from "../../../utils/response";
import { toIsoFromUnix } from "../../../utils/time";
import { getRequestContext } from "../../../handlers/authContext";
import { AppError } from "../../../utils/errors";
import { logger } from "../../../utils/logger";
import type { ToolInput } from "../../definitions/definition_type";
import { hasSignatureIdentity } from "../../../schemas/auth";

const getSingleHeader = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const PUBLIC_TOOLS_HINT = "market reads, quotes, `tronsave_list_orders`, `tronsave_create_order` (onchain)";
const SIGNATURE_TOOLS_HINT = "user profile/settings, order detail/update/cancel/manual-sell, auto-sell, api-key management";
const API_KEY_TOOLS_HINT = "internal account, deposit address, extend request, `tronsave_create_order` (internal)";

export function createAuthHandlers(deps: AppContainer) {
  const { signatureService, sessionService, credentialService } = deps;

  const requireTransportSessionId = (): string => {
    const mcpSessionId = getSingleHeader(getRequestContext()?.headers["mcp-session-id"]);
    if (!mcpSessionId) {
      throw new AppError(
        "Missing mcp-session-id. Login must run inside an initialized MCP session.",
        400,
        "MCP_SESSION_REQUIRED",
        {
          retryable: false,
          hint: "Send `initialize` first and reuse the returned `mcp-session-id` header, or authenticate with an `Authorization: ApiKey <key>` header instead of logging in.",
        },
      );
    }
    return mcpSessionId;
  };

  const getSignMessageHandler = async (input: ToolInput) => {
    void input;
    const { message, timestamp } = await signatureService.createSignMessage();
    return ok({ message, timestamp });
  };

  const loginHandler = async (input: ToolInput) => {
    const requestContext = getRequestContext();
    const network = requestContext?.network ?? "mainnet";
    const mcpSessionId = requireTransportSessionId();
    const apiKeyInput = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const signatureInput = typeof input.signature === "string" ? input.signature.trim() : "";
    logger.info("MCP login called", { loginMode: signatureInput ? "signature" : "api-key", network });

    if (signatureInput) {
      const credentials = await credentialService.fromSignature(signatureInput, network);
      const session = await sessionService.createSession(credentials, mcpSessionId);
      return ok({
        sessionId: session.sessionId,
        authMode: "signature",
        walletAddress: credentials.walletAddress,
        hasInternalApiKey: Boolean(credentials.apiKey),
        expiresAt: toIsoFromUnix(session.expiresAt),
        unlocked: credentials.apiKey
          ? `${PUBLIC_TOOLS_HINT}; ${SIGNATURE_TOOLS_HINT}; ${API_KEY_TOOLS_HINT}`
          : `${PUBLIC_TOOLS_HINT}; ${SIGNATURE_TOOLS_HINT}`,
        ...(credentials.warnings.length ? { warnings: credentials.warnings } : {}),
      });
    }

    // Verify before persisting so a rejected key never leaves a session behind.
    const credentials = await credentialService.fromApiKey(apiKeyInput, network);
    const session = await sessionService.createSession({ apiKey: credentials.apiKey }, mcpSessionId);
    return ok({
      sessionId: session.sessionId,
      authMode: "api-key",
      hasInternalApiKey: true,
      expiresAt: toIsoFromUnix(session.expiresAt),
      unlocked: `${PUBLIC_TOOLS_HINT}; ${API_KEY_TOOLS_HINT}`,
    });
  };

  const logoutHandler = async (input: ToolInput) => {
    void input;
    const sessionId = getSingleHeader(getRequestContext()?.headers["mcp-session-id"]);
    if (sessionId) {
      await sessionService.deleteSession(sessionId);
    }
    return ok({ loggedOut: true });
  };

  const sessionStatusHandler = async (input: ToolInput) => {
    void input;
    const requestContext = getRequestContext();
    const auth = requestContext?.auth;
    const authMode = !auth || auth.type === "none"
      ? "none"
      : hasSignatureIdentity(auth)
        ? "signature"
        : "api-key";
    const source =
      auth?.via === "oauth" ? "oauth" : auth?.type === "session" ? "login" : auth?.type === "none" || !auth ? "none" : "header";
    const session = auth?.type === "session" && auth.sessionId ? await sessionService.getSession(auth.sessionId) : null;
    return ok({
      authenticated: authMode !== "none",
      authMode,
      source,
      network: requestContext?.network ?? "mainnet",
      walletAddress: auth?.walletAddress ?? null,
      hasInternalApiKey: Boolean(auth?.apiKey),
      expiresAt: session ? toIsoFromUnix(session.expiresAt) : null,
      ...(auth?.authError ? { headerAuthError: auth.authError } : {}),
      availableNow:
        authMode === "signature"
          ? [PUBLIC_TOOLS_HINT, SIGNATURE_TOOLS_HINT, ...(auth?.apiKey ? [API_KEY_TOOLS_HINT] : [])]
          : authMode === "api-key"
            ? [PUBLIC_TOOLS_HINT, API_KEY_TOOLS_HINT]
            : [PUBLIC_TOOLS_HINT],
    });
  };

  return { getSignMessageHandler, loginHandler, logoutHandler, sessionStatusHandler };
}
