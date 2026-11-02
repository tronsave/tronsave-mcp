import CircuitBreaker from "opossum";
import { AppError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export interface HttpRequestOptions extends RequestInit {
  timeoutMs: number;
  retries: number;
  baseUrl: string;
  path: string;
}

export interface HttpClientConfig {
  clientName: string;
  timeoutMs: number;
  retries: number;
}

/** Statuses worth retrying for idempotent requests (transient upstream / gateway failures). */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ERROR_BODY_CHARS = 300;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt: number): number => {
  const base = 150;
  return base * 2 ** attempt + Math.floor(Math.random() * base);
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

export abstract class HttpClient {
  private readonly breaker: CircuitBreaker<[HttpRequestOptions], Response>;
  protected readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
    this.breaker = new CircuitBreaker<[HttpRequestOptions], Response>(
      async (requestOptions: HttpRequestOptions) => this.performWithRetry(requestOptions),
      {
        // Per-attempt timeouts are enforced with AbortController; a breaker-level timeout would
        // fire while retries are still running and orphan in-flight requests.
        timeout: false,
        errorThresholdPercentage: 50,
        rollingCountTimeout: 10_000,
        resetTimeout: 30_000,
        volumeThreshold: 5,
      },
    );

    this.breaker.on("open", () => {
      logger.warn("HTTP circuit breaker opened", { client: this.config.clientName });
    });
    this.breaker.on("halfOpen", () => {
      logger.info("HTTP circuit breaker half-open", { client: this.config.clientName });
    });
    this.breaker.on("close", () => {
      logger.info("HTTP circuit breaker closed", { client: this.config.clientName });
    });
  }

  /**
   * `idempotent: false` (default for non-GET) disables automatic retries: repeating a write
   * whose first attempt may have reached the upstream risks duplicate orders/payments.
   */
  protected async executeRequest<T>(input: {
    baseUrl: string;
    path: string;
    init: RequestInit;
    timeoutMs?: number;
    retries?: number;
    idempotent?: boolean;
    parse: (response: Response) => Promise<T>;
    errorCode: string;
  }): Promise<T> {
    const startedAt = Date.now();
    const method = (input.init.method ?? "GET").toUpperCase();
    const idempotent = input.idempotent ?? (method === "GET" || method === "HEAD");
    let response: Response;
    try {
      response = await this.breaker.fire({
        baseUrl: input.baseUrl,
        path: input.path,
        timeoutMs: input.timeoutMs ?? this.config.timeoutMs,
        retries: idempotent ? (input.retries ?? this.config.retries) : 0,
        ...input.init,
      });
    } catch (error) {
      throw this.toUpstreamError(error);
    }

    logger.info("HTTP request completed", {
      client: this.config.clientName,
      path: input.path,
      requestDurationMs: Date.now() - startedAt,
      status: response.status,
      breakerState: this.breaker.closed ? "closed" : this.breaker.opened ? "open" : "half-open",
    });

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY_CHARS);
      throw new AppError(
        `${this.config.clientName} request failed: ${response.status}${body ? ` ${body}` : ""}`,
        response.status,
        input.errorCode,
        {
          retryable: RETRYABLE_STATUS.has(response.status),
          hint:
            response.status === 401 || response.status === 403
              ? "Credentials were rejected upstream. Re-run `tronsave_login` (or refresh the ApiKey header) and retry."
              : response.status === 429
                ? "Rate limited by TronSave. Wait a few seconds before retrying read-only calls."
                : undefined,
        },
      );
    }

    return input.parse(response);
  }

  private toUpstreamError(error: unknown): unknown {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof Error && (error as { code?: string }).code === "EOPENBREAKER") {
      return new AppError("TronSave upstream is temporarily unavailable (circuit open)", 503, "UPSTREAM_UNAVAILABLE", {
        retryable: true,
        hint: "Wait ~30 seconds before retrying.",
      });
    }
    if (isAbortError(error)) {
      return new AppError(`${this.config.clientName} request timed out`, 504, "UPSTREAM_TIMEOUT", { retryable: true });
    }
    return new AppError(`${this.config.clientName} could not reach TronSave upstream`, 502, "UPSTREAM_UNREACHABLE", {
      retryable: true,
    });
  }

  private async performWithRetry(options: HttpRequestOptions): Promise<Response> {
    const { timeoutMs, retries, baseUrl, path, ...init } = options;
    const targetUrl = path.startsWith("http://") || path.startsWith("https://") ? path : `${baseUrl}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(targetUrl, { ...init, signal: controller.signal });
        if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          await sleep(backoffMs(attempt));
          continue;
        }
        return response;
      } catch (error) {
        if (attempt >= retries) {
          throw error;
        }
        await sleep(backoffMs(attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
