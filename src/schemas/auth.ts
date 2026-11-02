import { z } from "zod";

/**
 * - `none`: anonymous.
 * - `session`: credentials bound to `mcp-session-id` by `tronsave_login` (stored in Redis).
 * - `apiKey`: verified `Authorization: ApiKey <key>` / `x-api-key` header (static client config).
 * - `signature`: verified `Authorization: Signature <sig>_<ts>` header.
 */
export const authTypeSchema = z.enum(["none", "apiKey", "signature", "session"]);

export const authContextSchema = z.object({
  type: authTypeSchema,
  sessionAuthType: z.enum(["signature", "api-key"]).optional(),
  authorization: z.string().optional(),
  // Internal TronSave API key forwarded to REST (`apikey` header) when present.
  apiKey: z.string().optional(),
  walletAddress: z.string().optional(),
  /** Signature token `<sig>_<ts>` (no `Signature ` prefix) forwarded to GraphQL as `authorization`. */
  signature: z.string().optional(),
  timestamp: z.number().int().optional(),
  sessionId: z.string().optional(),
  /** `oauth` when the identity comes from a built-in OAuth access token. */
  via: z.literal("oauth").optional(),
  /** OAuth client the token was issued to. */
  clientId: z.string().optional(),
  /** Set when header credentials were present but rejected; surfaced by gated tools instead of failing the transport. */
  authError: z.object({ code: z.string(), message: z.string() }).optional(),
});

export type AuthContext = z.infer<typeof authContextSchema>;

/** Wallet-verified identity: signature login session or verified `Signature` header. */
export const hasSignatureIdentity = (auth: AuthContext | undefined): boolean =>
  Boolean(auth?.walletAddress && auth.signature) &&
  (auth?.type === "signature" || (auth?.type === "session" && auth.sessionAuthType === "signature"));

export const isAuthenticated = (auth: AuthContext | undefined): boolean => Boolean(auth && auth.type !== "none");
