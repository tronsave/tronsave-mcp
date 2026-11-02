import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Network } from "../config/constants";
import type { SignatureService } from "../services/signatureService";
import { renderSignInPage } from "./pages";
import { OAuthStore, type TokenRecord } from "./store";

export const OAUTH_SCOPE = "tronsave";

/** Network a token is minted for, derived from the RFC 8707 `resource` (an `/testnet/` MCP URL). */
export const networkFromResource = (resource: URL | string | undefined): Network =>
  resource && new URL(String(resource)).pathname.includes("/testnet/") ? "testnet" : "mainnet";

/**
 * Built-in OAuth 2.1 authorization server (PKCE S256, dynamic client registration, refresh-token
 * rotation). The "user login" step is TronSave-specific: the sign-in page accepts a TronSave API key
 * or a TRON wallet signature, verified exactly like `tronsave_login` (see `CredentialService`).
 */
export class TronSaveOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: OAuthStore,
    private readonly signatureService: SignatureService,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: (client) => this.store.registerClient(client),
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const network = networkFromResource(params.resource);
    const requestId = await this.store.createPending({
      clientId: client.client_id,
      clientName: client.client_name ?? "An application",
      redirectUri: params.redirectUri,
      state: params.state,
      scopes: params.scopes?.length ? params.scopes : [OAUTH_SCOPE],
      codeChallenge: params.codeChallenge,
      resource: params.resource?.href,
      network,
    });
    const signMessage = await this.signatureService.createSignMessage();
    const nonce = randomBytes(16).toString("base64");
    res
      .status(200)
      .set(signInPageHeaders(nonce))
      .type("html")
      .send(
        renderSignInPage({
          requestId,
          clientName: client.client_name ?? "An application",
          redirectHost: new URL(params.redirectUri).host,
          network,
          signMessage,
          nonce,
        }),
      );
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const record = await this.store.peekCode(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.store.takeCode(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (resource && record.resource && resource.href !== record.resource) {
      throw new InvalidGrantError("resource does not match the authorization request");
    }
    return this.store.issueTokens({
      clientId: client.client_id,
      scopes: record.scopes,
      resource: record.resource,
      grant: record.grant,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.store.takeRefreshToken(refreshToken);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid or expired refresh token");
    }
    if (resource && record.resource && resource.href !== record.resource) {
      throw new InvalidGrantError("resource does not match the original grant");
    }
    const narrowed = scopes?.length ? scopes.filter((scope) => record.scopes.includes(scope)) : record.scopes;
    return this.store.issueTokens({
      clientId: client.client_id,
      scopes: narrowed,
      resource: record.resource,
      grant: record.grant,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await this.store.getAccessToken(token);
    if (!record) {
      throw new InvalidTokenError("Invalid or expired access token");
    }
    return toAuthInfo(token, record);
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.store.revoke(request.token, client.client_id);
  }
}

export const toAuthInfo = (token: string, record: TokenRecord): AuthInfo => ({
  token,
  clientId: record.clientId,
  scopes: record.scopes,
  expiresAt: record.expiresAt,
  ...(record.resource ? { resource: new URL(record.resource) } : {}),
  extra: { grant: record.grant },
});

/**
 * The sign-in page handles credentials: never cache it, never frame it, only run its own script.
 * No `form-action`: browsers apply it to the redirect back to the client (claude.ai, cursor://…).
 */
export const signInPageHeaders = (nonce: string): Record<string, string> => ({
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`,
});
