import type { GraphQLClient } from "../clients/graphqlClient";
import type { Network } from "../config/constants";
import { AUTH_USER_INFO_QUERY } from "../tools/handlers/platform/gql/auth";
import type { AuthUserInfoQueryData } from "../tools/handlers/platform/types/auth";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import type { AuthService } from "./authService";
import { parseSignatureToken, type SignatureService } from "./signatureService";

/** Verified TronSave credentials, as bound to a login session or an OAuth grant. */
export interface VerifiedCredentials {
  apiKey?: string;
  /** `<signature>_<timestamp>` token forwarded to GraphQL as `authorization`. */
  signature?: string;
  walletAddress?: string;
  warnings: string[];
}

/**
 * Turns raw user credentials into verified ones. Shared by `tronsave_login` and the OAuth sign-in
 * page so both apply the same checks (signature age, wallet recovery, upstream API-key validation).
 */
export class CredentialService {
  constructor(
    private readonly authService: AuthService,
    private readonly signatureService: SignatureService,
    private readonly graphqlClients: Record<Network, { graphqlClient: GraphQLClient }>,
  ) {}

  async fromApiKey(rawApiKey: string, network: Network): Promise<VerifiedCredentials> {
    const apiKey = rawApiKey.replace(/^ApiKey\s+/i, "").trim();
    if (!apiKey) {
      throw new AppError("`apiKey` cannot be empty", 400, "INVALID_API_KEY", { retryable: false });
    }
    await this.authService.verifyApiKey(apiKey, network);
    return { apiKey, warnings: [] };
  }

  async fromSignature(rawSignature: string, network: Network): Promise<VerifiedCredentials> {
    const parsed = parseSignatureToken(rawSignature.trim());
    if (!parsed) {
      throw new AppError("Signature must follow format `<signature>_<timestamp>`", 400, "INVALID_LOGIN_PARAMS", {
        retryable: false,
        hint: "Example: `0x1b2c...9f_1761200000` where the timestamp is exactly the value that was signed.",
      });
    }
    const walletAddress = await this.signatureService.verifyLoginSignatureByTimestamp(parsed.signature, parsed.timestamp);

    // The wallet is already proven; the internal API key is a bonus, so an upstream hiccup
    // degrades the grant (no internal tools) instead of failing the login.
    let apiKey: string | undefined;
    const warnings: string[] = [];
    try {
      const data = await this.graphqlClients[network].graphqlClient.request<AuthUserInfoQueryData>(
        AUTH_USER_INFO_QUERY,
        {},
        { authorization: parsed.token, "x-client-source": "mcp", "x-mcp-client": "mcp-remote" },
      );
      apiKey = data.user?.internalAcc?.apiKey?.trim() || undefined;
    } catch (error) {
      if (error instanceof AppError && error.code === "UPSTREAM_UNAUTHORIZED") {
        throw error;
      }
      logger.warn("Signature login could not load internal API key", { error: String(error) });
      warnings.push(
        "Could not load the wallet's internal API key; internal-account tools are unavailable until you log in again.",
      );
    }
    return { apiKey, signature: parsed.token, walletAddress, warnings };
  }
}
