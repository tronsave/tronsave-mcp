import { Redis } from "ioredis";
import { env } from "../config/env";

/** The slice of the ioredis API this service uses, so a process-local store can stand in for it. */
type KeyValueClient = Pick<Redis, "set" | "get" | "getdel" | "del" | "exists" | "expire" | "ping" | "quit" | "status">;

/**
 * `REDIS_URL=memory`: a process-local store with TTLs, for single-instance trials (directory
 * health checks, demos). Sessions and OAuth tokens are lost on restart and not shared between
 * replicas, so production keeps a real Redis.
 */
export const isMemoryRedisUrl = (url: string): boolean => /^memory(:|$)/i.test(url.trim());

class MemoryKeyValueClient {
  status = "ready";
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();

  private read(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<"OK"> {
    const expiresAt = mode === "EX" && ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async getdel(key: string): Promise<string | null> {
    const value = this.read(key);
    this.store.delete(key);
    return value;
  }

  async del(...keys: string[]): Promise<number> {
    return keys.filter((key) => this.read(key) !== null && this.store.delete(key)).length;
  }

  async exists(key: string): Promise<number> {
    return this.read(key) === null ? 0 : 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    const value = this.read(key);
    if (value === null) return 0;
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 1;
  }

  async ping(): Promise<"PONG"> {
    return "PONG";
  }

  async quit(): Promise<"OK"> {
    this.status = "end";
    return "OK";
  }
}

export class RedisService {
  private readonly redis: KeyValueClient;

  constructor(redisUrl: string = env.REDIS_URL) {
    this.redis = isMemoryRedisUrl(redisUrl)
      ? (new MemoryKeyValueClient() as unknown as KeyValueClient)
      : new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) > 0;
  }

  /** Sliding expiry; no-op when the key does not exist. */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  /**
   * Atomic GET + DELETE (Redis 6.2+). Used for single-use login nonces.
   * Trade-off: requires Redis ≥ 6.2; older servers should upgrade or use a Lua fallback in infra.
   */
  async getDel(key: string): Promise<string | null> {
    const raw = await this.redis.getdel(key);
    return raw ?? null;
  }

  async ping(): Promise<string> {
    return this.redis.ping();
  }

  async disconnect(): Promise<void> {
    if (this.redis.status === "end") {
      return;
    }
    try {
      await this.redis.quit();
    } catch (error) {
      // During dev hot-reload, Redis may already be closed by an earlier disposer.
      // Treat this as an idempotent disconnect to avoid noisy shutdown logs.
      if (error instanceof Error && error.message.includes("Connection is closed.")) {
        return;
      }
      throw error;
    }
  }
}
