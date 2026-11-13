---
version: 1.5.2
updatedAt: 2026-11-02
---

# TronSave MCP — Integration Quickstart

Connect any MCP-capable agent to TronSave to quote, buy and manage TRON **ENERGY / BANDWIDTH**.

| | |
|---|---|
| Mainnet | `https://mcp.tronsave.io/mcp` |
| Testnet (Nile) | `https://mcp.tronsave.io/testnet/mcp` |
| Protocol | MCP Streamable HTTP, protocol versions `2024-11-05` … `2025-11-25` |
| Tool reference | [docs/TOOLS.md](docs/TOOLS.md) (53 tools; every tool states its access level in `_meta["io.tronsave/auth"]`) |
| Agent rules | [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) — also sent automatically in `initialize.instructions` and served as the resource `tronsave://guide/agent` |
| Prompts | `buy_resource`, `account_overview` |

> Start on **testnet** while integrating. The network is chosen only by the URL path.

---

## 1. Choose how the agent authenticates

| Mode | How | Unlocks | Best for |
|---|---|---|---|
| **OAuth sign-in** (recommended for apps) | connect to `https://mcp.tronsave.io/oauth/mcp`; the client opens a TronSave sign-in page where the user enters an API key or signs with TronLink | API key and/or wallet tools, depending on how the user signs in | Claude, ChatGPT, Cursor, VS Code and any OAuth-capable MCP client |
| **None** | nothing | market data, quotes, order list, `tronsave_create_order` with `paymentMethod=onchain` | price bots, read-only assistants |
| **API key (header)** | client header `Authorization: ApiKey <key>` (also `Bearer <key>` or `x-api-key: <key>`) | + internal balance, deposit address, extend requests, `paymentMethod=internal` | server-side agents, static client configs |
| **API key (tool)** | agent calls `tronsave_login` with `{ "apiKey": "<key>" }` | same as above | clients that cannot set headers |
| **Wallet signature** | `tronsave_get_sign_message` → user signs in their wallet → `tronsave_login` with `{ "signature": "<sig>_<timestamp>" }` | + profile, order update/cancel/manual sell, auto-sell, API-key management (and internal tools if the wallet has an internal account) | end-user wallets, dashboards |

Notes:

- A tool login is bound to the MCP connection (`mcp-session-id`); the client resends that header automatically, so the agent never handles session ids. `tronsave_logout` or `DELETE /mcp` ends it.
- Get an API key from the TronSave dashboard, or with `tronsave_generate_api_key` after a wallet login.
- The agent can always call `tronsave_get_session_status` to see what is unlocked.
- **Never** give private keys or seed phrases to an agent or to this server.

---

## 2. Connect your client

End users: the step-by-step guide with sign-in and troubleshooting is at https://mcp.tronsave.io/connect.

### Claude Code

```bash
claude mcp add --transport http tronsave https://mcp.tronsave.io/mcp
# with an API key:
claude mcp add --transport http tronsave https://mcp.tronsave.io/mcp \
  --header "Authorization: ApiKey YOUR_TRONSAVE_API_KEY"
```

### Claude Desktop / claude.ai

Settings → Connectors → **Add custom connector** → URL `https://mcp.tronsave.io/oauth/mcp` → **Connect**. A TronSave sign-in page opens: enter an API key or sign with TronLink. (Use `/mcp` instead for anonymous market tools; the agent can still log in with `tronsave_login`.)

### Cursor (`~/.cursor/mcp.json`) and other `mcpServers` clients

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

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "tronsave": {
      "type": "http",
      "url": "https://mcp.tronsave.io/mcp",
      "headers": { "Authorization": "ApiKey ${input:tronsaveApiKey}" }
    }
  },
  "inputs": [{ "id": "tronsaveApiKey", "type": "promptString", "description": "TronSave API key", "password": true }]
}
```

### Anthropic Messages API (MCP connector)

```json
"mcp_servers": [
  { "type": "url", "name": "tronsave", "url": "https://mcp.tronsave.io/mcp", "authorization_token": "YOUR_TRONSAVE_API_KEY" }
]
```

(`authorization_token` is sent as `Authorization: Bearer …`, which the server accepts as an API key.)

### OpenAI Agents SDK (Python)

```python
from agents import Agent
from agents.mcp import MCPServerStreamableHttp

