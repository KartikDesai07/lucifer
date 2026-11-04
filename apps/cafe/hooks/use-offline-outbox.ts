"use client";

// The outbox on the page (Printing Phase 5, spec 5.2; plan Task 10): this tab's one store
// (lib/offline-outbox-store.ts), read at mount and again whenever another tab writes the record (the storage event
// fires in every OTHER tab of this origin). A record that could not be read was kept aside: said once.

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { OUTBOX_KEY } from "@/lib/offline-outbox";
import { OUTBOX_UNREADABLE_MESSAGE, offlineOutbox, type OutboxSnapshot, type OutboxStore } from "@/lib/offline-outbox-store";
import type { OutboxRecord } from "@/lib/offline-outbox-schema";

const SERVER_SNAPSHOT: OutboxSnapshot = { record: null, unreadable: false };

export function useOfflineOutbox(): { record: OutboxRecord | null; unreadable: boolean; update: OutboxStore["update"] } {
  const snapshot = useSyncExternalStore(offlineOutbox.subscribe, offlineOutbox.getSnapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    void offlineOutbox.refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === OUTBOX_KEY || event.key === null) void offlineOutbox.refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (snapshot.unreadable && offlineOutbox.claimUnreadableReport()) toast.warning(OUTBOX_UNREADABLE_MESSAGE);
  }, [snapshot.unreadable]);
  return { record: snapshot.record, unreadable: snapshot.unreadable, update: offlineOutbox.update };
}
