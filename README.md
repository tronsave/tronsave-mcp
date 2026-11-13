# TronSave MCP Server

![MCP](https://img.shields.io/badge/MCP-2025--11--25-blue)
![Transport](https://img.shields.io/badge/Transport-Streamable%20HTTP-green)
![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

An agent-native [Model Context Protocol](https://modelcontextprotocol.io) server for [TronSave](https://tronsave.io): AI agents can quote, buy and manage TRON **ENERGY / BANDWIDTH** and TronSave accounts through 53 typed tools.

| | |
|---|---|
| Mainnet endpoint | `https://mcp.tronsave.io/mcp` |
| Testnet (Nile) endpoint | `https://mcp.tronsave.io/testnet/mcp` |
| Transport | Streamable HTTP (`POST`, JSON responses); legacy SSE at `/sse` |
| Auth | none · OAuth 2.1 sign-in at `/oauth/mcp` (API key or TronLink) · `Authorization: ApiKey <key>` header · `tronsave_login` tool |

**Documentation**

- [Setup guide for Claude Code, Cursor and Claude](docs/CONNECT.md) — for end users, step by step (also at `GET /connect`).
- [Integration quickstart](MCP_SERVER_QUICKSTART.md) — connect Claude, Cursor, VS Code, OpenAI Agents or your own runtime (also served at `GET /quickstart`).
- [Tool reference](docs/TOOLS.md) — every tool, input and output (generated from code).
- [Agent guide](docs/AGENT_GUIDE.md) — the operating rules the server sends to agents (also exposed as MCP resource `tronsave://guide/agent`).
- [SKILL.md](SKILL.md) — drop-in skill/system-prompt for agent frameworks.
- [CHANGELOG](CHANGELOG.md) · [Architecture decisions](docs/adr/)

## What makes it agent-native

- **Self-describing.** `initialize` returns `instructions` (auth model, units, buy workflow, safety rules); every tool has an action-oriented description, strict `inputSchema`, an `outputSchema` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).
- **No out-of-band setup.** Agents log in with a tool call; the login binds to the MCP connection automatically. Static clients can use an `Authorization: ApiKey` header instead. `tronsave_get_session_status` tells the agent what it can do right now.
- **Actionable errors.** Failures are `isError` results with `{"error":{"code","message","retryable","hint"}}`; the hint names the next tool to call.
- **Safe writes.** Writes are never retried automatically (no duplicate orders); a timeout on a write is reported as "outcome unknown — verify first". Successful writes are never turned into errors by response-schema drift.
- **Secrets stay out of the model.** API keys are masked in tool output and never logged; signing always happens in the user's wallet.
- **Resources & prompts.** `tronsave://guide/agent` resource and `buy_resource` / `account_overview` prompts.

## Tools at a glance

53 tools in two payment paths. **Market path**: public quotes, plus orders paid on-chain or managed with a wallet signature. **Internal-balance path** (`tronsave_internal_*`): orders paid from a pre-funded TronSave balance with an API key, for bots and backends. Each tool description says when to use its counterpart on the other path.

| Group | Tools | Auth |
|---|---|---|
| Session | `get_session_status`, `get_sign_message`, `login`, `logout` | public |
| Market data | `get_market_overview`, `get_price_table`, `get_system_info`, `get_min_price`, `list_order_books`, `get_account_resources` | public |
| Quote and buy | `estimate_buy_resource`, `suggest_create_order`, `create_order`, `list_orders` | public (on-chain payment) |
| Extend | `list_extendable_receivers`, `list_extendable_delegates` | public |
| Flash unstake | `list_flash_unstake_orders`, `estimate_flash_unstake`, `get_flash_unstake_request` | public / wallet |
| Orders | `get_order`, `update_order`, `cancel_order`, `sell_order_manual` | wallet signature |
| Account | `get_user_info`, `get_user_permissions`, `get_referral`, `generate_api_key`, `revoke_api_key` | wallet signature |
| Auto-sell | `get_user_auto_setting`, `register_auto_sell`, `update_auto_sell_setting`, `get_seller_stats`, `list_delegations` | wallet signature |
| Auto-buy and bulk | `list_auto_buy_settings`, `create_auto_buy_setting`, `update_auto_buy_setting`, `delete_auto_buy_setting`, `bulk_create_internal_orders` | wallet signature |
| Alerts | `list_notifications`, `mark_notifications_read`, `get_telegram_notify_setting`, `update_telegram_notify_setting`, `get_agency_bot` | wallet signature |
| Internal balance | `get_internal_account`, `get_deposit_address`, `list_internal_transactions`, `internal_order_book`, `internal_order_estimate`, `internal_order_create`, `internal_order_history`, `internal_order_details`, `internal_extend_delegates`, `internal_create_extend_request` | API key (`list_internal_transactions`: wallet) |

All names carry the `tronsave_` prefix. Full details: [docs/TOOLS.md](docs/TOOLS.md).

## Connect in 30 seconds

Claude Code:

```bash
claude mcp add --transport http tronsave https://mcp.tronsave.io/mcp \
  --header "Authorization: ApiKey YOUR_TRONSAVE_API_KEY"   # header optional
```

Any client that accepts a remote MCP URL:

```json
{
  "mcpServers": {
    "tronsave": {
      "url": "https://mcp.tronsave.io/mcp",
      "headers": { "Authorization": "ApiKey YOUR_TRONSAVE_API_KEY" }
    }
  }
}
```

Apps that support OAuth (Claude, ChatGPT, Cursor, VS Code) can use `https://mcp.tronsave.io/oauth/mcp` instead: the user signs in on a TronSave page with an API key or TronLink. Without a header the agent can still use all public tools and log in with `tronsave_login`. More clients: [quickstart](MCP_SERVER_QUICKSTART.md).

## Run it yourself

Requirements: Node.js ≥ 22, Redis ≥ 6.2.

```bash
npm ci
cp .env.example .env
npm run dev                          # or: npm run build && npm start
# or with Docker (point REDIS_URL in .env at your Redis)
docker compose up --build
```

| Variable | Default | Purpose |
|---|---|---|
| `MCP_PORT` | `3000` | HTTP port |
| `REDIS_URL` | `redis://localhost:6379` | Session store. `memory` keeps sessions in the process (single instance, lost on restart; for trials only) |
| `SESSION_TTL_SECONDS` | `86400` | Login / MCP session lifetime (sliding for the transport) |
| `SIGNATURE_MAX_AGE_SECONDS` | `86400` | Oldest signed timestamp accepted for wallet login / `Signature` header |
| `SIGN_MESSAGE_TTL_SECONDS` | `300` | TTL of nonces issued by `tronsave_get_sign_message` |
| `AUTH_VERIFY_CACHE_TTL_SECONDS` | `60` | Cache for verified ApiKey / Signature headers |
| `GRAPHQL_TIMEOUT_MS` / `REST_TIMEOUT_MS` | `10000` | Per-attempt upstream timeout |
| `REST_RETRIES` | `2` | Retries for idempotent reads only |
| `READINESS_UPSTREAM_TIMEOUT_MS` | `2000` | Upstream probe in `/readyz` |
| `LOG_LEVEL` | `info` | `debug` adds redacted tool input/output bodies |
| `MCP_SERVER_NAME` / `MCP_SERVER_VERSION` | `TronSave MCP Server` / `1.5.2` | Reported in `initialize` |
| `PUBLIC_BASE_URL` | unset | Public origin, e.g. `https://mcp.tronsave.io`. Enables the OAuth authorization server and `/oauth/mcp` |
| `OAUTH_ACCESS_TOKEN_TTL_SECONDS` / `OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `3600` / `2592000` | OAuth token lifetimes (wallet sign-ins are capped at `SIGNATURE_MAX_AGE_SECONDS`) |
| `TRUST_PROXY` | `1` | Reverse-proxy hops in front of the server (client IP for OAuth rate limits) |
| `METRICS_TOKEN` | — | When set, `/metrics` requires `Authorization: Bearer <token>` (set it whenever `/metrics` is public) |
| `TRONSAVE_NETWORK` | `mainnet` | stdio only: `mainnet` or `testnet` (HTTP takes the network from the URL) |
| `TRONSAVE_API_KEY` | — | stdio only: sent as `Authorization: ApiKey <key>`; unset = public tools until `tronsave_login` |

HTTP endpoints: `POST|DELETE /mcp`, `POST|DELETE /testnet/mcp`, with `PUBLIC_BASE_URL` also `POST|DELETE /oauth/mcp`, `/oauth/testnet/mcp` and the OAuth endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/*`, `/authorize`, `/token`, `/register`, `/revoke`, `/oauth/signin`), `GET /` (server info), `GET /healthz`, `GET /readyz`, `GET /metrics` (Prometheus), `GET /quickstart`, legacy `GET /sse` + `POST /messages`.

### Local stdio server

`npm ci && npm run start:stdio` (or `node dist/stdio.js`; `npm ci` builds `dist/` through `prepare`) serves the same 53 tools over stdio for one
local client, without Redis (`REDIS_URL` defaults to `memory`; logs go to stderr). For example in a client config:

```json
{ "mcpServers": { "tronsave": { "command": "node", "args": ["/path/to/tronsave-mcp/dist/stdio.js"],
  "env": { "TRONSAVE_NETWORK": "mainnet", "TRONSAVE_API_KEY": "<optional>" } } } }
```

The hosted endpoint needs no install and is the recommended way to connect; stdio is for self-hosting and testing.

### Scaling

The Streamable HTTP endpoint is stateless per request: session continuity (transport marker + login) lives in Redis, so any number of replicas can serve the same client without sticky sessions, and restarts are transparent. Only the legacy SSE endpoint needs sticky routing.

## Development

```bash
npm run typecheck
npm test              # unit + HTTP session-flow tests (in-memory Redis stub)
npm run test:cov      # with coverage gate
npm run docs:tools    # regenerate docs/TOOLS.md and docs/AGENT_GUIDE.md after changing tools
BASE=http://127.0.0.1:3000/mcp npm run smoke   # end-to-end check against a running server (throwaway wallet)
```

Project layout:

```txt
src/
├── app/                 composition root + shutdown registry
├── clients/ infra/http  GraphQL/REST clients on a shared retry + circuit-breaker HttpClient
├── config/              env + constants (network endpoints)
├── handlers/            Express app, Streamable HTTP + legacy SSE, request auth context
├── mcp/agentGuide.ts    server instructions, guide resource, prompts
├── services/            auth (headers/sessions), sessions, signature verification, Redis
├── tools/               definitions (schemas + descriptions), handlers, adapters, docs renderer
├── tools.ts             registration: auth gate, error envelope, metrics, logging
└── utils/               errors, responses, logging, redaction, metrics
```

Adding a tool: add the name in `src/tools/toolNames.ts`, the schemas in `definitions/*/schema.ts`, the definition (description, `auth.mode`, annotations) and a handler, update `tests/tools/toolsCount.test.ts`, then run `npm run docs:tools`.

Releasing: bump `package.json`, `server.json` and the CHANGELOG, merge, then run `npm run publish:public` from a clean checkout. It appends the release as one snapshot commit (no private history) to https://github.com/tronsave/tronsave-mcp, tags `vX.Y.Z` and creates the GitHub release; then `mcp-publisher publish` updates the MCP Registry.

## Security

- Never send private keys or seed phrases to the server or the agent; all signing is client-side.
- `mcp-session-id` values of logged-in sessions are bearer credentials until they expire or `DELETE /mcp` / `tronsave_logout` is called.
- Run Redis on a private network with auth/TLS; it holds session credentials.
- Logs redact keys, signatures and session ids; tool bodies are only logged at `debug` and never for `tronsave_generate_api_key`.

## License

MIT — see [LICENSE](LICENSE).