tronsave = MCPServerStreamableHttp(params={
    "url": "https://mcp.tronsave.io/mcp",
    "headers": {"Authorization": "ApiKey YOUR_TRONSAVE_API_KEY"},
})
async with tronsave:
    agent = Agent(name="energy-buyer", mcp_servers=[tronsave])
```

### OpenAI Responses API (remote MCP tool)

```json
{ "type": "mcp", "server_label": "tronsave", "server_url": "https://mcp.tronsave.io/mcp",
  "headers": { "Authorization": "ApiKey YOUR_TRONSAVE_API_KEY" }, "require_approval": "always" }
```

### Legacy SSE clients

`GET https://mcp.tronsave.io/sse` (mainnet only). Prefer Streamable HTTP.

---

## 3. Raw HTTP (custom runtimes)

All calls are `POST` with JSON-RPC 2.0 bodies and these headers:

```
Content-Type: application/json
Accept: application/json, text/event-stream
```

Responses are plain JSON (`Content-Type: application/json`).

**Step 1 — initialize** and keep the `mcp-session-id` response header:

```bash
curl -si https://mcp.tronsave.io/testnet/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0.0"}}}'
```

The result contains `instructions` — put them in your agent's system prompt.

**Step 2 — send `notifications/initialized`**, then list tools (send `mcp-session-id` on every request from now on):

