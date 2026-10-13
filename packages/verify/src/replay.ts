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

export interface UpstashReplayStoreOptions {
  /** UPSTASH_REDIS_REST_URL */
  url: string;
  /** UPSTASH_REDIS_REST_TOKEN */
  token: string;
  prefix?: string;
  fetch?: typeof fetch;
}

/** Shared store for serverless deployments, using Upstash's Redis REST API (no TCP connection needed). */
export class UpstashReplayStore implements ReplayStore {
  private readonly prefix: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: UpstashReplayStoreOptions) {
    this.prefix = opts.prefix ?? "ptb:nonce:";
    this.doFetch = opts.fetch ?? fetch;
  }

  async checkAndRemember(key: string, ttlSeconds: number): Promise<boolean> {
    const ttl = Math.max(1, Math.ceil(ttlSeconds));
    const res = await this.doFetch(this.opts.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.token}`, "content-type": "application/json" },
      body: JSON.stringify(["SET", this.prefix + key, "1", "NX", "EX", String(ttl)]),
    });
    if (!res.ok) throw new Error(`Upstash replay store returned HTTP ${res.status}`);
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) throw new Error(`Upstash replay store: ${data.error}`);
    return data.result === "OK";
  }
}
