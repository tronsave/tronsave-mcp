import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingHttpHeaders } from "node:http";
import type { AuthContext } from "../schemas/auth";
import type { Network } from "../config/constants";

interface RequestContext {
  headers: IncomingHttpHeaders;
  auth: AuthContext;
  network: Network;
  /** `WWW-Authenticate` value that lets OAuth-capable clients (e.g. ChatGPT) start account linking. */
  oauthChallenge?: string;
}

const authContextStorage = new AsyncLocalStorage<RequestContext>();

export const withRequestContext = async <T>(
  context: RequestContext,
  callback: () => Promise<T>,
): Promise<T> => authContextStorage.run(context, callback);

export const getRequestContext = (): RequestContext | undefined => authContextStorage.getStore();
