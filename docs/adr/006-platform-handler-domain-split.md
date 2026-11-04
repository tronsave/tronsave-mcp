# ADR 006: Split Platform Handler by Domain + gql/types

## Status

Accepted

## Context

`src/tools/handlers/platform.ts` (then `platform/all.ts`) had grown into a large mixed-responsibility file containing:

- auth/session flows
- users/tooling flows
- order flows
- market estimate/query flows
- auto-sell flows
- inlined GraphQL documents
- inlined GraphQL response envelope types

This made ownership unclear and raised regression risk for production maintenance.

## Decision

Keep MCP behavior backward-compatible, but split implementation into:

- domain handler modules:
  - `src/tools/handlers/platform/auth.ts`
  - `src/tools/handlers/platform/users.ts`
  - `src/tools/handlers/platform/orders.ts`
  - `src/tools/handlers/platform/market.ts`
  - `src/tools/handlers/platform/autoSell.ts`
- GraphQL operations:
  - `src/tools/handlers/platform/gql/*.ts`
- GraphQL response envelope types:
  - `src/tools/handlers/platform/types/*.ts`
- composition entrypoint:
  - `src/tools/handlers/platform/index.ts`

No tool names, schemas, route paths, or response wrapper contracts were changed.

## Consequences

### Positive

- Smaller modules with clearer domain boundaries.
- Query/mutation text and response envelope types become reusable and test-friendly.
- Lower merge conflict rate for ongoing platform feature work.

### Trade-offs

- More files and exports to maintain.
- Slightly higher import wiring complexity in exchange for maintainability.
