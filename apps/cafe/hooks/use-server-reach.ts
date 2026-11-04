"use client";

// The page's offline state (Printing Phase 5, spec 5.1; plan Task 10): one store per tab (lib/server-reach.ts),
// read here. Fed by the browser's own flag (TanStack's onlineManager, subscribed per mount: a repeat is a no-op),
// every pulse result (hooks/use-pos-pulse.ts) and the send path (hooks/use-offline-send.ts).

import { useEffect, useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

import type { OfflineEvent } from "@/lib/offline-state";
import { feedBrowserOnline, serverReach } from "@/lib/server-reach";

export function useServerReach(): { offline: boolean; report: (event: OfflineEvent) => void } {
  const offline = useSyncExternalStore(serverReach.subscribe, serverReach.isOffline, () => false);
  useEffect(() => feedBrowserOnline(onlineManager), []);
  return { offline, report: serverReach.report };
}
