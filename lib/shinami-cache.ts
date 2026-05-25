// Process-local LRU+TTL cache for Shinami wallet lookups.
//
// `shinami_zkw_getOrCreateZkLoginWallet` is deterministic given
// (jwt, subWallet) — same input, same (salt, address) every time
// for the lifetime of the JWT. Caching avoids hitting Shinami's
// monthly wallet-creation cap and rate limits on benign repeats
// (page refresh, mount/unmount cycles).
//
// In-memory is sufficient for a single Next.js dev/serverless
// instance. For multi-instance deploys swap to Redis with the
// same `get`/`set` surface — every cache hit here turns into
// roughly one fewer Shinami call.

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private store = new Map<string, Entry<V>>();
  constructor(
    private readonly maxEntries: number,
    private readonly defaultTtlMs: number,
  ) {}

  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, e);
    return e.value;
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs): void {
    if (this.store.size >= this.maxEntries) {
      // Evict the oldest (Map iteration order is insertion order).
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
