// In-process, per-isolate cache with lazy TTL expiry.
//
// Deliberately a tiny Map-based implementation rather than `node-cache`: the
// latter is a Node-oriented library (EventEmitter, deep-clone, background
// timers) that is unreliable on the Cloudflare Workers runtime, whereas a plain
// Map + timestamp is bulletproof on both Node and Workers.
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

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms
}

const store = new Map<string, Entry>();

function get<T = unknown>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key); // lazy expiry on read
    return undefined;
  }
  return entry.value as T;
}

// ttlSeconds <= 0 means "do not cache" (mirrors TTL.ORDERS = 0).
function set(key: string, value: unknown, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
  if (ttlSeconds <= 0) {
    store.delete(key);
    return;
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function del(key: string): void {
  store.delete(key);
}

const cache = { get, set, del };

export default cache;
