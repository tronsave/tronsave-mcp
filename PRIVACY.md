# TronSave MCP — data handling

> TronSave's privacy policy is https://tronsave.io/privacy-policy and its terms are
> https://tronsave.io/term-of-service. This page adds what the MCP connector software in this repository
> does with data; where the two differ, the privacy policy governs. Retention values are the defaults in `.env.example`; deployments may change them.

## What the server receives

| Data | From | Why |
|---|---|---|
| Tool arguments (addresses, amounts, order ids, settings) | The AI client | To call the TronSave API on the user's behalf |
| TronSave API key | `Authorization`/`x-api-key` header, `tronsave_login`, or the OAuth sign-in page | To call TronSave internal-account endpoints |
| Wallet signature over a timestamp (`<signature>_<timestamp>`) and the wallet address recovered from it | `tronsave_login`, `Signature` header, or the OAuth sign-in page | To prove wallet ownership and call TronSave account endpoints |
| Wallet-signed transactions (`signedTx`, `paymentSignedTx`) | The AI client | Forwarded to TronSave to settle a payment or sale the user approved |
| OAuth client registrations (client name, redirect URIs) | AI platforms (ChatGPT, Claude, …) | To run the OAuth 2.1 flow |
| IP address, user agent | HTTP request | Transport only; not stored by the application |

The server **never** receives, asks for or stores private keys or seed phrases.

## What is stored, where, and for how long

All state lives in the operator's Redis instance:

| Record | Contents | Retention |
|---|---|---|
| Login session (`auth:session:*`) | API key and/or signature token + wallet address | `SESSION_TTL_SECONDS` (24 h), or until `tronsave_logout` / `DELETE /mcp` |
| MCP connection marker (`mcp:transport:*`) | Creation time | 24 h, sliding while used |
| Verification caches (`auth:*-verified:*`) | Hash of the credential, wallet address | `AUTH_VERIFY_CACHE_TTL_SECONDS` (60 s) |
| Sign-in nonces (`auth:sign-message:*`) | Timestamp | 5 min |
| OAuth clients (`oauth:client:*`) | Client metadata from dynamic registration | 180 days |
| OAuth authorization codes / pending sign-ins | Credentials being linked | 5–10 min, single use |
| OAuth access tokens (`oauth:at:*`) | SHA-256 of the token → linked credentials | 1 h |
| OAuth refresh tokens (`oauth:rt:*`) | SHA-256 of the token → linked credentials | 30 days (24 h for wallet sign-ins), rotated on use, deleted on revoke |

Tokens are stored only as SHA-256 hashes. Credentials linked to a token are stored so the server can
call TronSave for the user; revoking the token (or the TronSave API key) removes access.

## Logs and metrics

- Application logs (JSON) record tool names, timings, error codes and a masked caller identity
  (e.g. `TQZVCmn…k6ED3`). API keys, signatures, signed transactions, session ids and authorization
  headers are redacted.
- Tool input/output bodies are logged only at `debug` level, redacted, and never for
  `tronsave_generate_api_key`.
- `/metrics` exposes aggregate counters (calls and errors per tool). No personal data.
- No third-party analytics or advertising SDKs are included.

## Sharing

Data is sent only to TronSave's own APIs (`api.tronsave.io`, `api-dashboard.tronsave.io`, and the
testnet equivalents) to perform the action the user requested. Signed transactions are relayed by
TronSave to the TRON network, where they become public as any blockchain transaction does.

## User controls

- Disconnect the connector in the AI client, or call `tronsave_logout`, to remove the login.
- Revoke the API key with `tronsave_revoke_api_key` or in the TronSave dashboard.
- OAuth tokens can be revoked by the client through the standard revocation endpoint.

## Contact

Operator: TronSave. Privacy contact: admin@tronsave.io · Telegram https://t.me/wantingtrx.
