"use client";

// The POS's open tabs and table choice with the orders made offline (Printing Phase 5, spec 5.5; plan Task 14): read
// from this tab's outbox (no request), merged where the lists are shown, so the page's own reads stay as they are.

import { useMemo } from "react";

import { useOfflineOutbox } from "@/hooks/use-offline-outbox";
import { withOfflineTables, withOfflineTabs } from "@/lib/offline-orders-view";
import type { Order, Table } from "@/types";

export function useOfflineTabs(tabs: Order[] | undefined): Order[] | undefined {
  const { record } = useOfflineOutbox();
  return useMemo(() => withOfflineTabs(tabs, record), [tabs, record]);
}

export function useOfflineTables(tables: Table[] | undefined): Table[] | undefined {
  const { record } = useOfflineOutbox();
  return useMemo(() => withOfflineTables(tables, record), [tables, record]);
}
