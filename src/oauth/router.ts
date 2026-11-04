import { randomBytes } from "node:crypto";
import express, { type Request, type Response, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AppContainer } from "../app/container";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { renderSignInPage } from "./pages";
import { OAUTH_SCOPE, signInPageHeaders, type TronSaveOAuthProvider } from "./provider";
import type { OAuthStore } from "./store";

/** MCP endpoints that accept OAuth tokens, relative to `PUBLIC_BASE_URL`. */
export const OAUTH_RESOURCE_PATHS = ["/mcp", "/testnet/mcp", "/oauth/mcp", "/oauth/testnet/mcp"] as const;

export const protectedResourceMetadataUrl = (baseUrl: string, resourcePath: string): string =>
  `${baseUrl}/.well-known/oauth-protected-resource${resourcePath}`;

const single = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Mounts the authorization server (RFC 8414 metadata, /authorize, /token, /register, /revoke via the
 * MCP SDK), RFC 9728 protected-resource metadata for every MCP endpoint, and the sign-in form handler.
 */
export const createOAuthRouter = (
  container: AppContainer,
  store: OAuthStore,
  provider: TronSaveOAuthProvider,
  baseUrl: string,
): Router => {
  const router = Router();

  const resourceMetadata = (resourcePath: string) => ({
    resource: `${baseUrl}${resourcePath}`,
    // Must equal the `issuer` the SDK publishes (URL.href, i.e. with the trailing slash).
    authorization_servers: [new URL(baseUrl).href],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: resourcePath.includes("/testnet/") ? "TronSave (Nile testnet)" : "TronSave",
    resource_documentation: `${baseUrl}/quickstart`,
  });
  for (const resourcePath of OAUTH_RESOURCE_PATHS) {
    router.get(`/.well-known/oauth-protected-resource${resourcePath}`, (_req, res) => {
      res.json(resourceMetadata(resourcePath));
    });
  }
  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(resourceMetadata("/oauth/mcp"));
  });

  router.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(baseUrl),
      scopesSupported: [OAUTH_SCOPE],
      resourceName: "TronSave",
      resourceServerUrl: new URL(`${baseUrl}/oauth/mcp`),
      serviceDocumentationUrl: new URL(`${baseUrl}/quickstart`),
    }),
  );

  const renderError = async (res: Response, requestId: string, message: string): Promise<void> => {
    const pending = await store.peekPending(requestId);
    if (!pending) {
      res.status(400).type("text").send("This sign-in request expired. Start the connection again from your app.");
      return;
    }
    const nonce = randomBytes(16).toString("base64");
    res
      .status(400)
      .set(signInPageHeaders(nonce))
      .type("html")
      .send(
        renderSignInPage({
          requestId,
          clientName: pending.clientName,
          redirectHost: new URL(pending.redirectUri).host,
          network: pending.network,
          signMessage: await container.signatureService.createSignMessage(),
          nonce,
          error: message,
        }),
      );
  };

  const redirectBack = (res: Response, redirectUri: string, params: Record<string, string | undefined>): void => {
    const target = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        target.searchParams.set(key, value);
      }
    }
    res.redirect(302, target.href);
  };

  router.post(
    "/oauth/signin",
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }),
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req: Request, res: Response) => {
      const requestId = single(req.body?.request_id);
      const method = single(req.body?.method);
      try {
        const pending = requestId ? await store.peekPending(requestId) : null;
        if (!pending) {
          res.status(400).type("text").send("This sign-in request expired. Start the connection again from your app.");
          return;
        }
        if (method === "deny") {
          await store.takePending(requestId);
          redirectBack(res, pending.redirectUri, { error: "access_denied", state: pending.state });
          return;
        }
        const credentials =
          method === "apikey"
            ? await container.credentialService.fromApiKey(single(req.body?.api_key), pending.network)
            : await container.credentialService.fromSignature(single(req.body?.signature), pending.network);

        const taken = await store.takePending(requestId);
        if (!taken) {
          res.status(400).type("text").send("This sign-in request was already used. Start the connection again from your app.");
          return;
        }
        const code = await store.createCode({
          ...taken,
          grant: {
            network: taken.network,
            apiKey: credentials.apiKey,
            signature: credentials.signature,
            walletAddress: credentials.walletAddress,
          },
        });
        logger.info("OAuth sign-in completed", {
          clientId: taken.clientId,
          method,
          network: taken.network,
          hasApiKey: Boolean(credentials.apiKey),
        });
        redirectBack(res, taken.redirectUri, { code, state: taken.state });
      } catch (error) {
        // Agent-facing hints name MCP tools; a person on this page only needs the reason.
        const message =
          error instanceof AppError && !error.code.startsWith("UPSTREAM_")
            ? error.message
            : "TronSave could not be reached to verify your sign-in. Please try again in a moment.";
        if (!(error instanceof AppError)) {
          logger.error("OAuth sign-in failed", { error: String(error) });
        }
        await renderError(res, requestId, message);
      }
    },
  );

  return router;
};
