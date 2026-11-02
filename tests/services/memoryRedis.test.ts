import { afterEach, describe, expect, it, vi } from "vitest";
import { isMemoryRedisUrl, RedisService } from "../../src/services/redisService";

describe("RedisService with REDIS_URL=memory", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recognises memory URLs only", () => {
    expect(isMemoryRedisUrl("memory")).toBe(true);
    expect(isMemoryRedisUrl("memory://")).toBe(true);
    expect(isMemoryRedisUrl("redis://localhost:6379")).toBe(false);
  });

  it("stores, reads, deletes and expires keys", async () => {
    vi.useFakeTimers();
    const store = new RedisService("memory");
    await store.setJson("a", { n: 1 }, 10);
    expect(await store.getJson("a")).toEqual({ n: 1 });
    expect(await store.exists("a")).toBe(true);

    vi.advanceTimersByTime(11_000);
    expect(await store.getJson("a")).toBeNull();
    expect(await store.exists("a")).toBe(false);

    await store.setJson("b", "x", 10);
    await store.expire("b", 60);
    vi.advanceTimersByTime(30_000);
    expect(await store.getJson("b")).toBe("x");
    expect(await store.getDel("b")).toBe('"x"');
    expect(await store.getDel("b")).toBeNull();

    await store.setJson("c", 1, 10);
    await store.delete("c");
    expect(await store.exists("c")).toBe(false);
    expect(await store.ping()).toBe("PONG");
    await store.disconnect();
  });
});
