# Changelog

## 1.4.0 — 2026-11-02

### Added
- **stdio transport**: `node dist/stdio.js` (`npm run start:stdio`) serves the same 53 tools to one local client.
  `TRONSAVE_NETWORK` picks mainnet or testnet, `TRONSAVE_API_KEY` stands in for the `Authorization` header,
  `tronsave_login` works for the life of the process. No Redis needed (`REDIS_URL` defaults to `memory`);
  logs go to stderr.
- `REDIS_URL=memory` runs the HTTP server without Redis (single instance; trials only).
- End-user setup guide for Claude Code, Cursor and Claude in `docs/CONNECT.md`, served at `GET /connect`.
- `METRICS_TOKEN` protects `GET /metrics`; discovery documents (`/.well-known/mcp.json`, `/llms.txt`) list OAuth.
- Cursor plugin manifest (`.cursor-plugin/`), MIT license.

### Fixed
- `docs/TOOLS.md` lists all 53 tools (it covered only the public and session tools).

## 1.3.0 — 2026-11-02

### Added
- **Built-in OAuth 2.1 authorization server** (enabled when `PUBLIC_BASE_URL` is set): RFC 8414 metadata,
  RFC 9728 protected-resource metadata for every MCP endpoint, dynamic client registration (RFC 7591),
  authorization code + PKCE S256, refresh-token rotation, revocation. Built on the MCP SDK's auth router.
- TronSave sign-in page for the authorization step: API key or TronLink wallet signature (or a pasted
  signature from any wallet), with consent text, CSP nonce, no-store/no-frame headers and rate limiting.
- OAuth-only MCP endpoints `/oauth/mcp` and `/oauth/testnet/mcp` (401 + `WWW-Authenticate` challenge).
  `/mcp` keeps anonymous/header access and also accepts OAuth tokens; its auth errors carry
  `_meta["mcp/www_authenticate"]` for account-linking hosts.
- Store submission kit: `listing/` (shared copy, per-store playbook, ready-to-paste submissions),
  `PRIVACY.md` data-handling summary, `assets/logo/` icons. `server.json` lists the OAuth endpoint.
- `tronsave_get_session_status` reports `source: "oauth"`.

### Changed
- Credential checks shared by `tronsave_login` and OAuth sign-in (`CredentialService`).
- An OAuth bearer token takes precedence over a stored `tronsave_login` session on the same request.
- `express` and `express-rate-limit` are direct dependencies; new env `TRUST_PROXY` (default 1).

### Deploy notes
- Set `PUBLIC_BASE_URL=https://mcp.tronsave.io` and make sure the reverse proxy forwards `/.well-known/*`,
  `/authorize`, `/token`, `/register`, `/revoke` and `/oauth/*` to the server.
- Tokens are network-bound: a token issued for `/oauth/mcp` does not work on `/oauth/testnet/mcp`.
- Wallet sign-ins last as long as TronSave accepts the signature (`SIGNATURE_MAX_AGE_SECONDS`, 24 h):
  access and refresh tokens are capped at that point and refresh is refused afterwards, so the host
  asks the user to sign in again instead of getting failing calls.

## 1.2.0 — 2026-10-24

Brings the deployed `dev` tools into the v1.1.0 architecture and covers the rest of the TronSave API surface (53 tools, was 25). Nothing is removed or renamed.

### Added
- Restored from `dev`: `tronsave_internal_order_history`, `_order_details`, `_order_book`, `_order_estimate`, `_order_create`, `tronsave_internal_extend_delegates` (without these, deploying 1.1.0 would have dropped live tools). Quotes retry like reads; creates never retry.
- Public market tools: `tronsave_get_market_overview`, `_get_price_table`, `_get_system_info`, `_get_account_resources`, `_suggest_create_order`, `_list_extendable_receivers`, `_list_flash_unstake_orders`, `_estimate_flash_unstake`.
- Seller/account tools (wallet signature): `tronsave_get_seller_stats`, `_list_delegations`, `_list_auto_buy_settings`, `_create_auto_buy_setting`, `_update_auto_buy_setting`, `_list_notifications`, `_mark_notifications_read`, `_get_referral`, `_get_telegram_notify_setting`, `_update_telegram_notify_setting`, `_get_agency_bot`, `_list_internal_transactions`, `_get_flash_unstake_request`, `_bulk_create_internal_orders`.
- `tools/list` carries each tool's login requirement as `_meta["io.tronsave/auth"]` (`public` | `session` | `signature-session`), so clients and generated docs don't have to parse descriptions.
- `GET /llms.txt` and `GET /.well-known/mcp.json` discovery documents; `server.json` for the MCP registry.
- Testnet e2e covers 58 steps (`npm run e2e:testnet`, `WRITE=1` for state-changing steps).

