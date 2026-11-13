import "dotenv/config";
import { z } from "zod";

/**
 * Central typed configuration parsed once at startup.
 * Defaults preserve prior hardcoded behavior for backward-compatible deploys.
 */
const envSchema = z.object({
  MCP_PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  MCP_SERVER_NAME: z.string().default("TronSave MCP Server"),
  MCP_SERVER_VERSION: z.string().default("1.5.2"),
  GRAPHQL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  REST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  REST_RETRIES: z.coerce.number().int().min(0).default(2),
  SIGN_MESSAGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  /**
   * Maximum age of the signed timestamp accepted by signature login / `Signature` header auth.
   * Bounds replay of a leaked signature; the TronSave backend applies its own validity on top.
   */
  SIGNATURE_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** TTL of the Redis cache that remembers an api-key / signature header was already verified. */
  AUTH_VERIFY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  READINESS_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  /**
   * Public origin of this server (e.g. `https://mcp.tronsave.io`). Enables the built-in OAuth 2.1
   * authorization server and the `/oauth/mcp` endpoints; unset = OAuth disabled.
   */
  PUBLIC_BASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .url()
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
  ),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 86_400),
  /** Express `trust proxy` setting: hops of reverse proxies in front of the server (rate limits use the client IP). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  /** When set, `GET /metrics` requires `Authorization: Bearer <token>`; unset keeps it open (private networks). */
  METRICS_TOKEN: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(16).optional()),
  /** `stdio` is set by `dist/stdio.js`: logs then go to stderr so stdout carries only MCP messages. */
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  /** stdio only: the TronSave network the local server talks to (HTTP picks it from the URL path). */
  TRONSAVE_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),
  /** stdio only: API key sent as `Authorization: ApiKey <key>`; unset = public tools until `tronsave_login`. */
  TRONSAVE_API_KEY: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(processEnv: NodeJS.ProcessEnv): Env {
  const parsedEnv = envSchema.safeParse(processEnv);
  if (!parsedEnv.success) {
    throw new Error(`Invalid environment variables: ${parsedEnv.error.message}`);
  }
  return parsedEnv.data;
}

export const env = parseEnv(process.env);
