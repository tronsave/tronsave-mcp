import { describe, expect, it, vi } from "vitest";
import { SessionService } from "../../src/services/sessionService";
import { REDIS_KEYS } from "../../src/config/constants";
import { env } from "../../src/config/env";

/**
 * Minimal redis double — `SessionService` only needs `setJson` / `getJson`.
 * Using a plain object instead of vi.fn-laden boilerplate keeps the test focused
 * on the service's persistence contract (TTL, key namespacing, payload shape).
 */
const makeFakeRedis = () => {
  const store = new Map<string, { value: unknown; ttlSeconds: number }>();
  return {
    setJson: vi.fn(async (key: string, value: unknown, ttlSeconds: number) => {
      store.set(key, { value, ttlSeconds });
    }),
    getJson: vi.fn(async (key: string) => {
      const entry = store.get(key);
      return entry ? entry.value : null;
    }),
    store,
  };
};

describe("SessionService.createSession", () => {
  it("persists session under namespaced key with SESSION_TTL_SECONDS TTL", async () => {
    const redis = makeFakeRedis();
    const service = new SessionService(redis as never);

    const session = await service.createSession(
      { apiKey: "k1", walletAddress: "TWallet" },
      "fixed-session-id",
    );

    const key = REDIS_KEYS.session("fixed-session-id");
    expect(redis.setJson).toHaveBeenCalledWith(key, session, env.SESSION_TTL_SECONDS);
    expect(session).toMatchObject({
      sessionId: "fixed-session-id",
      apiKey: "k1",
      walletAddress: "TWallet",
    });
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.expiresAt).toBe(session.createdAt + env.SESSION_TTL_SECONDS);
  });

  it("auto-generates a UUID sessionId when none is supplied", async () => {
    const redis = makeFakeRedis();
    const service = new SessionService(redis as never);

    const session = await service.createSession({ apiKey: "k2" });

    // RFC 4122 UUID v4-ish length sanity check — strict shape is not under test.
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("stores signature flow fields verbatim (including walletAddress)", async () => {
    const redis = makeFakeRedis();
    const service = new SessionService(redis as never);

    const session = await service.createSession(
      { signature: "sig_1234567890", walletAddress: "TWallet" },
      "sig-session",
    );

    expect(session.apiKey).toBeUndefined();
    expect(session.signature).toBe("sig_1234567890");
    expect(session.walletAddress).toBe("TWallet");
  });
});

describe("SessionService.getSession", () => {
  it("round-trips a session previously written via createSession", async () => {
    const redis = makeFakeRedis();
    const service = new SessionService(redis as never);

    const created = await service.createSession({ apiKey: "k" }, "round-trip");
    const fetched = await service.getSession("round-trip");

    expect(fetched).toEqual(created);
    expect(redis.getJson).toHaveBeenCalledWith(REDIS_KEYS.session("round-trip"));
  });

  it("returns null when key is absent", async () => {
    const redis = makeFakeRedis();
    const service = new SessionService(redis as never);

    const fetched = await service.getSession("missing");

    expect(fetched).toBeNull();
  });
});
