import type { JSONRPCMessage, MessageExtraInfo, RequestId } from "@modelcontextprotocol/sdk/types.js";
import type { TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logger } from "../utils/logger";

/**
 * The slice of a transport this queue replaces. `StdioServerTransport` matches it: `send` is
 * swapped so we can see the response, and `onmessage` is the inbound hook the SDK installed.
 */
export interface OrderedDispatchTransport {
  send: (message: JSONRPCMessage, options?: TransportSendOptions) => Promise<void>;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
}

const idKey = (id: RequestId): string => `${typeof id}:${String(id)}`;

const asRecord = (message: JSONRPCMessage): Record<string, unknown> => message as unknown as Record<string, unknown>;

const requestIdOf = (id: unknown): RequestId | undefined =>
  typeof id === "string" || typeof id === "number" ? id : undefined;

/** Outbound (or inbound) JSON-RPC response: an id plus `result` or `error`. */
const responseId = (message: JSONRPCMessage): RequestId | undefined => {
  const record = asRecord(message);
  if (!("result" in record) && !("error" in record)) return undefined;
  return requestIdOf(record.id);
};

/**
 * Inbound client request. Notifications have no id; a message that already carries `result` or
 * `error` is a response from the client and is not something we answer.
 */
const inboundRequestId = (message: JSONRPCMessage): RequestId | undefined => {
  const record = asRecord(message);
  if ("result" in record || "error" in record) return undefined;
  if (typeof record.method !== "string") return undefined;
  return requestIdOf(record.id);
};

const openGate = (): { promise: Promise<void>; resolve: () => void } => {
  let settled = false;
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
};

/**
 * Runs inbound stdio messages one at a time. The MCP SDK answers a request only later, from
 * `transport.send`, so waiting for `handle` to return is not enough: the next message's auth
 * detection would overlap a handler that is still logging in. Each client request stays at the
 * head of the queue until the response with its id is sent. Notifications and responses from the
 * client move on as soon as `handle` settles. A throw resolves the wait, so one failure cannot
 * stall the process.
 */
export const installOrderedStdioDispatch = (
  transport: OrderedDispatchTransport,
  handle: (message: JSONRPCMessage, extra?: MessageExtraInfo) => Promise<void>,
): void => {
  const send = transport.send.bind(transport);
  const pending = new Map<string, () => void>();

  const release = (message: JSONRPCMessage): void => {
    const id = responseId(message);
    if (id === undefined) return;
    pending.get(idKey(id))?.();
  };

  transport.send = async (message, options) => {
    try {
      await send(message, options);
    } finally {
      release(message);
    }
  };

  let queue = Promise.resolve();
  transport.onmessage = (message, extra) => {
    // A response from the client answers a request this server sent (elicitation, sampling,
    // roots) while a handler waits on it. Queueing it behind that handler would deadlock.
    if (responseId(message) !== undefined && typeof asRecord(message).method !== "string") {
      handle(message, extra).catch((error) => logger.error("MCP stdio message failed", { error: String(error) }));
      return;
    }
    queue = queue
      .then(async () => {
        const requestId = inboundRequestId(message);
        if (requestId === undefined) {
          await handle(message, extra);
          return;
        }
        const gate = openGate();
        const key = idKey(requestId);
        const resolve = () => {
          if (pending.get(key) === resolve) pending.delete(key);
          gate.resolve();
        };
        pending.set(key, resolve);
        try {
          await handle(message, extra);
        } catch (error) {
          resolve();
          throw error;
        }
        await gate.promise;
      })
      .catch((error) => logger.error("MCP stdio message failed", { error: String(error) }));
  };
};
