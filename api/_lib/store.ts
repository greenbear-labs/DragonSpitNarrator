// Daily usage counters. Upstash Redis (added from the Vercel Marketplace) when configured, otherwise an
// in-memory map, which only lasts as long as one function instance and so is best-effort.

export interface CounterStore {
  /** Current values of the given counters (0 when missing). */
  get(keys: string[]): Promise<number[]>;
  /** Adds amount to each counter and makes it expire after ttlSeconds. */
  add(keys: string[], amount: number, ttlSeconds: number): Promise<void>;
  readonly persistent: boolean;
}

export class MemoryStore implements CounterStore {
  readonly persistent = false;
  private counters = new Map<string, { value: number; expires: number }>();

  constructor(private now: () => number = Date.now) {}

  async get(keys: string[]) {
    return keys.map((key) => {
      const entry = this.counters.get(key);
      return entry && entry.expires > this.now() ? entry.value : 0;
    });
  }

  async add(keys: string[], amount: number, ttlSeconds: number) {
    const current = await this.get(keys);
    keys.forEach((key, i) => {
      this.counters.set(key, { value: current[i] + amount, expires: this.now() + ttlSeconds * 1000 });
    });
  }
}

export class RedisStore implements CounterStore {
  readonly persistent = true;

  constructor(
    private url: string,
    private token: string,
  ) {
    this.url = url.replace(/\/+$/, "");
  }

  private async pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Redis returned ${response.status}`);
    const results = (await response.json()) as { result?: unknown; error?: string }[];
    return results.map((r) => {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      return r.result;
    });
  }

  async get(keys: string[]) {
    const results = await this.pipeline(keys.map((key) => ["GET", key]));
    return results.map((r) => Number(r) || 0);
  }

  async add(keys: string[], amount: number, ttlSeconds: number) {
    await this.pipeline(keys.flatMap((key) => [["INCRBY", key, amount], ["EXPIRE", key, ttlSeconds]]));
  }
}

export function storeFromEnv(env: Record<string, string | undefined>): CounterStore {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisStore(url, token) : new MemoryStore();
}
