/**
 * Replay protection: every (keyid, nonce) pair may be seen once inside its validity window.
 * Use one shared store across all servers, otherwise a replayed request can hit a second server.
 */
export interface ReplayStore {
  /** Returns true if the nonce was unused and is now recorded; false if it was seen before. */
  checkAndRemember(key: string, ttlSeconds: number): Promise<boolean>;
}

/** In-process store. Fine for a single server, tests and shadow mode. */
export class MemoryReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();

  async checkAndRemember(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    if (this.seen.size > 10_000) {
      for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
    }
    const exp = this.seen.get(key);
    if (exp && exp > now) return false;
    this.seen.set(key, now + Math.max(1, ttlSeconds) * 1000);
    return true;
  }
}

/** Minimal interface satisfied by node-redis v4+ and ioredis clients. */
export interface RedisLike {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

export interface RedisReplayStoreOptions {
  /** "node-redis" (default) passes { NX, EX }; "ioredis" passes "EX", ttl, "NX". */
  client?: "node-redis" | "ioredis";
  prefix?: string;
}

/** Shared store backed by Redis using SET key value NX EX ttl. */
export class RedisReplayStore implements ReplayStore {
  private readonly flavour: "node-redis" | "ioredis";
  private readonly prefix: string;

  constructor(private readonly redis: RedisLike, opts: RedisReplayStoreOptions = {}) {
    this.flavour = opts.client ?? "node-redis";
    this.prefix = opts.prefix ?? "ptb:nonce:";
  }

  async checkAndRemember(key: string, ttlSeconds: number): Promise<boolean> {
    const ttl = Math.max(1, Math.ceil(ttlSeconds));
    const res =
      this.flavour === "ioredis"
        ? await this.redis.set(this.prefix + key, "1", "EX", ttl, "NX")
        : await this.redis.set(this.prefix + key, "1", { NX: true, EX: ttl });
    return res === "OK";
  }
}
