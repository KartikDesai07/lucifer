// In-process, per-isolate LRU cache with lazy TTL expiry and a HARD SIZE CAP.
//
// Deliberately a tiny Map-based implementation rather than `node-cache` or
// `lru-cache`: the former is a Node-oriented library (EventEmitter, deep-clone,
// background timers) that is unreliable on the Cloudflare Workers runtime, and
// this needs no dependency at all — a JS `Map` already preserves insertion
// order, which is the whole mechanism an LRU needs.
//
// WHY A CAP AT ALL (this is not theoretical). Several call sites cache under an
// UNBOUNDED key space, so a plain Map would grow for the life of the isolate:
//   • `order-summary-<cafe date>`  — a new key every day, forever
//   • `auth:revalidated:<staffId>` — a key per staff account that ever signs in
//   • branding `<slot>:<version>`  — a new key on every logo/hero re-upload
// Lazy expiry alone never reclaims those: an entry is only dropped when someone
// READS that exact key again, and nobody ever re-reads yesterday's summary key.
// The LRU eviction below is what bounds the isolate's memory regardless of key
// cardinality. There is no Redis in this stack (and none is wanted — the free
// tier is the architecture), so this cache is the only cache layer there is.
//
// IMPORTANT: this cache is IN-PROCESS (per serverless isolate). cache.del() on a
// write only clears the writer's instance, so on a multi-instance host other
// staff would keep serving the stale list until their copy expires. We therefore
// treat it only as a short BURST BUFFER and keep TTLs to seconds so every isolate
// self-heals fast (TanStack Query smooths the client side). It is NOT a source of
// truth and NOT a cross-instance invalidation mechanism.

export const TTL = {
  PRODUCTS: 20,
  CATEGORIES: 20,
  STAFF: 30,
  CUSTOMERS: 20,
  TABLES: 5, // floor view — effectively live
  RESERVATIONS: 20,
  EVENTS: 20,
  ORDERS: 0, // never cache — POS accuracy is critical
  SUMMARY: 30, // dashboard daily summary (aggregate, not live POS data)
  SETTINGS: 45, // restaurant/receipt settings — changes rarely (admin only)
} as const;

const DEFAULT_TTL_SECONDS = 30;

// The hard ceiling on live entries per isolate. Sized well above this app's
// real working set (a few dozen list/settings/branding keys plus one summary
// key per recently-viewed day and one marker per active staff member) so
// eviction is a SAFETY NET for unbounded key spaces, never part of the hot
// path. Every entry is a already-lean projection, so even a full cache is a
// small, predictable footprint — which is what a 512MB free tier requires.
export const CACHE_MAX_ENTRIES = 500;

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms
}

// A JS Map iterates in INSERTION order, which is what makes it usable as an LRU
// with no extra bookkeeping: `store.keys().next().value` is always the
// least-recently-used key, provided every READ re-inserts its key at the back
// (see touch() in get()).
const store = new Map<string, Entry>();

// Evicts the least-recently-used entries until the store is within its cap.
// A `while` (not an `if`): the cap can be crossed by more than one if this is
// ever called after a batch, and an off-by-one here would silently re-open the
// unbounded growth this exists to prevent.
function evictIfNeeded(): void {
  while (store.size > CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
  }
}

function get<T = unknown>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key); // lazy expiry on read
    return undefined;
  }
  // Mark as recently used: delete + re-set moves this key to the BACK of the
  // Map's insertion order, so it is the last thing evictIfNeeded would drop.
  // Without this the cache would be FIFO, not LRU, and a hot key written early
  // could be evicted while cold keys written later survived.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

// ttlSeconds <= 0 means "do not cache" (mirrors TTL.ORDERS = 0).
function set(key: string, value: unknown, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
  if (ttlSeconds <= 0) {
    store.delete(key);
    return;
  }
  // Delete first so a re-set of an EXISTING key also moves it to the back
  // (Map.set on a present key keeps its original position).
  store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  evictIfNeeded();
}

function del(key: string): void {
  store.delete(key);
}

// Test/diagnostic surface only — never used on a request path. `size` counts
// entries INCLUDING ones that are expired-but-not-yet-read (lazy expiry), which
// is exactly what a cap has to bound.
function size(): number {
  return store.size;
}

function clear(): void {
  store.clear();
}

const cache = { get, set, del, size, clear };

export default cache;
