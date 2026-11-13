import { randomBytes, randomUUID } from "node:crypto";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Network } from "../config/constants";
import type { RedisService } from "../services/redisService";
import { parseSignatureToken } from "../services/signatureService";
import { sha256Hex } from "../utils/crypto";
import { getUnixTimestamp } from "../utils/time";

/** Credentials an OAuth grant acts with; same shape as a login session. */
export interface OAuthGrant {
  network: Network;
  apiKey?: string;
  signature?: string;
  walletAddress?: string;
}

export interface PendingAuthorization {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state?: string;
  scopes: string[];
  codeChallenge: string;
  resource?: string;
  network: Network;
}

export interface AuthorizationCodeRecord extends PendingAuthorization {
  grant: OAuthGrant;
}

export interface TokenRecord {
  clientId: string;
  scopes: string[];
  resource?: string;
  grant: OAuthGrant;
  expiresAt: number;
  /**
   * Redis key of the other token in this access/refresh pair (`oauth:at:` / `oauth:rt:` plus the
   * sibling's hash). Absent on records issued before pairs were stored; those still revoke alone.
   */
  pairKey?: string;
}

export interface OAuthTtls {
  accessTokenSeconds: number;
  refreshTokenSeconds: number;
  /** How long TronSave accepts a wallet signature; wallet grants never outlive it. */
  signatureMaxAgeSeconds: number;
}

/** Access tokens are prefixed so `Authorization: Bearer` can tell them from raw API keys. */
export const ACCESS_TOKEN_PREFIX = "tsv_at_";
const REFRESH_TOKEN_PREFIX = "tsv_rt_";
const CLIENT_TTL_SECONDS = 180 * 86_400;
const PENDING_TTL_SECONDS = 600;
const CODE_TTL_SECONDS = 300;

const KEYS = {
  client: (id: string) => `oauth:client:${id}`,
  pending: (id: string) => `oauth:req:${id}`,
  code: (code: string) => `oauth:code:${sha256Hex(code)}`,
  accessToken: (token: string) => `oauth:at:${sha256Hex(token)}`,
  refreshToken: (token: string) => `oauth:rt:${sha256Hex(token)}`,
};

const opaque = (prefix = ""): string => `${prefix}${randomBytes(32).toString("base64url")}`;

/**
 * Redis persistence for the built-in authorization server. Codes and tokens are stored only as
 * SHA-256 hashes; codes and pending sign-ins are single-use (GETDEL).
 */
export class OAuthStore {
  constructor(
    private readonly redis: RedisService,
    private readonly ttls: OAuthTtls,
  ) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return (await this.redis.getJson<OAuthClientInformationFull>(KEYS.client(clientId))) ?? undefined;
  }

  async registerClient(
    metadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const client: OAuthClientInformationFull = {
      ...metadata,
      client_id: randomUUID(),
      client_id_issued_at: getUnixTimestamp(),
    };
    await this.redis.setJson(KEYS.client(client.client_id), client, CLIENT_TTL_SECONDS);
    return client;
  }

  async createPending(request: PendingAuthorization): Promise<string> {
    const id = opaque();
    await this.redis.setJson(KEYS.pending(id), request, PENDING_TTL_SECONDS);
    return id;
  }

  async peekPending(id: string): Promise<PendingAuthorization | null> {
    return this.redis.getJson<PendingAuthorization>(KEYS.pending(id));
  }

  async takePending(id: string): Promise<PendingAuthorization | null> {
    const raw = await this.redis.getDel(KEYS.pending(id));
    return raw ? (JSON.parse(raw) as PendingAuthorization) : null;
  }

  async createCode(record: AuthorizationCodeRecord): Promise<string> {
    const code = opaque();
    await this.redis.setJson(KEYS.code(code), record, CODE_TTL_SECONDS);
    return code;
  }

  async peekCode(code: string): Promise<AuthorizationCodeRecord | null> {
    return this.redis.getJson<AuthorizationCodeRecord>(KEYS.code(code));
  }

  async takeCode(code: string): Promise<AuthorizationCodeRecord | null> {
    const raw = await this.redis.getDel(KEYS.code(code));
    return raw ? (JSON.parse(raw) as AuthorizationCodeRecord) : null;
  }

  /**
   * Seconds until the grant's wallet signature stops being accepted upstream, or `undefined` for
   * API-key grants. TronSave rejects signatures older than `signatureMaxAgeSeconds`, so refreshing
   * a wallet grant past that point would hand out tokens that fail on every signed call.
   */
  private signatureSecondsLeft(grant: OAuthGrant, now: number): number | undefined {
    if (!grant.signature) return undefined;
    const parsed = parseSignatureToken(grant.signature);
    if (!parsed) return 0;
    const signedAt = parsed.timestamp > 1e11 ? Math.floor(parsed.timestamp / 1000) : parsed.timestamp;
    return signedAt + this.ttls.signatureMaxAgeSeconds - now;
  }

  /** Issues a fresh access + refresh token pair for a grant. */
  async issueTokens(input: { clientId: string; scopes: string[]; resource?: string; grant: OAuthGrant }) {
    const now = getUnixTimestamp();
    const signatureLeft = this.signatureSecondsLeft(input.grant, now);
    if (signatureLeft !== undefined && signatureLeft <= 0) {
      throw new InvalidGrantError("The wallet signature behind this grant has expired; sign in again");
    }
    const accessTtl = Math.min(this.ttls.accessTokenSeconds, signatureLeft ?? Infinity);
    const refreshTtl = Math.min(this.ttls.refreshTokenSeconds, signatureLeft ?? Infinity);
    const accessToken = opaque(ACCESS_TOKEN_PREFIX);
    const refreshToken = opaque(REFRESH_TOKEN_PREFIX);
    const accessKey = KEYS.accessToken(accessToken);
    const refreshKey = KEYS.refreshToken(refreshToken);
    const base = { clientId: input.clientId, scopes: input.scopes, resource: input.resource, grant: input.grant };
    await this.redis.setJson(
      accessKey,
      { ...base, expiresAt: now + accessTtl, pairKey: refreshKey } satisfies TokenRecord,
      accessTtl,
    );
    await this.redis.setJson(
      refreshKey,
      { ...base, expiresAt: now + refreshTtl, pairKey: accessKey } satisfies TokenRecord,
      refreshTtl,
    );
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: accessTtl,
      refresh_token: refreshToken,
      ...(input.scopes.length ? { scope: input.scopes.join(" ") } : {}),
    };
  }

  async getAccessToken(token: string): Promise<TokenRecord | null> {
    return this.redis.getJson<TokenRecord>(KEYS.accessToken(token));
  }

  /** Refresh tokens rotate: the presented one is consumed. */
  async takeRefreshToken(token: string): Promise<TokenRecord | null> {
    const raw = await this.redis.getDel(KEYS.refreshToken(token));
    return raw ? (JSON.parse(raw) as TokenRecord) : null;
  }

  async revoke(token: string, clientId: string): Promise<void> {
    for (const key of [KEYS.accessToken(token), KEYS.refreshToken(token)]) {
      const record = await this.redis.getJson<TokenRecord>(key);
      if (record && record.clientId === clientId) {
        await this.redis.delete(key, ...(record.pairKey ? [record.pairKey] : []));
      }
    }
  }
}
