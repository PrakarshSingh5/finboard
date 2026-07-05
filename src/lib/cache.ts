interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /**
   * Retrieves a cached value if present and not expired.
   * Automatically deletes and returns undefined if the entry has expired —
   * "lazy expiration" (checked on read) instead of a background timer,
   * which is simpler and avoids leaking intervals in a serverless/dev
   * environment where the process may be short-lived.
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Stores a value with a TTL in milliseconds.
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Useful for debugging / a future admin endpoint showing cache stats. */
  size(): number {
    return this.store.size;
  }
}

// A module-level singleton. In Next.js dev mode with hot-reload this can
// get reset on file changes — expected and fine for a cache (worst case,
// a cache miss and a fresh fetch, never incorrect data).
export const cache = new TTLCache();

export const CACHE_TTL = {
  FINANCIAL_DATA: 24 * 60 * 60 * 1000, // 24 hours — quarterly financials don't change intraday
  FULL_REPORT: 30 * 60 * 1000, // 30 minutes — short enough that a demo still feels "live" on repeat, long enough to save real calls
};