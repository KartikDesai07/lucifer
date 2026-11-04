// The outbox's one store per page (Printing Phase 5, spec 5.2; plan Task 10). Every read-modify-write of the record
// runs under the Web Lock "pos-offline-outbox", so two tabs of this device never overwrite each other; a record that
// cannot be read is moved to a dated key once (never overwritten) and the page says so; a write the storage refused
// says "failed", and the caller then tells staff nothing was kept. Without Web Locks (an http page that is not a
// secure context) the updates of this page still run one at a time. The record operations are lib/offline-outbox.ts.

import { cafeDateString } from "@/lib/utils";

import { OUTBOX_KEY, emptyOutbox, outboxBadKey, readOutbox, writeOutbox } from "./offline-outbox";
import type { OutboxRecord } from "./offline-outbox-schema";

export const OUTBOX_LOCK = "pos-offline-outbox";
export const OUTBOX_UNREADABLE_MESSAGE = "Some offline orders could not be read: check Open tabs";

export interface OutboxSnapshot {
  /** null until the first read (and on the server pass), or with no storage at all. */
  record: OutboxRecord | null;
  /** A record that could not be read was kept aside this page. */
  unreadable: boolean;
}

export type OutboxUpdate = "written" | "unchanged" | "failed";

type OutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** navigator.locks, as this store uses it. */
interface OutboxLocks {
  request(name: string, work: () => unknown): Promise<unknown>;
}

interface OutboxStoreDeps {
  storage: () => OutboxStorage | null;
  locks: () => OutboxLocks | null;
  today: () => string;
  now: () => number;
}

export interface OutboxStore {
  getSnapshot(): OutboxSnapshot;
  subscribe(listener: () => void): () => void;
  /** Re-reads the record (another tab wrote it). */
  refresh(): Promise<void>;
  /** `change` returns the next record, or null for no change. A change that throws is a failed update. */
  update(change: (record: OutboxRecord) => OutboxRecord | null): Promise<OutboxUpdate>;
  /** True once per page while a record was kept aside: the page says so once. */
  claimUnreadableReport(): boolean;
}

export function createOutboxStore(deps: OutboxStoreDeps): OutboxStore {
  let snapshot: OutboxSnapshot = { record: null, unreadable: false };
  let reported = false;
  const listeners = new Set<() => void>();
  // This page's own queue when the browser has no Web Locks.
  let chain: Promise<unknown> = Promise.resolve();

  const publish = (record: OutboxRecord | null, unreadable = snapshot.unreadable) => {
    if (record === snapshot.record && unreadable === snapshot.unreadable) return;
    snapshot = { record, unreadable };
    for (const listener of [...listeners]) listener();
  };

  const withLock = <T>(work: () => T): Promise<T> => {
    const locks = deps.locks();
    if (locks !== null) return locks.request(OUTBOX_LOCK, () => work()) as Promise<T>;
    const run = chain.then(() => work());
    chain = run.catch(() => undefined);
    return run;
  };

  // Inside the lock only. null: no storage, or a bad record that could not be kept aside (never overwritten).
  const load = (): OutboxRecord | null => {
    const storage = deps.storage();
    if (storage === null) return null;
    try {
      const read = readOutbox(storage, deps.today());
      if (read.ok) return read.record;
      storage.setItem(outboxBadKey(deps.now()), read.raw);
      storage.removeItem(OUTBOX_KEY);
      publish(snapshot.record, true);
      return emptyOutbox(deps.today());
    } catch {
      return null;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh: () =>
      withLock(() => {
        publish(load());
      }),
    update: (change) =>
      withLock((): OutboxUpdate => {
        const record = load();
        if (record === null) return "failed";
        let next: OutboxRecord | null;
        try {
          next = change(record);
        } catch {
          publish(record);
          return "failed";
        }
        if (next === null) {
          publish(record);
          return "unchanged";
        }
        const storage = deps.storage();
        if (storage === null || !writeOutbox(storage, next)) {
          publish(record);
          return "failed";
        }
        publish(next);
        return "written";
      }),
    claimUnreadableReport() {
      if (!snapshot.unreadable || reported) return false;
      reported = true;
      return true;
    },
  };
}

function browserStorage(): OutboxStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage blocked by the browser: nothing can be kept, and every offline send says so.
    return null;
  }
}

function browserLocks(): OutboxLocks | null {
  return typeof navigator !== "undefined" && navigator.locks !== undefined ? navigator.locks : null;
}

/** This tab's outbox. */
export const offlineOutbox = createOutboxStore({ storage: browserStorage, locks: browserLocks, today: () => cafeDateString(), now: () => Date.now() });
