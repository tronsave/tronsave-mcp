# ADR 003: Vitest for unit tests

## Status

Accepted (Sprint 1)

## Context

Sprint 1 requires automated regression coverage for replay-safe nonce logic, log redaction, env parsing, and composition-root wiring without relying on production Redis.

## Decision

Use **Vitest** with `@vitest/coverage-v8`, Node environment, and `tests/setup.ts` that mocks `ioredis` `Redis` to prevent stray TCP connections in CI/dev laptops.

## Consequences

- Coverage thresholds can be raised in Sprint 4 (`coverage.thresholds`).
- Integration/E2E tests against real Redis remain complementary (not replaced).
