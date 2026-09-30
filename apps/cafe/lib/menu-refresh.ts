import type { QueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { CATEGORY_KEYS } from "@/hooks/use-categories";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { setLastMenuRefreshAt } from "@/lib/menu-freshness";
import type { Category, Product } from "@/types";

// Menu B2 — the ONE way New Order re-reads the menu on demand: the mount and
// focus refresh, Try again, and the order hooks after a 409 all come through
// refreshMenuNow.
//
// Deliberately imports nothing from the master provider or masters-seed:
// hooks/use-orders.ts imports this file, and masters-seed -> use-tables ->
// use-orders would close an import cycle whose TABLE_KEYS read crashes at
// module evaluation. The "is a refresh due?" check (which needs the provider's
// bootstrap query key) lives in hooks/use-menu-freshness.ts.
//
// Both reads carry ?fresh=1: the plain lists are served from the server's
// per-instance cache (20 s, packages/shared/src/cache.ts), so a plain refetch
// can land on an instance that has not seen the admin's edit yet and look
// "fresh" while being stale. cancelQueries first, so a cached refetch already
// in flight cannot land after (and repaint over) this one.
//
// The result is committed with fetchQuery, never setQueryData: the master
// provider writes the device's stored copy back only for a REAL fetch success
// (components/layout/MasterDataProvider.tsx skips manual writes), and
// staleTime 0 makes fetchQuery run the read instead of serving the cache.
const PRODUCTS_FRESH_PATH = "/api/products?fresh=1";
const CATEGORIES_FRESH_PATH = "/api/categories?fresh=1";

async function refreshList<T>(
  qc: QueryClient,
  queryKey: readonly string[],
  path: string,
): Promise<T> {
  await qc.cancelQueries({ queryKey, exact: true });
  // staleTime 0 alone is NOT enough: fetchQuery serves the cache when
  // dataUpdatedAt + staleTime is still in the future, and a list seeded from
  // the stored copy / bootstrap carries the SERVER's `at` as its dataUpdatedAt
  // (lib/masters-seed.ts) - on a device whose clock runs behind, that read
  // would silently do nothing (query-core utils.ts timeUntilStale). Marking the
  // query invalidated (refetchType "none": no fetch of its own) makes it stale
  // whatever the clocks say.
  await qc.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  return qc.fetchQuery({ queryKey, queryFn: () => apiGet<T>(path), staleTime: 0 });
}

/** Re-reads products and categories uncached. Rejects if either read fails. */
export async function refreshMenuNow(qc: QueryClient): Promise<void> {
  // Stamped at the START, on this device's clock: the gap rule then also holds
  // while the reads are still running and when they fail.
  setLastMenuRefreshAt(Date.now());
  await Promise.all([
    refreshList<Product[]>(qc, PRODUCT_KEYS.all, PRODUCTS_FRESH_PATH),
    refreshList<Category[]>(qc, CATEGORY_KEYS.all, CATEGORIES_FRESH_PATH),
  ]);
}
