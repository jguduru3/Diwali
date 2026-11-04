// Short in-process cache for the public catalogue reads (shop list, areas, price lists).
// At peak every customer opens the same few lists; without this each request is a database
// round trip. Entries live a few seconds, so a change shows within one TTL on every instance,
// and nothing that decides money or order state reads from here: placing an order re-checks
// the shop's listing, prices and stock against the database (G6, G11).

type Entry<T> = { value: T; expires: number };

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cached value, or `load()` once for all concurrent callers of the same key. */
  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .then((value) => {
        if (this.entries.size >= this.maxEntries) this.evictExpired();
        if (this.entries.size >= this.maxEntries) {
          // still full: drop the oldest entry (Map keeps insertion order)
          const oldest = this.entries.keys().next().value;
          if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { value, expires: this.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  private evictExpired() {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.expires <= t) this.entries.delete(k);
  }
}

/** Seconds a public list may be served from the cache; 0 turns caching off (tests). */
export function catalogueTtlMs(): number {
  const raw = process.env.CATALOGUE_CACHE_SECONDS;
  const s = raw === undefined || raw === '' ? 10 : Number(raw);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}
