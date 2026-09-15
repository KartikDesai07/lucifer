// Single source of truth for TanStack Query client-side cache timings.
//
// Each entry is the client `staleTime` for a resource (in ms). These broadly
// mirror the backend node-cache TTLs (lib/cache.ts) but serve a different role:
// the backend TTL is a per-isolate burst buffer (seconds), while these control
// how long the browser treats already-fetched data as fresh before a background
// refetch. Hooks import from here so the values live in ONE place instead of
// being scattered as magic numbers across hooks/*.
//
// `LIVE` (0) means never treat as fresh — always refetch (POS order accuracy,
// CLAUDE.md §9). Resources that poll (orders summary, tables) pair a stale time
// with a refetch interval below.

export const STALE_TIMES = {
  PRODUCTS: 5 * 60 * 1000, // 5min — menu changes rarely during service
  CATEGORIES: 5 * 60 * 1000, // 5min — near-static
  STAFF: 5 * 60 * 1000, // 5min — admin-only changes
  CUSTOMERS: 2 * 60 * 1000, // 2min — updated on order creation
  CUSTOMER_SEARCH: 30 * 1000, // 30s — search results
  RESERVATIONS: 60 * 1000, // 1min — same-day changes possible
  EVENTS: 60 * 1000, // 1min — payment updates during bookings
  TABLES: 30 * 1000, // 30s — live floor status
  SETTINGS: 10 * 60 * 1000, // 10min — admin-only, near-static
  SUMMARY: 2 * 60 * 1000, // 2min — dashboard daily summary
  REPORTS: 60 * 1000, // 1min — reviewed, not live; same range often re-opened
  LIVE: 0, // never cache — orders / customer order history
  // Master data (settings/categories/products/staff) — CB-DL-1, owner rule:
  // masters are fetched ONCE per page load by GET /api/bootstrap and read from
  // the tab's own copy afterwards; only a page refresh re-fetches them, so no
  // background query may be spent on them. 24h = the blob's max age
  // (MASTERS_BLOB_MAX_AGE_MS), so the tab's copy and the in-memory copy expire
  // on the same clock.
  MASTERS: 24 * 60 * 60 * 1000,
} as const;

// Garbage-collection windows (how long unused query data is kept in memory).
export const GC_TIMES = {
  DEFAULT: 10 * 60 * 1000, // 10min — matches the global QueryClient default
  ORDERS: 5 * 60 * 1000, // 5min — orders churn faster
  SETTINGS: 30 * 60 * 1000, // 30min — rarely refetched
  // Master data (CB-DL-1): the same 24h figure as STALE_TIMES.MASTERS and the
  // blob's MASTERS_BLOB_MAX_AGE_MS. A shorter window would evict the bootstrap's
  // seeded parts while a staff tab is parked on one screen, and the next screen
  // would then have to re-fetch each master route — exactly the extra queries
  // the "fetch once per page load" rule removes.
  MASTERS: 24 * 60 * 60 * 1000,
} as const;

// Auto-refetch cadences for the few live-polling queries (CLAUDE.md §9).
export const REFETCH_INTERVALS = {
  // Live dashboard beat — matches the floor/recent-orders 30s poll and the 30s
  // server TTL.SUMMARY, so the KPI cards (collected / in-progress / dues / hourly)
  // don't lag the live widgets beside them. Kept separate from STALE_TIMES.SUMMARY,
  // which stays the 2min focus/mount freshness window.
  SUMMARY: 30 * 1000,
  TABLES: STALE_TIMES.TABLES, // floor occupancy poll
  POS_PULSE: 20 * 1000, // CR2.3 staff-attention pulse (open requests + self-orders)
} as const;
