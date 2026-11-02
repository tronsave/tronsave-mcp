# ADR 002: Composition root + closure factories for tool handlers

## Status

Accepted (Sprint 1)

## Context

Several modules instantiated `new RedisService()` independently (`tools/handlers/platform.ts`, `helper.ts`). That multiplied Redis connections per process, complicated mocks, and made graceful shutdown ambiguous.

## Decision

Introduce `buildContainer()` in `src/app/container.ts` returning exactly one `redisService`, `sessionService`, `signatureService`, `authService`, and shared `clientsByNetwork`.

Expose HTTP helpers via `createHelper(container)` returning `{ fetchApiInternal, fetchGraphqlApi }`. Platform/internal handlers come from `createPlatformHandlers(...)` / `createInternalHandlers(...)`.

Wire MCP registration through `registerTools(server, tools)` where `tools` is assembled via `createAllTools(platformHandlers, internalHandlers)`.

## Consequences

- Slightly more verbose bootstrap (`src/index.ts`) but deterministic lifecycle.
- Avoid importing helpers during auth detection (`AuthService` calls REST directly with the injected client).
