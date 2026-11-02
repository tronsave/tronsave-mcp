import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { REDIS_KEYS } from "../config/constants";
import { RedisService } from "./redisService";
import { getUnixTimestamp } from "../utils/time";

export interface SessionData {
  sessionId: string;
  apiKey?: string;
  signature?: string;
  walletAddress?: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Two Redis records share one id (the MCP `mcp-session-id`):
 * - transport marker: the MCP connection was initialized (any replica may serve it);
 * - auth session: credentials bound to that connection by `tronsave_login`.
 */
export class SessionService {
  constructor(private readonly redisService: RedisService) {}

  async createSession(
    sessionInput: {
      apiKey?: string;
      signature?: string;
      walletAddress?: string;
    },
    sessionId: string = randomUUID(),
  ): Promise<SessionData> {
    const createdAt = getUnixTimestamp();
    const expiresAt = createdAt + env.SESSION_TTL_SECONDS;
    const session: SessionData = {
      sessionId,
      apiKey: sessionInput.apiKey,
      // Signature token keeps `signature_timestamp` format (without `Signature ` prefix).
      signature: sessionInput.signature,
      walletAddress: sessionInput.walletAddress,
      createdAt,
      expiresAt,
    };
    await this.redisService.setJson(REDIS_KEYS.session(sessionId), session, env.SESSION_TTL_SECONDS);
    return session;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    return this.redisService.getJson<SessionData>(REDIS_KEYS.session(sessionId));
  }

  /** Removes the login bound to a transport session (logout); the transport stays usable. */
  async deleteSession(sessionId: string): Promise<void> {
    await this.redisService.delete(REDIS_KEYS.session(sessionId));
  }

  async registerTransportSession(sessionId: string): Promise<void> {
    await this.redisService.setJson(
      REDIS_KEYS.transportSession(sessionId),
      { createdAt: getUnixTimestamp() },
      env.SESSION_TTL_SECONDS,
    );
  }

  /** True when the transport was initialized (marker) or still carries a login (pre-upgrade sessions). */
  async hasTransportSession(sessionId: string): Promise<boolean> {
    if (await this.redisService.exists(REDIS_KEYS.transportSession(sessionId))) {
      return true;
    }
    return this.redisService.exists(REDIS_KEYS.session(sessionId));
  }

  /** Sliding expiry so active connections do not expire mid-conversation. */
  async touchTransportSession(sessionId: string): Promise<void> {
    await this.redisService.expire(REDIS_KEYS.transportSession(sessionId), env.SESSION_TTL_SECONDS);
  }

  async terminateTransportSession(sessionId: string): Promise<void> {
    await this.redisService.delete(REDIS_KEYS.transportSession(sessionId), REDIS_KEYS.session(sessionId));
  }
}
