# ADR 008: Built-in OAuth 2.1 authorization server

## Status

Accepted (2026-11, v1.3.0)

## Context

Connector stores (Claude Connectors Directory, ChatGPT Apps, Microsoft 365 Copilot, Google, Grok,
Mistral) expect remote MCP servers to authenticate users through the MCP authorization spec: OAuth 2.1,
PKCE, RFC 9728 protected-resource metadata and usually dynamic client registration. TronSave has no
OAuth provider; its credentials are internal API keys and TRON wallet signatures.

## Decision

- Run the authorization server inside the MCP server, using the MCP SDK's `mcpAuthRouter` with a
  TronSave `OAuthServerProvider` backed by Redis (`src/oauth/`).
- The user-authentication step is a TronSave sign-in page that accepts an API key or a wallet signature
  and verifies it exactly like `tronsave_login` (`CredentialService`). The authorization code, then the
  tokens, carry those verified credentials as the grant.
- Tokens are opaque random strings, stored only as SHA-256 hashes; access 1 h, refresh 30 days with
  rotation, both capped for wallet grants at the signature's expiry (TronSave accepts a signature for
  24 h, so a longer-lived token would only produce failing calls); codes and pending sign-ins are single-use (GETDEL).
- Access tokens carry the `tsv_at_` prefix so `Authorization: Bearer` stays usable as an API-key alias.
- Tokens are bound to the network of the RFC 8707 `resource` (`/testnet/` or not).
- Two endpoint families: `/oauth/mcp` requires a token (what stores list, so connecting triggers
  sign-in); `/mcp` stays open for anonymous and header clients and accepts tokens too.
- Disabled unless `PUBLIC_BASE_URL` is set, so existing deployments are unchanged.

## Consequences

- Wallet-based grants reuse the signed timestamp for the grant's lifetime; if TronSave stops accepting
  an old signature, tools fail with `UPSTREAM_UNAUTHORIZED` and the user reconnects.
- Dynamic registration accepts any redirect URI (standard for MCP); the consent page shows the client
  name and redirect host so users can spot impostors.
- Rate limits use the client IP; `TRUST_PROXY` must match the proxy chain in production.
