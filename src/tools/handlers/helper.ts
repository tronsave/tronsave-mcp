import { GraphQLClient } from "../../clients/graphqlClient";
import { RestClient } from "../../clients/restClient";
import { getRequestContext } from "../../handlers/authContext";
import { type Network } from "../../config/constants";
import type { RedisService } from "../../services/redisService";
import { hasSignatureIdentity, type AuthContext } from "../../schemas/auth";
import { AppError } from "../../utils/errors";

export interface InternalFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  network?: Network;
  /** If false, skip api-key resolution and call endpoint as public. */
  requireSessionAuth?: boolean;
  /** Read-only POST endpoints may opt into automatic retries. */
  idempotent?: boolean;
}

export interface GraphqlFetchOptions {
  /** Require the internal apiKey of the caller and forward it as `apikey` header. */
  requireSessionApiKey?: boolean;
  /** Require a wallet signature identity and forward it as `authorization`. */
  requireSignature?: boolean;
}

export interface HelperDeps {
  redisService: RedisService;
  clientsByNetwork: Record<Network, { restClient: RestClient; graphqlClient: GraphQLClient }>;
}

export interface HelperApi {
  fetchApiInternal: <T = unknown>(
    path: string,
    toolName: string,
    options?: InternalFetchOptions,
  ) => Promise<T>;
  fetchGraphqlApi: (
    query: string,
    variables: Record<string, unknown>,
    headers: Record<string, string>,
    toolName: string,
    options?: GraphqlFetchOptions,
  ) => Promise<{ data: Record<string, unknown> }>;
}

const LOGIN_HINT =
  "Call `tronsave_login` (api-key mode with `apiKey`, or signature mode via `tronsave_get_sign_message`), or configure an `Authorization: ApiKey <key>` header on the MCP client.";

const requireApiKey = (auth: AuthContext | undefined): string => {
  if (!auth?.apiKey) {
    throw new AppError(
      auth && auth.type !== "none"
        ? "This wallet has no TronSave internal API key. Provision an internal account or log in with an API key."
        : "This operation needs a TronSave internal API key.",
      401,
      "API_KEY_SESSION_REQUIRED",
      { retryable: false, hint: LOGIN_HINT },
    );
  }
  return auth.apiKey;
};

const requireSignature = (auth: AuthContext | undefined): string => {
  if (!hasSignatureIdentity(auth) || !auth?.signature) {
    throw new AppError("This operation needs a wallet signature session.", 401, "SESSION_REQUIRED", {
      retryable: false,
      hint: "Call `tronsave_get_sign_message`, sign `message` in the wallet, then `tronsave_login` with `signature: \"<signature>_<timestamp>\"`.",
    });
  }
  return auth.signature;
};

const traceHeaders = (toolName: string, auth: AuthContext | undefined): Record<string, string> => ({
  "x-client-source": "mcp",
  "x-mcp-tool-name": toolName,
  "x-mcp-client": "mcp-remote",
  ...(auth?.sessionId ? { "x-mcp-session-id": auth.sessionId } : {}),
});

/**
 * Factory closes over the composition-root HTTP clients so tool handlers never
 * instantiate their own pools (see ADR 002). Credentials come from the per-request
 * auth context resolved once by `AuthService.detect`.
 */
export function createHelper(deps: HelperDeps): HelperApi {
  const { clientsByNetwork } = deps;

  const resolveNetworkFromContext = (): Network => getRequestContext()?.network ?? "mainnet";

  const buildPathWithQuery = (
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      params.set(key, String(value));
    }
    const queryString = params.toString();
    return queryString ? `${path}?${queryString}` : path;
  };

  const fetchApiInternal = async <T = unknown>(
    path: string,
    toolName: string,
    options: InternalFetchOptions = {},
  ): Promise<T> => {
    const network = options.network ?? resolveNetworkFromContext();
    const { restClient } = clientsByNetwork[network];
    const auth = getRequestContext()?.auth;
    const apiKey = (options.requireSessionAuth ?? true) ? requireApiKey(auth) : undefined;
    const data = await restClient.request<{ data: T }>(buildPathWithQuery(path, options.query), {
      method: options.method ?? "GET",
      idempotent: options.idempotent,
      headers: {
        ...traceHeaders(toolName, auth),
        ...(apiKey ? { apikey: apiKey } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return data.data;
  };

  const fetchGraphqlApi = async (
    query: string,
    variables: Record<string, unknown>,
    headers: Record<string, string> = {},
    toolName: string,
    options: GraphqlFetchOptions = {},
  ): Promise<{ data: Record<string, unknown> }> => {
    const { graphqlClient } = clientsByNetwork[resolveNetworkFromContext()];
    const auth = getRequestContext()?.auth;
    const signature = options.requireSignature ? requireSignature(auth) : undefined;
    const apiKey = options.requireSessionApiKey ? requireApiKey(auth) : undefined;
    const data = await graphqlClient.request<Record<string, unknown>>(query, variables, {
      ...traceHeaders(toolName, auth),
      ...headers,
      ...(signature ? { authorization: signature } : {}),
      ...(apiKey ? { apikey: apiKey } : {}),
    });
    return { data };
  };

  return { fetchApiInternal, fetchGraphqlApi };
}
