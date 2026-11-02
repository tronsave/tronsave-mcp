import { NETWORK_ENDPOINTS } from "../config/constants";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { HttpClient } from "../infra/http/HttpClient";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

const AUTH_ERROR_PATTERN = /unauthori[sz]ed|unauthenticated|not logged in|jwt (expired|malformed)|token expired/i;

/** Mutations are never retried automatically (see `HttpClient.executeRequest`). */
export const isGraphqlMutation = (query: string): boolean => /^\s*mutation\b/.test(query);

export class GraphQLClient extends HttpClient {
  constructor(private readonly endpoint: string = NETWORK_ENDPOINTS.mainnet.tronsaveGraphqlBaseUrl) {
    super({
      clientName: "GraphQLClient",
      timeoutMs: env.GRAPHQL_TIMEOUT_MS,
      retries: env.REST_RETRIES,
    });
  }

  async request<T>(
    query: string,
    variables: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): Promise<T> {
    return this.executeRequest<T>({
      baseUrl: this.endpoint,
      path: this.endpoint,
      idempotent: !isGraphqlMutation(query),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ query, variables }),
      },
      parse: async (response) => {
        const payload = (await response.json()) as GraphQLResponse<T>;
        if (payload.errors?.length) {
          const message = payload.errors.map((item) => item.message).join("; ");
          const isAuthError =
            payload.errors.some((item) => /UNAUTH|FORBIDDEN/i.test(item.extensions?.code ?? "")) ||
            AUTH_ERROR_PATTERN.test(message);
          throw isAuthError
            ? new AppError(message, 401, "UPSTREAM_UNAUTHORIZED", {
                retryable: false,
                hint: "The session credentials were rejected by TronSave. Re-run `tronsave_get_sign_message` → `tronsave_login`, then retry.",
              })
            : new AppError(message, 400, "GRAPHQL_ERROR", { retryable: false });
        }
        if (!payload.data) {
          throw new AppError("GraphQL response missing data", 502, "GRAPHQL_NO_DATA");
        }
        return payload.data;
      },
      errorCode: "GRAPHQL_HTTP_ERROR",
    });
  }
}
