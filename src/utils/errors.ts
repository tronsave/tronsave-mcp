export interface AppErrorOptions {
  /** Whether repeating the exact same call later can reasonably succeed. */
  retryable?: boolean;
  /** One actionable next step for the calling agent (which tool to call, what to fix). */
  hint?: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable?: boolean;
  public readonly hint?: string;

  constructor(message: string, statusCode = 400, code = "APP_ERROR", options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = options.retryable;
    this.hint = options.hint;
  }
}

/** Machine-readable error envelope returned to agents inside `CallToolResult` (`isError: true`). */
export interface ToolErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  hint?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 502, 503, 504]);

/**
 * Normalizes any thrown value into a stable error envelope.
 *
 * `mutating` flips the default retry advice: when a write may already have reached the
 * upstream (timeouts, transport failures) the outcome is unknown, so agents must verify
 * with a read tool instead of blindly repeating the call (avoids duplicate orders).
 */
export const toToolErrorPayload = (error: unknown, mutating: boolean): ToolErrorPayload => {
  if (error instanceof AppError) {
    const outcomeUnknown = mutating && (error.code === "UPSTREAM_TIMEOUT" || error.code === "UPSTREAM_UNREACHABLE");
    const retryable = outcomeUnknown ? false : (error.retryable ?? RETRYABLE_STATUS.has(error.statusCode));
    const hint = outcomeUnknown
      ? "The write may or may not have been applied. Do NOT repeat it; verify the current state with a read tool (e.g. `tronsave_list_orders` / `tronsave_get_order`) first."
      : error.hint;
    return { code: error.code, message: error.message, retryable, ...(hint ? { hint } : {}) };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Unexpected server error.",
    retryable: !mutating,
    hint: mutating
      ? "Outcome unknown. Verify state with a read tool before retrying."
      : "Retry once; if it fails again, report the error to the user.",
  };
};
