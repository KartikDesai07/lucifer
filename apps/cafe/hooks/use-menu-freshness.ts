"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { focusManager, onlineManager, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { BOOTSTRAP_QUERY_KEY } from "@/components/layout/MasterDataProvider";
import { CATEGORY_KEYS } from "@/hooks/use-categories";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { getLastMenuRefreshAt, menuRefreshDue } from "@/lib/menu-freshness";
import { refreshMenuNow } from "@/lib/menu-refresh";

// Menu B2 — keeps New Order's menu current WITHOUT polling: one refresh when
// the screen opens and one each time the window is shown or focused again
// (lib/menu-freshness.ts decides whether that refresh is due). The refresh
// itself is lib/menu-refresh.ts.
//
// This hook must never create a query observer. An observer mounted on a
// products query that errored with no data would fetch again on mount, flip
// the page back to its skeleton, unmount the grid, and loop. So the failure
// flag is read straight from the query cache: query-core replaces
// `query.state` with a new object on every dispatch (query.ts #dispatch), and
// the flag is a plain boolean, so useSyncExternalStore sees a stable snapshot.

const MENU_KEYS = [PRODUCT_KEYS.all, CATEGORY_KEYS.all] as const;

// A refresh failed while the list on screen is still good: status "error" with
// data kept. (No data at all is the page's own error state.) Not while a fetch
// is running: query-core keeps status "error" through a refetch when data
// exists (query.ts fetchState), and Try again must not read as a dead button.
export function refreshFailedOf(qc: QueryClient): boolean {
  return MENU_KEYS.some((key) => {
    const state = qc.getQueryState(key);
    return state?.status === "error" && state.data !== undefined && state.fetchStatus !== "fetching";
  });
}

const NOT_FAILED_ON_SERVER = () => false;
const IGNORE = () => undefined;

/** Refreshes when menuRefreshDue says so. A failure shows in the query state
 * (the grid's "Couldn't refresh"), so it is swallowed here. `manual` = Try again. */
export function refreshMenuIfDue(qc: QueryClient, manual = false): void {
  const bootstrap = qc.getQueryState(BOOTSTRAP_QUERY_KEY);
  const due = menuRefreshDue(
    {
      now: Date.now(),
      lastRefreshAt: getLastMenuRefreshAt(),
      bootstrapFetching: qc.isFetching({ queryKey: BOOTSTRAP_QUERY_KEY, exact: true }) > 0,
      bootstrapFetchedAt: bootstrap?.dataUpdatedAt ? bootstrap.dataUpdatedAt : null,
      menuFetching:
        qc.isFetching({ queryKey: PRODUCT_KEYS.all, exact: true }) +
          qc.isFetching({ queryKey: CATEGORY_KEYS.all, exact: true }) >
        0,
      online: onlineManager.isOnline(),
    },
    manual,
  );
  if (due) void refreshMenuNow(qc).catch(IGNORE);
}

export function useMenuFreshness(): { refreshFailed: boolean; retry: () => void } {
  const qc = useQueryClient();

  const refreshFailed = useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    () => refreshFailedOf(qc),
    NOT_FAILED_ON_SERVER,
  );

  useEffect(() => {
    const refresh = () => refreshMenuIfDue(qc);
    refresh();
    // TanStack's focusManager fires on hide as well as show — only a show counts.
    const unsubscribe = focusManager.subscribe((focused) => {
      if (!focused) return;
      refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [qc]);

  // Try again: always refreshes, replacing any read in flight (menuRefreshDue).
  const retry = useCallback(() => refreshMenuIfDue(qc, true), [qc]);

  return { refreshFailed, retry };
}
