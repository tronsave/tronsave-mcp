import type { IncomingHttpHeaders } from "node:http";
import { AUTH_HEADER_PREFIX, REDIS_KEYS, type Network } from "../config/constants";
import { env } from "../config/env";
import { authContextSchema, type AuthContext } from "../schemas/auth";
import { AppError } from "../utils/errors";
import { getUnixTimestamp } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import type { RestClient } from "../clients/restClient";
import type { RedisService } from "./redisService";
import type { SessionService } from "./sessionService";
import { parseSignatureToken, type SignatureService } from "./signatureService";
import { ACCESS_TOKEN_PREFIX, type OAuthStore } from "../oauth/store";

export type ClientsByNetwork = Record<Network, { restClient: RestClient }>;

interface ApiKeyVerifyCache {
  walletAddress?: string;
  verifiedAt: number;
}

interface SignatureVerifyCache {
  walletAddress: string;
  verifiedAt: number;
}

const getSingleHeader = (value: string | string[] | undefined): string | undefined => {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Resolves the caller identity for one HTTP request. Precedence:
 * 1. `Authorization: Bearer tsv_at_…` OAuth access token (built-in authorization server);
 * 2. `mcp-session-id` with a stored login (`tronsave_login`);
 * 3. `Authorization: ApiKey <key>` / `Authorization: Bearer <key>` / `x-api-key: <key>` (verified upstream, cached);
 * 4. `Authorization: Signature <sig>_<ts>` (verified locally, cached);
 * 5. anonymous.
 *
 * Rejected header credentials never fail the transport (so `initialize` / `tools/list` keep
 * working); they are reported through `authError` by the first tool that needs auth.
 */
export class AuthService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly redisService: RedisService,
    private readonly clientsByNetwork: ClientsByNetwork,
    private readonly signatureService?: SignatureService,
    private readonly oauthStore?: OAuthStore,
  ) {}

  async detect(headers: IncomingHttpHeaders, network: Network = "mainnet"): Promise<AuthContext> {
    // An OAuth access token on the request is the most explicit credential: it wins over a stored login.
    const bearer = /^Bearer\s+(.+)$/i.exec(getSingleHeader(headers.authorization) ?? "")?.[1]?.trim();
    if (bearer?.startsWith(ACCESS_TOKEN_PREFIX)) {
      return this.detectFromOAuthToken(bearer, network);
    }

    const sessionId = getSingleHeader(headers["mcp-session-id"]);
    if (sessionId) {
      const session = await this.sessionService.getSession(sessionId);
      if (session) {
        return authContextSchema.parse({
          type: "session",
          sessionId: session.sessionId,
          // Signature sessions carry walletAddress; api-key sessions do not.
          sessionAuthType: session.walletAddress ? "signature" : "api-key",
          walletAddress: session.walletAddress,
          signature: session.signature,
          authorization: session.signature
            ? `${AUTH_HEADER_PREFIX.signature} ${session.signature}`
            : `${AUTH_HEADER_PREFIX.apiKey} ${session.apiKey}`,
          apiKey: session.apiKey,
        });
      }
      // `mcp-session-id` is transport-level and exists before login: fall through to headers.
    }

    const xApiKey = getSingleHeader(headers["x-api-key"]);
    const authorization = getSingleHeader(headers.authorization) ?? (xApiKey ? `${AUTH_HEADER_PREFIX.apiKey} ${xApiKey}` : undefined);
    if (!authorization) {
      return { type: "none" };
    }

    try {
      return await this.detectFromAuthorization(authorization, headers, network);
    } catch (error) {
      if (error instanceof AppError) {
        return { type: "none", authError: { code: error.code, message: error.message } };
      }
      throw error;
    }
  }

  /**
   * Resolves a built-in OAuth access token. An unknown/expired token, or one minted for the other
   * network, yields `OAUTH_INVALID_TOKEN` so the transport answers 401 and the client refreshes.
   */
  private async detectFromOAuthToken(token: string, network: Network): Promise<AuthContext> {
    const record = this.oauthStore ? await this.oauthStore.getAccessToken(token) : null;
    if (!record || record.grant.network !== network) {
      return {
        type: "none",
        authError: {
          code: "OAUTH_INVALID_TOKEN",
          message: record ? `Access token was issued for ${record.grant.network}, not ${network}.` : "Invalid or expired access token.",
        },
      };
    }
    const { grant } = record;
    const wallet = grant.walletAddress && grant.signature;
    return authContextSchema.parse({
      type: wallet ? "signature" : "apiKey",
      via: "oauth",
      clientId: record.clientId,
      walletAddress: grant.walletAddress,
      signature: grant.signature,
      apiKey: grant.apiKey,
      authorization: wallet ? `${AUTH_HEADER_PREFIX.signature} ${grant.signature}` : `${AUTH_HEADER_PREFIX.apiKey} ${grant.apiKey}`,
    });
  }

  /**
   * Verifies an internal API key against TronSave REST (`GET /v2/user-info`), caching success
   * for `AUTH_VERIFY_CACHE_TTL_SECONDS`. Throws `INVALID_API_KEY` when rejected.
   */
  async verifyApiKey(apiKey: string, network: Network): Promise<ApiKeyVerifyCache> {
    const cacheKey = REDIS_KEYS.apiKeyVerified(sha256Hex(apiKey));
    const cache = await this.redisService.getJson<ApiKeyVerifyCache>(cacheKey);
    if (cache) {
      return cache;
    }

    let internalAccount: Record<string, unknown> | null = null;
    try {
      const response = await this.clientsByNetwork[network].restClient.request<{ data: Record<string, unknown> | null }>(
        "/v2/user-info",
        {
          method: "GET",
          headers: { apikey: apiKey, "x-client-source": "mcp", "x-mcp-client": "mcp-remote" },
        },
      );
      internalAccount = response.data;
    } catch (error) {
      if (error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500) {
        internalAccount = null;
      } else {
        throw error;
      }
    }
    if (!internalAccount) {
      throw new AppError("Invalid API key", 401, "INVALID_API_KEY", {
        retryable: false,
        hint: "Check the key (raw value, no `ApiKey` prefix) or mint a new one with `tronsave_generate_api_key` from a signature session.",
      });
    }
    const payload: ApiKeyVerifyCache = {
      walletAddress:
        typeof internalAccount.walletAddress === "string"
          ? internalAccount.walletAddress
          : typeof internalAccount.representAddress === "string"
            ? internalAccount.representAddress
            : undefined,
      verifiedAt: getUnixTimestamp(),
    };
    await this.redisService.setJson(cacheKey, payload, env.AUTH_VERIFY_CACHE_TTL_SECONDS);
    return payload;
  }

  private async detectFromAuthorization(
    authorization: string,
    headers: IncomingHttpHeaders,
    network: Network,
  ): Promise<AuthContext> {
    const spaceIndex = authorization.indexOf(" ");
    const scheme = spaceIndex > 0 ? authorization.slice(0, spaceIndex) : "";
    const credential = spaceIndex > 0 ? authorization.slice(spaceIndex + 1).trim() : "";
    if (!scheme || !credential) {
      throw new AppError("Invalid authorization format", 401, "INVALID_AUTHORIZATION", {
        hint: "Use `Authorization: ApiKey <key>` or `Authorization: Signature <signature>_<timestamp>`.",
      });
    }

    // `Bearer` is accepted as an API-key alias for clients that can only send bearer tokens
    // (e.g. Anthropic API `mcp_servers[].authorization_token`).
    if (scheme.toLowerCase() === AUTH_HEADER_PREFIX.apiKey.toLowerCase() || scheme.toLowerCase() === "bearer") {
      await this.verifyApiKey(credential, network);
      return authContextSchema.parse({
        type: "apiKey",
        apiKey: credential,
        authorization: `${AUTH_HEADER_PREFIX.apiKey} ${credential}`,
      });
    }

    if (scheme.toLowerCase() === AUTH_HEADER_PREFIX.signature.toLowerCase()) {
      const timestampHeader = getSingleHeader(headers["x-timestamp"]);
      const parsed = parseSignatureToken(
        timestampHeader && !/_[0-9]+$/.test(credential) ? `${credential}_${timestampHeader}` : credential,
      );
      if (!parsed) {
        throw new AppError("Signature header must be `Signature <signature>_<timestamp>`", 401, "INVALID_AUTHORIZATION");
      }
      const walletAddress = await this.verifySignatureToken(parsed.token, parsed.signature, parsed.timestamp);
      const claimedAddress = getSingleHeader(headers["x-address"]);
      if (claimedAddress && claimedAddress !== walletAddress) {
        throw new AppError("x-address does not match the signing wallet", 401, "SIGNATURE_ADDRESS_MISMATCH");
      }
      return authContextSchema.parse({
        type: "signature",
        walletAddress,
        signature: parsed.token,
        timestamp: parsed.timestamp,
        authorization: `${AUTH_HEADER_PREFIX.signature} ${parsed.token}`,
      });
    }

    throw new AppError("Unsupported authorization scheme", 401, "UNSUPPORTED_AUTH_SCHEME", {
      hint: "Supported schemes: `ApiKey` (or `Bearer`) and `Signature`.",
    });
  }

  private async verifySignatureToken(token: string, signature: string, timestamp: number): Promise<string> {
    if (!this.signatureService) {
      throw new AppError("Signature header auth is not enabled", 401, "UNSUPPORTED_AUTH_SCHEME");
    }
    const cacheKey = REDIS_KEYS.signatureVerified(sha256Hex(token));
    const cache = await this.redisService.getJson<SignatureVerifyCache>(cacheKey);
    if (cache) {
      return cache.walletAddress;
    }
    const walletAddress = await this.signatureService.verifyLoginSignatureByTimestamp(signature, timestamp);
    const payload: SignatureVerifyCache = { walletAddress, verifiedAt: getUnixTimestamp() };
    await this.redisService.setJson(cacheKey, payload, env.AUTH_VERIFY_CACHE_TTL_SECONDS);
    return walletAddress;
  }
}