```bash
SID=...   # value of the mcp-session-id header
H=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "mcp-session-id: $SID")
curl -s https://mcp.tronsave.io/testnet/mcp "${H[@]}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
curl -s https://mcp.tronsave.io/testnet/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

**Step 3 — call tools:**

```bash
curl -s https://mcp.tronsave.io/testnet/mcp "${H[@]}" -d '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{"name":"tronsave_estimate_buy_resource",
            "arguments":{"receiver":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","buyResourceAmount":65000,"durationSec":3600}}}'
```

Successful results carry `structuredContent` (typed per the tool's `outputSchema`) and the same JSON in `content[0].text`.

**Step 4 — end the session** (also logs out):

```bash
curl -s -X DELETE https://mcp.tronsave.io/testnet/mcp -H "mcp-session-id: $SID"
```

Session behaviour:

- Sessions survive server restarts and work across replicas; idle sessions expire after `SESSION_TTL_SECONDS` (default 24 h).
- An unknown or expired session returns **HTTP 404** — re-run `initialize` (and log in again).
- `GET /mcp` returns 405: the server does not push notifications.

### OAuth details (for client developers)

| Item | Value |
|---|---|
| Protected resources | `/oauth/mcp`, `/oauth/testnet/mcp` (token required) · `/mcp`, `/testnet/mcp` (token optional) |
| Resource metadata (RFC 9728) | `https://mcp.tronsave.io/.well-known/oauth-protected-resource/oauth/mcp` (one per resource path) |
| Authorization server metadata (RFC 8414) | `https://mcp.tronsave.io/.well-known/oauth-authorization-server` |
| Endpoints | `/authorize`, `/token`, `/register` (dynamic client registration, RFC 7591), `/revoke` |
| Flow | Authorization code + PKCE `S256` only; public clients (`token_endpoint_auth_method: none`) supported |
| Scope | `tronsave` |
| Tokens | Access 1 h (`tsv_at_…`), refresh 30 days (`tsv_rt_…`, rotated on every use). Wallet sign-ins end when the signature expires (24 h): the user signs in again |
| Network binding | A token works only on the network of the `resource` it was issued for (mainnet vs `/testnet/`) |

Unauthenticated calls to `/oauth/mcp` get `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, which
starts the standard MCP authorization flow. On `/mcp`, tool errors that need a login carry
`_meta["mcp/www_authenticate"]` so hosts that support account linking (e.g. ChatGPT) can prompt for it.

---

## 4. Wallet signature login

```ts
// 1) get the message
const { message, timestamp } = (await callTool("tronsave_get_sign_message", {})).structuredContent;
// 2) the USER's wallet signs it (TronLink: window.tronWeb.trx.signMessageV2)
const signature = await tronWeb.trx.signMessageV2(message);
// 3) log in
await callTool("tronsave_login", { signature: `${signature}_${timestamp}` });
```

- Signing the plain decimal timestamp (`String(timestamp)`) is accepted too.
- The signed timestamp must be younger than `SIGNATURE_MAX_AGE_SECONDS` (default 24 h) and not in the future; otherwise `SIGNATURE_EXPIRED`.
- The wallet address is recovered from the signature; it is never taken from client input.
- Static alternative: header `Authorization: Signature <sig>_<timestamp>` (expires with the timestamp, so prefer API keys for static configs).

---

## 5. Buying ENERGY — the canonical flow

1. `tronsave_estimate_buy_resource` `{ receiver, buyResourceAmount, durationSec }` → `unitPrice` (SUN), `estimateTrx` (**SUN**), `availableResource`, `systemDepositAddress`.
2. Show the user: receiver, amount, duration, unit price, total in TRX (`estimateTrx / 1e6`). Wait for explicit confirmation.
3. `tronsave_create_order` (illustrative values — always use the numbers from step 1):
   ```json
   {
     "orderResourceType": "ENERGY",
     "orderReceiver": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
     "orderUnitPrice": 60,
     "orderDurationSec": 3600,
     "orderResourceAmount": 65000,
     "paymentMethod": "internal",
     "paymentPaymentAmount": 3900000
   }
   ```
   - `internal`: debits the TronSave internal balance (API key needed). Top up via `tronsave_get_deposit_address` (TRX, min 10).
   - `onchain`: no login, but add `paymentSignedTx` = the user's wallet-signed TRX transfer of `paymentPaymentAmount` SUN to `systemDepositAddress`.
4. Check `success` and `data.orderId`; verify with `tronsave_get_order` (wallet login) or `tronsave_list_orders`.

Units: 1 TRX = 1,000,000 SUN. Prices are SUN per resource unit: under 1 day a price covers the whole rental, from 1 day up it is charged per started day (use `estimateTrx` for the total). Durations are seconds. `extendTo` in the internal extend tools is epoch seconds.

---

## 6. Errors

Tool failures come back as a normal tool result with `isError: true`:

```json
{ "error": { "code": "SESSION_REQUIRED", "message": "`tronsave_get_internal_account` requires authentication.",
             "retryable": false, "hint": "Api-key: call `tronsave_login` with `apiKey` ..." } }
```

| Code | Action |
|---|---|
| `SESSION_REQUIRED`, `API_KEY_SESSION_REQUIRED`, `INVALID_SESSION_TYPE` | Log in with the mode named in `hint` |
| `INVALID_API_KEY`, `INVALID_SIGNATURE`, `SIGNATURE_EXPIRED`, `UPSTREAM_UNAUTHORIZED` | Fix or refresh credentials |
| `GRAPHQL_ERROR`, `REST_ERROR` | Business rule rejected the request — read `message`, fix inputs |
| `UPSTREAM_TIMEOUT`, `UPSTREAM_UNREACHABLE`, `UPSTREAM_UNAVAILABLE` | Reads: retry later (`retryable: true`). **Writes: verify state before any retry** |
| `INTERNAL_ERROR` | Report to TronSave |

Argument problems are reported as `Input validation error: …` tool errors listing the offending fields.

Rules for agents: follow `hint`; never repeat a write when `retryable` is `false`; back off on rate limits.

---

## 7. Safety checklist for integrators

- Require human confirmation for every tool whose annotation is not `readOnlyHint: true` (e.g. `require_approval: "always"` in OpenAI, tool permissions in Claude).
- Keep API keys in your secret store; they are never echoed back by the server (`internalAccount.apiKey` is masked).
- `tronsave_generate_api_key` returns a new secret once — show it to the user, do not log or repeat it.
- Treat a logged-in `mcp-session-id` as a credential; call `tronsave_logout` / `DELETE` when done.
- Test on `/testnet/mcp` first.

Support: admin@tronsave.io · issues at https://github.com/tronsave/tronsave-mcp
