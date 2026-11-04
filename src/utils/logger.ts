import pino, { type Logger as PinoLogger } from "pino";
import { env } from "../config/env";

type LogPayload = Record<string, unknown>;
type AppLogger = {
  debug: (message: string, payload?: LogPayload) => void;
  info: (message: string, payload?: LogPayload) => void;
  warn: (message: string, payload?: LogPayload) => void;
  error: (message: string, payload?: LogPayload) => void;
  child: (bindings: LogPayload) => AppLogger;
};

const REDACTION_PATHS = [
  "*.apiKey",
  "*.signature",
  "*.signedTx",
  "*.paymentSignedTx",
  "*.authorization",
  "*.x-api-key",
  "*.mcp-session-id",
  "*.headers.authorization",
  "*.headers.x-api-key",
  "*.headers.mcp-session-id",
  "*.inputBody.apiKey",
  "*.inputBody.signature",
  "*.outputBody.apiKey",
  "*.outputBody.signature",
];

// Over stdio, stdout is the MCP channel, so logs must go to stderr (fd 2).
const LOG_FD = env.MCP_TRANSPORT === "stdio" ? 2 : 1;

const pinoInstance: PinoLogger = pino(
  {
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACTION_PATHS,
      censor: "[REDACTED]",
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: false,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
              destination: LOG_FD,
            },
          },
        }
      : {}),
  },
  LOG_FD === 2 && env.NODE_ENV !== "development" ? pino.destination(2) : undefined,
);

const createLogger = (base: PinoLogger): AppLogger => ({
  debug(message: string, payload?: LogPayload): void {
    base.debug(payload ?? {}, message);
  },
  info(message: string, payload?: LogPayload): void {
    base.info(payload ?? {}, message);
  },
  warn(message: string, payload?: LogPayload): void {
    base.warn(payload ?? {}, message);
  },
  error(message: string, payload?: LogPayload): void {
    base.error(payload ?? {}, message);
  },
  child(bindings: LogPayload): AppLogger {
    return createLogger(base.child(bindings));
  },
});

export const logger: AppLogger = createLogger(pinoInstance);
