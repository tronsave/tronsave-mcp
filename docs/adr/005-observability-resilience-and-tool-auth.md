# ADR 005: Structured logging, resilient HTTP, and declarative tool auth

## Status

Accepted (Sprint 3)

## Context

The server needed production-grade logs, upstream failure isolation, and simpler tool auth policy management without maintaining hardcoded name sets.

## Decision

1. Replace console logger with `pino`, preserving `logger.info/warn/error` call shape.
   - Development uses `pino-pretty`.
   - Production emits JSON.
   - Built-in redaction censors sensitive fields.
2. Introduce shared `infra/http/HttpClient` abstraction:
   - timeout + retry with exponential backoff and jitter
   - `opossum` circuit breaker (`50%/10s`, `reset 30s`)
   - lightweight request metrics logging (`requestDurationMs`, `breakerState`)
3. Add declarative `ToolDefinition.auth.mode` with values:
   - `public`
   - `session`
   - `signature-session`
   Runtime gate checks now read this mode instead of separate tool-name sets.

## Consequences

- Adding new tools is safer: auth policy lives beside tool definition metadata.
- Upstream outages fail faster once the breaker opens, reducing cascade effects.
- Log consumers receive structured JSON consistently in production.


## Update 2026-10 (v1.1.0)

- Retries apply to idempotent requests only (REST GET/HEAD, read-only POSTs that opt in, GraphQL queries) and also to 429/502/503/504. GraphQL mutations and REST writes are never retried, preventing duplicate orders.
- The breaker no longer has its own timeout (it fired while retries were still running); per-attempt `AbortController` timeouts remain.
- Upstream failures map to `UPSTREAM_TIMEOUT` / `UPSTREAM_UNREACHABLE` / `UPSTREAM_UNAVAILABLE` / `UPSTREAM_UNAUTHORIZED`; error bodies are truncated to 300 chars.
- `session` mode accepts any authenticated identity (login or verified `ApiKey`/`Bearer` header); `signature-session` accepts signature logins and verified `Signature` headers. `cancel`, `update` and `sell_order_manual` moved from `public` to `signature-session`.
- Tool bodies are logged at `debug` only; tools with `sensitiveOutput` never log output. `/metrics` serves Prometheus counters.
