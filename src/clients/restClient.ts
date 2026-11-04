import { NETWORK_ENDPOINTS } from "../config/constants";
import { env } from "../config/env";
import { HttpClient } from "../infra/http/HttpClient";

export interface RestRequestOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /** Override retry eligibility (defaults to GET/HEAD only); set for read-only POST endpoints. */
  idempotent?: boolean;
}

export class RestClient extends HttpClient {
  constructor(private readonly baseUrl: string = NETWORK_ENDPOINTS.mainnet.tronsaveRestBaseUrl) {
    super({
      clientName: "RestClient",
      timeoutMs: env.REST_TIMEOUT_MS,
      retries: env.REST_RETRIES,
    });
  }

  async request<T>(url: string, options: RestRequestOptions = {}): Promise<T> {
    const { timeoutMs, retries, idempotent, ...init } = options;
    return this.executeRequest<T>({
      baseUrl: this.baseUrl,
      path: url,
      timeoutMs,
      retries,
      idempotent,
      init: {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      },
      parse: async (response) => (await response.json()) as T,
      errorCode: "REST_ERROR",
    });
  }
}
