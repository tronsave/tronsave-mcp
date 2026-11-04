import { GraphQLClient } from "../clients/graphqlClient";
import { RestClient } from "../clients/restClient";
import { NETWORK_ENDPOINTS, type Network } from "../config/constants";
import type { Env } from "../config/env";
import { AuthService } from "../services/authService";
import { CredentialService } from "../services/credentialService";
import { OAuthStore } from "../oauth/store";
import { isMemoryRedisUrl, RedisService } from "../services/redisService";
import { SessionService } from "../services/sessionService";
import { SignatureService } from "../services/signatureService";
import { logger } from "../utils/logger";

/**
 * Composition root: one shared instance per process for Redis-backed services and upstream HTTP clients.
 * Tool handlers receive factories built from this container (ADR 002).
 */
export interface AppContainer {
  env: Env;
  redisService: RedisService;
  sessionService: SessionService;
  signatureService: SignatureService;
  authService: AuthService;
  credentialService: CredentialService;
  oauthStore: OAuthStore;
  /** Per-network TronSave GraphQL + REST clients (mainnet vs testnet paths). */
  clientsByNetwork: Record<Network, { graphqlClient: GraphQLClient; restClient: RestClient }>;
}

export function buildContainer(parsedEnv: Env): AppContainer {
  const redisService = new RedisService(parsedEnv.REDIS_URL);
  // stdio serves one client, so the in-process store is expected there.
  if (isMemoryRedisUrl(parsedEnv.REDIS_URL) && parsedEnv.NODE_ENV !== "test" && parsedEnv.MCP_TRANSPORT === "http") {
    logger.warn("REDIS_URL=memory: sessions and OAuth tokens live in this process only (single instance, lost on restart)");
  }
  const sessionService = new SessionService(redisService);
  const signatureService = new SignatureService(redisService);

  const clientsByNetwork: Record<Network, { graphqlClient: GraphQLClient; restClient: RestClient }> = {
    mainnet: {
      graphqlClient: new GraphQLClient(NETWORK_ENDPOINTS.mainnet.tronsaveGraphqlBaseUrl),
      restClient: new RestClient(NETWORK_ENDPOINTS.mainnet.tronsaveRestBaseUrl),
    },
    testnet: {
      graphqlClient: new GraphQLClient(NETWORK_ENDPOINTS.testnet.tronsaveGraphqlBaseUrl),
      restClient: new RestClient(NETWORK_ENDPOINTS.testnet.tronsaveRestBaseUrl),
    },
  };

  const oauthStore = new OAuthStore(redisService, {
    accessTokenSeconds: parsedEnv.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenSeconds: parsedEnv.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    signatureMaxAgeSeconds: parsedEnv.SIGNATURE_MAX_AGE_SECONDS,
  });
  const authService = new AuthService(sessionService, redisService, clientsByNetwork, signatureService, oauthStore);
  const credentialService = new CredentialService(authService, signatureService, clientsByNetwork);

  return {
    env: parsedEnv,
    redisService,
    sessionService,
    signatureService,
    authService,
    credentialService,
    oauthStore,
    clientsByNetwork,
  };
}
