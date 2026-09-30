import cache from "@/lib/cache";
import { requireAuth, requireAdmin } from "@/lib/api-helpers";

// Small shared helpers for lib/crud-route.ts, split out to keep that file
// under the 300-line cap (Menu redesign, 2026-09-30). No route-shape types
// here — just the guard dispatch and the multi-key cache clear both
// createCollectionRoute and createItemRoute call.

export type Guard = "auth" | "admin";

export function runGuard(guard: Guard | undefined) {
  return guard === "admin" ? requireAdmin() : requireAuth();
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Menu redesign (R7): clears the entity's own cache key plus any extra keys
// a write must also invalidate (e.g. the public QR menu's payload cache).
export function clearCaches(cacheKey: string, extra?: readonly string[]): void {
  cache.del(cacheKey);
  for (const key of extra ?? []) cache.del(key);
}
