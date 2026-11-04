import { vi } from "vitest";

/**
 * Avoid real TCP connections during unit tests — composition root still constructs `RedisService`,
 * but ioredis becomes an in-memory stub (one Map per client, TTLs ignored) so session flows
 * (initialize → login → tools/call) behave like the real store.
 */
vi.mock("ioredis", () => {
  const RedisMock = vi.fn(function RedisMock(this: unknown) {
    const store = new Map<string, string>();
    return {
      on: vi.fn(),
      status: "ready",
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      getdel: vi.fn(async (key: string) => {
        const value = store.get(key) ?? null;
        store.delete(key);
        return value;
      }),
      del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
      expire: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
      ping: vi.fn().mockResolvedValue("PONG"),
      quit: vi.fn().mockResolvedValue("OK"),
    };
  });
  return { Redis: RedisMock, default: RedisMock };
});
