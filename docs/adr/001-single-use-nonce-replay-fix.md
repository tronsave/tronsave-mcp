# ADR 001: Single-use nonce for timestamp signature login

## Status

Superseded (2026-10, v1.1.0) — see "Update 2026-10" below.

## Context

Previously `createSignMessage` did not persist a server-side nonce and `verifyLoginSignatureByTimestamp` did not enforce a server freshness window. Captured signatures could be replayed until externally invalidated.

## Decision

1. On `createSignMessage`, store JSON `{ walletAddress: null, createdAt }` at `REDIS_KEYS.signMessageByTimestamp(timestamp)` with TTL `SIGN_MESSAGE_TTL_SECONDS`.
2. On verify: enforce `|now - timestamp| <= SIGN_MESSAGE_TTL_SECONDS` (`INVALID_TIMESTAMP_WINDOW`).
3. After cryptographic verification succeeds, consume the nonce atomically via Redis `GETDEL`. Missing key ⇒ `NONCE_USED_OR_EXPIRED`.

Order is **window check → verify signature → GETDEL**. Invalid signatures therefore do not burn the nonce (better UX when clients typo payloads); replay remains blocked because verification must succeed before consumption.

## Consequences

- Requires Redis ≥ 6.2 for `GETDEL`; upgrade Redis before deploying if on older versions (see comment on `RedisService.getDel`).
- Clients must complete login within the TTL clock skew window.


## Update 2026-10 (v1.1.0)

The single-use nonce was later removed to support "direct signature" clients that sign their own
timestamp (the TronSave dashboard format), which left **no freshness check at all**: a leaked
`<signature>_<timestamp>` could create sessions forever. v1.1.0 restores a bounded window without
re-introducing the nonce:

- `verifyLoginSignatureByTimestamp` rejects timestamps older than `SIGNATURE_MAX_AGE_SECONDS`
  (default 86400) or more than 300 s in the future (`SIGNATURE_EXPIRED`). Millisecond timestamps are accepted.
- Both the hex `message` from `tronsave_get_sign_message` and the raw decimal timestamp are accepted as signed payloads.
- The same check guards `Authorization: Signature …` headers, which are now cryptographically verified
  (the wallet comes from the signature, never from `x-address`).
- `tronsave_get_sign_message` nonces are still written for compatibility but are not consumed.
