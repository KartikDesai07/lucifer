// The outbox's one store per page (Printing Phase 5, spec 5.2; plan Task 10): every read-modify-write of the record
// runs under the Web Lock "pos-offline-outbox" (two tabs never overwrite each other), a record that cannot be read is
// moved to a dated key once and reported, never overwritten, and a write the storage refused says so.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OUTBOX_KEY, emptyOutbox, takeOfflineRef } from "./offline-outbox";
import { OUTBOX_LOCK, createOutboxStore } from "./offline-outbox-store";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let refuse = false;
  return {
    data,
    refuseWrites(on: boolean) {
      refuse = on;
    },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refuse) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function fakeLocks() {
  const names: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  return {
    names,
    request: <T>(name: string, work: () => T): Promise<Awaited<T>> => {
      names.push(name);
      const run = chain.then(() => work());
      chain = run.catch(() => undefined);
      return run as Promise<Awaited<T>>;
    },
  };
}

const DAY = "2026-11-04";

function storeOver(storage: ReturnType<typeof fakeStorage>, locks: ReturnType<typeof fakeLocks> | null = fakeLocks()) {
  return createOutboxStore({ storage: () => storage, locks: () => locks, today: () => DAY, now: () => 1_700_000_000_000 });
}

test("an update runs under the outbox lock, writes the record and publishes it", async () => {
  const storage = fakeStorage();
  const locks = fakeLocks();
  const store = storeOver(storage, locks);
  let told = 0;
  store.subscribe(() => {
    told += 1;
  });
  const result = await store.update((record) => takeOfflineRef(record).record);
  assert.equal(result, "written", "the record was written");
  assert.deepEqual(locks.names, [OUTBOX_LOCK], "under the one lock");
  assert.equal(OUTBOX_LOCK, "pos-offline-outbox", "the lock's name");
  assert.equal(JSON.parse(storage.data.get(OUTBOX_KEY) ?? "{}").next, 2, "the stored record took a number");
  assert.equal(store.getSnapshot().record?.next, 2, "the page sees the new record");
  assert.ok(told >= 1, "listeners heard it");
});

test("an unreadable record is moved to a dated key once, reported, and a fresh record starts", async () => {
  const storage = fakeStorage({ [OUTBOX_KEY]: "{not json" });
  const store = storeOver(storage);
  const result = await store.update((record) => takeOfflineRef(record).record);
  assert.equal(result, "written", "a fresh record was written after the bad one was kept aside");
  assert.equal(storage.data.get(`${OUTBOX_KEY}.bad-1700000000000`), "{not json", "the bad record is kept as it was");
  assert.equal(store.getSnapshot().unreadable, true, "the page is told");
  assert.equal(store.claimUnreadableReport(), true, "the report is said once");
  assert.equal(store.claimUnreadableReport(), false, "and only once");
});

test("a bad record that cannot be moved is never overwritten", async () => {
  const storage = fakeStorage({ [OUTBOX_KEY]: "{not json" });
  storage.refuseWrites(true);
  const store = storeOver(storage);
  const result = await store.update((record) => takeOfflineRef(record).record);
  assert.equal(result, "failed", "nothing could be kept");
  assert.equal(storage.data.get(OUTBOX_KEY), "{not json", "the bad record is still there");
});

test("a write the storage refused says failed and the page keeps the record it had", async () => {
  const storage = fakeStorage();
  const store = storeOver(storage);
  assert.equal(await store.update((record) => takeOfflineRef(record).record), "written", "the first write");
  storage.refuseWrites(true);
  assert.equal(await store.update((record) => takeOfflineRef(record).record), "failed", "the storage is full");
  assert.equal(store.getSnapshot().record?.next, 2, "the page still shows the stored record");
});

test("an update that changes nothing writes nothing; one that throws writes nothing and never throws", async () => {
  const storage = fakeStorage();
  const store = storeOver(storage);
  assert.equal(await store.update(() => null), "unchanged", "nothing to write");
  assert.equal(storage.data.has(OUTBOX_KEY), false, "no write");
  const thrown = await store.update(() => {
    throw new RangeError("offline number out of range");
  });
  assert.equal(thrown, "failed", "a throw inside the change is a failed update, never a crash");
  assert.equal(storage.data.has(OUTBOX_KEY), false, "still no write");
});

test("without Web Locks the updates of this page still run one at a time", async () => {
  const storage = fakeStorage();
  const store = storeOver(storage, null);
  const results = await Promise.all([
    store.update((record) => takeOfflineRef(record).record),
    store.update((record) => takeOfflineRef(record).record),
  ]);
  assert.deepEqual(results, ["written", "written"], "both written");
  assert.equal(JSON.parse(storage.data.get(OUTBOX_KEY) ?? "{}").next, 3, "neither overwrote the other");
});

test("refresh reads what another tab wrote", async () => {
  const storage = fakeStorage();
  const store = storeOver(storage);
  await store.refresh();
  assert.equal(store.getSnapshot().record?.next, 1, "an empty outbox reads as a fresh record");
  storage.data.set(OUTBOX_KEY, JSON.stringify({ ...emptyOutbox(DAY), next: 7 }));
  await store.refresh();
  assert.equal(store.getSnapshot().record?.next, 7, "the other tab's record");
});

test("no storage at all: nothing is kept and the update says so", async () => {
  const store = createOutboxStore({ storage: () => null, locks: () => null, today: () => DAY, now: () => 1 });
  assert.equal(await store.update((record) => record), "failed", "no storage, nothing kept");
  assert.equal(store.getSnapshot().record, null, "no record");
});
