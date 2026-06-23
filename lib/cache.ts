import NodeCache from "node-cache";

// checkperiod: 0 disables node-cache's background sweep timer — pointless on
// short-lived Cloudflare Worker isolates (a module-scope setInterval running
// outside any request context) and unnecessary because get() still expires
// keys lazily against stdTTL on read. Avoids global async I/O on the isolate.
const cache = new NodeCache({ stdTTL: 30, checkperiod: 0 });

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

export default cache;