### Fixed
- The default `MCP_SERVER_VERSION` (used when the env var is unset) still said 1.1.0.
- `extendTo` of the internal extend tools is Unix SECONDS; TronSave rejects milliseconds with `INVALID_EXTEND_TIME`. Tool schemas and docs said milliseconds.
- Auto-buy mutations send the internal api key upstream as well (`TSAS:101 Api key is required` otherwise).
- `tronsave_delete_auto_buy_setting` sends the internal api key.

### Notes from the testnet run
- Auto-buy rules: `thresholdResourceAmount` ≥ 100000, `limitBudgetInSun` > 10000000 and covered by the internal balance, one active rule per receiver, list page size ≤ 10 (delegations ≤ 50).
- Bulk buy: `paymentAmount` must equal the total payout within 2%.

## 1.1.0 — 2026-10-23

Agent-native hardening release. Endpoints and tool names are unchanged; see **Upgrade notes** for behaviour changes.

### Added
- `initialize` now returns `instructions` (auth model, units, buy workflow, safety rules).
- Tools `tronsave_get_session_status` and `tronsave_logout` (25 tools total).
- MCP resource `tronsave://guide/agent`; prompts `buy_resource`, `account_overview`.
- Header auth for static clients: `Authorization: ApiKey <key>`, `Authorization: Bearer <key>`, `x-api-key: <key>`, and verified `Authorization: Signature <sig>_<ts>`.
- Structured tool errors: `{"error":{"code","message","retryable","hint"}}`.
- `tronsave_login` returns `authMode`, `hasInternalApiKey`, `unlocked` (and `warnings` when the internal key could not be loaded).
- Prometheus counters at `/metrics`; server info at `GET /`.
- Generated docs (`docs/TOOLS.md`, `docs/AGENT_GUIDE.md`), new `MCP_SERVER_QUICKSTART.md`, `SKILL.md`, ADR 007, `npm run smoke`.

### Changed
- Streamable HTTP is stateless per request with sessions kept in Redis: horizontal scaling without sticky sessions, sessions survive restarts, no per-session memory. Unknown/expired sessions return HTTP 404 (clients re-initialize).
- Responses use `application/json` instead of an SSE frame.
- Tool output text is compact JSON.
- `tronsave_cancel_order`, `tronsave_update_order`, `tronsave_sell_order_manual` are gated as wallet-signature tools (previously they were sent upstream unauthenticated when no session existed).
- Writes (GraphQL mutations, REST POST) are never retried automatically; reads also retry on 429/502/503/504.
- Output schemas are validated leniently at runtime (missing/null/extra fields tolerated) so upstream drift cannot turn a successful write into an error.
- Inputs validate TRON addresses (`T…`, 34 chars) and integer amounts/durations.
- `tronsave_estimate_buy_resource` uses the logged-in wallet as `requester`; description now documents `estimateTrx` (SUN).
- `tronsave_get_deposit_address` returns `minimumDepositTrx` and `depositAddress` may be `null`.
- Node.js 22+ (Node 20 reached end-of-life); CI runs on Node 22 and 24 with a coverage gate.

### Fixed
- The default `MCP_SERVER_VERSION` (used when the env var is unset) still said 1.1.0.
- Signature login accepted signed timestamps of any age (replay). Now bounded by `SIGNATURE_MAX_AGE_SECONDS` (default 24 h) and ±5 min future skew.
- Signature login only verified the hex message despite documenting raw-text support; both now work.
- `Signature` header identity came from an unverified `x-address` header.
- `Authorization: ApiKey` headers never satisfied the tool gate; a pre-existing `mcp-session-id` also hid header credentials.
- API-key login created the session before validating the key.
- `tronsave_generate_api_key` output (a new secret) was logged at `info`; `tronsave_get_user_info` / `tronsave_get_internal_account` echoed the raw internal API key into model context (now masked).
- Circuit-breaker timeout fired while retries were still running.
- `GET /info` was routed to the legacy SSE POST handler (removed).
- Legacy SSE clients could not log in (no `mcp-session-id`); the SSE session id is now used.
- `tronsave_list_orders` docs described a `status` mapping and `onlyMyOrder` parameter that did not match the code.
- Two failing tests on `main` (removed `pending` payment method).

### Upgrade notes (integrators)
- If you parsed error **strings**, parse `content[0].text` as JSON and read `error.code` / `error.hint`.
- If you relied on cancel/update/manual-sell without a wallet login, log in with a signature first.
- If you reuse an old signed timestamp to log in, sign a fresh one (or raise `SIGNATURE_MAX_AGE_SECONDS` on self-hosted deployments).
- `internalAccount.apiKey` is now masked; use the key you already hold or generate a new one.
- Self-hosting: Redis ≥ 6.2 and Node ≥ 22; set `SIGNATURE_MAX_AGE_SECONDS` if needed. Existing logged-in sessions keep working after the deploy.

## 1.0.1 — 2026-05-08
- Removed the `pending` payment method from `tronsave_create_order`.
