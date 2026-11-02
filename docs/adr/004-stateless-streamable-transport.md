# ADR 004: Stateless streamable transport for `/mcp`

## Status

Accepted (Sprint 2); implemented as described below in v1.1.0 (2026-10).

## Context

The server previously retained `StreamableHTTPServerTransport` instances in memory keyed by `mcp-session-id`. This stateful model complicates horizontal scaling because requests may hit different pods unless sticky sessions are configured.

## Decision

- Use stateless mode for streamable endpoints: each `POST /mcp` and `POST /testnet/mcp` creates a new MCP server + transport, handles one request, then disposes.
- Keep route paths unchanged (`/mcp`, `/testnet/mcp`, `/sse`, `/messages`) to avoid client breaking changes.
- Keep `GET /mcp` and `DELETE /mcp` routes but return `405` with explicit guidance in stateless mode.
- Legacy SSE remains stateful and is cleaned via janitor + onclose.

## Consequences

- Works better with load-balanced deployments without sticky-session requirements.
- Server-initiated notifications over persistent streamable sessions are intentionally not used in current architecture.


## Update 2026-10 (v1.1.0): implementation

Before v1.1.0 the code still kept one `StreamableHTTPServerTransport` + `McpServer` per session in
memory for up to 24 h (memory growth, no multi-replica support, every restart dropped sessions and
logins). The implementation now matches this ADR while keeping MCP session semantics, which the
login flow depends on (`tronsave_login` binds credentials to `mcp-session-id`):

- Every `POST` builds a fresh server + transport (`enableJsonResponse: true`) and disposes it when the response closes.
- `initialize` stores a marker `mcp:transport:<id>` in Redis (TTL `SESSION_TTL_SECONDS`, sliding on use).
- Non-initialize requests: unknown id → HTTP 404 (spec: client re-initializes); known id → the transport is
  rehydrated with that id (`rehydrateTransport`, which touches SDK internals and is locked by a test).
- Sessions created before the upgrade remain valid if they hold a login (`auth:session:<id>`).
- `DELETE` removes both the marker and the login.
