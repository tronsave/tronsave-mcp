export const REDIS_KEYS = {
  signMessage: (walletAddress: string) => `auth:sign-message:${walletAddress}`,
  signMessageByTimestamp: (timestamp: number) => `auth:sign-message:timestamp:${timestamp}`,
  session: (sessionId: string) => `auth:session:${sessionId}`,
  apiKeyVerified: (hash: string) => `auth:apikey-verified:${hash}`,
  signatureVerified: (hash: string) => `auth:signature-verified:${hash}`,
  /** Marker proving an MCP transport session was initialized (lets any replica serve it). */
  transportSession: (sessionId: string) => `mcp:transport:${sessionId}`,
} as const;

export type Network = "mainnet" | "testnet";

export const NETWORK_ENDPOINTS: Record<
  Network,
  {
    tronsaveGraphqlBaseUrl: string;
    tronsaveRestBaseUrl: string;
    tronFullNodeUrl: string;
  }
> = {
  testnet: {
    tronsaveGraphqlBaseUrl: "https://api-dashboard-dev.tronsave.io/graphql",
    tronsaveRestBaseUrl: "https://api-dev.tronsave.io",
    tronFullNodeUrl: "https://nile.trongrid.io",
  },
  mainnet: {
    tronsaveGraphqlBaseUrl: "https://api-dashboard.tronsave.io/graphql",
    tronsaveRestBaseUrl: "https://api.tronsave.io",
    tronFullNodeUrl: "https://api.trongrid.io",
  },
} as const;

export const AUTH_HEADER_PREFIX = {
  apiKey: "ApiKey",
  signature: "Signature",
} as const;
