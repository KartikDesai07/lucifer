// CB-DL-1 S5.2 — lib/masters-blob.ts, the per-tab copy of the five master
// lists, exercised as the REAL module over a fake storage object.
//
// The module takes an injectable `storage` (Pick<Storage, getItem|setItem|
// removeItem>) and an injectable `now`, so this suite drives the SHIPPED
// read/normalize/write/upsert/clear at exact age boundaries with only the
// three Storage methods faked (over a Map). A fake that re-implemented the
// normalizer would prove nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BOOTSTRAP_VERSION,
  MASTERS_BLOB_KEY,
  MASTERS_BLOB_MAX_AGE_MS,
  MASTERS_PART_KEYS,
  MASTERS_PERSISTED_PART_KEYS,
  type MastersBlob,
  type MastersPartKey,
} from "@/lib/bootstrap-contract";
import {
  clearMastersBlob,
  isPersistedPart,
  normalizeMastersBlob,
  persistedBlob,
  readMastersBlob,
  upsertMastersPart,
  writeMastersBlob,
  type MastersStorage,
} from "@/lib/masters-blob";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MASTERS_BLOB_SRC = "apps/cafe/lib/masters-blob.ts";
const MASTER_DATA_PROVIDER_SRC = "apps/cafe/components/layout/MasterDataProvider.tsx";

// A fixed "now", anchored slightly BEHIND the real wall clock on purpose:
// upsertMastersPart re-reads through readMastersBlob(Date.now(), store) — the
// real clock, which the write path deliberately does not make injectable — so
// a fixture stamped in the machine's future would be refused as "future `at`"
// by the upsert's own re-read and the clobber pin would fail for the wrong
// reason. One minute back is inside every age window used here.
const CLOCK_MARGIN_MS = 60 * 1000;
const NOW = Date.now() - CLOCK_MARGIN_MS;
const AT_NOW = new Date(NOW).toISOString();

interface FakeStorage extends MastersStorage {
  map: Map<string, string>;
  setCalls: number;
  removeCalls: number;
}

function fakeStorage(opts: { throwOnSet?: boolean } = {}): FakeStorage {
  const map = new Map<string, string>();
  const store: FakeStorage = {
    map,
    setCalls: 0,
    removeCalls: 0,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.setCalls += 1;
      if (opts.throwOnSet) {
        // Mirrors a real QuotaExceededError / disabled-store throw.
        throw new Error("QuotaExceededError");
      }
      map.set(k, v);
    },
    removeItem: (k: string) => {
      store.removeCalls += 1;
      map.delete(k);
    },
  };
  return store;
}

function blobOf(parts: MastersBlob["parts"], at: string = AT_NOW): MastersBlob {
  return { v: BOOTSTRAP_VERSION, at, parts };
}

// ── round trip + freshness of the returned object ───────────────────────────

// Contract change (owner directive 2026-09-09/11, "use local store properly"):
// the device store now persists exactly the four MASTERS_PERSISTED_PART_KEYS
// and staff is never written to it — it stays in memory for the tab's life.
test("masters-blob: write -> read round-trips exactly the four persisted parts and DROPS staff", () => {
  const store = fakeStorage();
  const written = blobOf({
    settings: { restaurantName: "Cafe One" },
    categories: [{ _id: "c1", name: "Coffee" }],
    products: [{ _id: "p1", name: "Latte" }],
    tables: [{ _id: "t1", tableNo: "T1" }],
    staff: [{ _id: "s1", name: "Asha" }],
  });

  writeMastersBlob(written, store);
  assert.equal(store.map.size, 1, "writeMastersBlob must persist exactly one key");
  assert.ok(store.map.has(MASTERS_BLOB_KEY), `the stored key must be ${MASTERS_BLOB_KEY}`);

  const storedRaw = store.map.get(MASTERS_BLOB_KEY) as string;
  const storedParsed = JSON.parse(storedRaw) as { parts: Record<string, unknown> };
  assert.ok(
    !Object.hasOwn(storedParsed.parts, "staff"),
    "the stored JSON must carry no staff key at all — staff is admin-only and must never reach disk",
  );

  const read = readMastersBlob(NOW, store);
  assert.ok(read, "a blob written at `now` must read back");
  assert.equal(read.v, BOOTSTRAP_VERSION);
  assert.equal(read.at, AT_NOW, "the blob must carry back the SERVER's `at`, not the reader's clock");
  assert.deepEqual(
    Object.keys(read.parts).sort(),
    ["categories", "products", "settings", "tables"],
    "only the four persisted parts must survive the round trip",
  );
  assert.equal(read.parts.staff, undefined, "readMastersBlob must return no staff part even though the caller wrote one");
  assert.deepEqual(read.parts.products, [{ _id: "p1", name: "Latte" }]);
});

test("masters-blob: normalizeMastersBlob returns a FRESH object — never the parsed input, and never its parts container", () => {
  const parsed = { v: BOOTSTRAP_VERSION, at: AT_NOW, parts: { products: [1, 2] }, extra: "junk" };
  const normalized = normalizeMastersBlob(parsed, NOW);
  assert.ok(normalized, "a valid blob must normalize");
  assert.notEqual(
    normalized as unknown,
    parsed as unknown,
    "normalizeMastersBlob must return a fresh literal so no caller can hold a reference carrying extra keys",
  );
  assert.notEqual(
    normalized.parts as unknown,
    parsed.parts as unknown,
    "the parts container must be a fresh object too — otherwise the caller still holds the stored object's own map",
  );
  assert.ok(
    !Object.hasOwn(normalized as unknown as Record<string, unknown>, "extra"),
    "an unknown top-level key must not be copied onto the normalized blob",
  );
  // Part VALUES are handed through by reference on purpose (they go straight
  // into setQueryData); pinned so a future deep-clone is a deliberate change.
  assert.equal(normalized.parts.products as unknown, parsed.parts.products as unknown);
});

// ── rejection matrix ────────────────────────────────────────────────────────

test("masters-blob: a blob written by another payload version is discarded (v mismatch -> null)", () => {
  const store = fakeStorage();
  store.map.set(
    MASTERS_BLOB_KEY,
    JSON.stringify({ v: BOOTSTRAP_VERSION + 1, at: AT_NOW, parts: { products: [] } }),
  );
  assert.equal(
    readMastersBlob(NOW, store),
    null,
    "a blob whose v is not BOOTSTRAP_VERSION must read as null — the shape may have changed under it",
  );
  assert.equal(normalizeMastersBlob({ v: "1", at: AT_NOW, parts: {} }, NOW), null, "a string v must be rejected too (strict !==)");
});

test("masters-blob: the age gates are exact — at MASTERS_BLOB_MAX_AGE_MS the blob still reads, one ms past it does not, and a future `at` is refused", () => {
  const atExactly = new Date(NOW - MASTERS_BLOB_MAX_AGE_MS).toISOString();
  assert.ok(
    normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: atExactly, parts: {} }, NOW),
    "a blob exactly MASTERS_BLOB_MAX_AGE_MS old must still be accepted (the gate is `> max`, not `>=`)",
  );

  const store = fakeStorage();
  writeMastersBlob(blobOf({ products: [{ _id: "p1" }] }, atExactly), store);
  assert.equal(
    readMastersBlob(NOW + 1, store),
    null,
    "one ms past the max age the blob must be discarded, so a tab parked for a day re-fetches instead of painting stale masters",
  );

  const future = new Date(NOW + 60_000).toISOString();
  assert.equal(
    normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: future, parts: {} }, NOW),
    null,
    "an `at` in the future must be refused — a clock change must not make a blob immortal",
  );
});

test("masters-blob: an unusable `at` (non-string, unparseable) and corrupt JSON all degrade to null, not a throw", () => {
  assert.equal(normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: NOW, parts: {} }, NOW), null, "a numeric `at` must be refused");
  assert.equal(normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: null, parts: {} }, NOW), null, "a null `at` must be refused");
  assert.equal(
    normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: "not a date", parts: {} }, NOW),
    null,
    "an unparseable `at` must be refused",
  );
  assert.equal(normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: AT_NOW }, NOW), null, "a blob with no parts object must be refused");
  assert.equal(normalizeMastersBlob(null, NOW), null, "null must be refused");
  assert.equal(normalizeMastersBlob("[]", NOW), null, "a string must be refused");

  const store = fakeStorage();
  store.map.set(MASTERS_BLOB_KEY, "{not json");
  assert.equal(readMastersBlob(NOW, store), null, "corrupt JSON must read as null instead of throwing into a render");
});

test("masters-blob: unknown part keys are dropped and a prototype key in `parts` yields no such part (Object.hasOwn, not `in`)", () => {
  const normalized = normalizeMastersBlob(
    { v: BOOTSTRAP_VERSION, at: AT_NOW, parts: { products: [{ _id: "p1" }], orders: [{ _id: "o1" }], customers: [] } },
    NOW,
  );
  assert.ok(normalized, "the blob itself must still normalize");
  assert.deepEqual(Object.keys(normalized.parts), ["products"], "only keys in MASTERS_PART_KEYS may be copied");

  // A plain object inherits `constructor`/`toString`; an `in` test would let
  // them sail through and hand the seed a Function as a "part".
  const proto = normalizeMastersBlob(
    { v: BOOTSTRAP_VERSION, at: AT_NOW, parts: JSON.parse('{"constructor": 1, "toString": 2, "settings": {"a": 1}}') },
    NOW,
  );
  assert.ok(proto, "a parts object carrying prototype-shaped keys must still normalize");
  assert.deepEqual(
    Object.keys(proto.parts),
    ["settings"],
    "prototype-shaped keys must not become parts — only the five known keys, copied with Object.hasOwn",
  );

  // The five part keys are not prototype-shaped, so nothing may be inherited.
  const empty = normalizeMastersBlob({ v: BOOTSTRAP_VERSION, at: AT_NOW, parts: {} }, NOW);
  assert.ok(empty, "an empty parts object is a valid (if useless) blob");
  assert.deepEqual(Object.keys(empty.parts), [], "an empty parts object must yield no parts at all");
});

// ── upsert: the clobber regression ──────────────────────────────────────────

test("masters-blob: upsertMastersPart PRESERVES the other parts and re-stamps `at` (a whole-object writer would revert every sibling)", () => {
  const store = fakeStorage();
  writeMastersBlob(
    blobOf({ settings: { restaurantName: "Cafe One" }, categories: [{ _id: "c1" }], products: [{ _id: "p1" }] }),
    store,
  );

  const laterAt = new Date(NOW + 5_000).toISOString();
  upsertMastersPart("products", [{ _id: "p1" }, { _id: "p2" }], laterAt, store);

  const read = readMastersBlob(NOW + 5_000, store);
  assert.ok(read, "the upserted blob must read back");
  assert.equal(read.at, laterAt, "upsertMastersPart must re-stamp `at` with the value it was handed");
  assert.deepEqual(
    Object.keys(read.parts).sort(),
    ["categories", "products", "settings"],
    "the sibling parts must survive the single-part write — this is the clobber regression",
  );
  assert.deepEqual(read.parts.settings, { restaurantName: "Cafe One" }, "the untouched settings part must be byte-identical");
  assert.deepEqual(read.parts.products, [{ _id: "p1" }, { _id: "p2" }], "the upserted part must hold the new value");
});

test("masters-blob: upsertMastersPart with NO usable existing blob (none at all, or an aged-out one) writes a fresh blob carrying just that one part", () => {
  const empty = fakeStorage();
  upsertMastersPart("tables", [{ _id: "t1" }], AT_NOW, empty);
  const fresh = readMastersBlob(NOW, empty);
  assert.ok(fresh, "a fresh blob must be created when there was none");
  assert.deepEqual(Object.keys(fresh.parts), ["tables"], "only the upserted part may be present");
  assert.equal(fresh.v, BOOTSTRAP_VERSION, "the fresh blob must carry the current payload version");

  // An EXPIRED blob must not be merged into: upsertMastersPart re-reads
  // through readMastersBlob, so day-old masters must not ride back in under
  // a fresh `at`.
  const aged = fakeStorage();
  const old = new Date(Date.now() - MASTERS_BLOB_MAX_AGE_MS - 60_000).toISOString();
  writeMastersBlob(blobOf({ settings: { restaurantName: "Stale" }, products: [{ _id: "old" }] }, old), aged);
  upsertMastersPart("tables", [{ _id: "t1" }], new Date().toISOString(), aged);
  const rewritten = readMastersBlob(Date.now(), aged);
  assert.ok(rewritten, "the re-written blob must read back");
  assert.deepEqual(
    Object.keys(rewritten.parts),
    ["tables"],
    "an aged-out blob must contribute NO parts to the upsert — its stale siblings must not be resurrected under a fresh timestamp",
  );
});

// staff is never persisted: upsert is a no-op and leaves an existing blob
// unchanged (contract change — staff stays in memory for the tab's life only).
test("masters-blob: upsertMastersPart(\"staff\", ...) writes nothing and leaves an existing blob unchanged", () => {
  const store = fakeStorage();
  writeMastersBlob(
    blobOf({ settings: { restaurantName: "Cafe One" }, products: [{ _id: "p1" }] }),
    store,
  );
  const before = store.map.get(MASTERS_BLOB_KEY);
  const setCallsBefore = store.setCalls;

  upsertMastersPart("staff", [{ _id: "s1", name: "Asha" }], new Date(NOW + 5_000).toISOString(), store);

  assert.equal(store.setCalls, setCallsBefore, "upsertMastersPart(\"staff\", ...) must never call setItem — staff is not a persisted part");
  assert.equal(store.map.get(MASTERS_BLOB_KEY), before, "the existing blob must be byte-identical after a no-op staff upsert");

  const read = readMastersBlob(NOW + 5_000, store);
  assert.ok(read, "the unchanged blob must still read back");
  assert.deepEqual(Object.keys(read.parts).sort(), ["products", "settings"], "staff must not have been added");
});

// ── failure modes: throwing storage, no storage at all ──────────────────────

test("masters-blob: a throwing setItem (quota/disabled) does not throw out of write or upsert, and clear swallows its own failure", () => {
  const store = fakeStorage({ throwOnSet: true });
  assert.doesNotThrow(() => writeMastersBlob(blobOf({ products: [] }), store), "writeMastersBlob must swallow a quota throw");
  assert.doesNotThrow(
    () => upsertMastersPart("products", [{ _id: "p1" }], AT_NOW, store),
    "upsertMastersPart must swallow a quota throw too — it writes through writeMastersBlob",
  );
  assert.ok(store.setCalls >= 2, `both writes must have actually reached setItem, got ${store.setCalls}`);
  assert.equal(store.map.size, 0, "nothing may be persisted when setItem throws");
  assert.equal(readMastersBlob(NOW, store), null, "with nothing persisted the read must be null");

  const throwingClear: MastersStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => {
      throw new Error("storage disabled");
    },
  };
  assert.doesNotThrow(() => clearMastersBlob(throwingClear), "clearMastersBlob must swallow a removeItem throw");
});

test("masters-blob: writeMastersBlob with a throwing setItem REMOVES the previously stored key", () => {
  const store = fakeStorage();
  // Pre-seed an old (but still valid) blob so there is something to remove.
  writeMastersBlob(blobOf({ products: [{ _id: "old" }] }), store);
  assert.ok(store.map.has(MASTERS_BLOB_KEY), "precondition: a blob must already be stored");

  store.setCalls = 0;
  store.removeCalls = 0;
  const originalSetItem = store.setItem;
  store.setItem = (k: string, v: string) => {
    store.setCalls += 1;
    throw new Error("QuotaExceededError");
  };
  try {
    writeMastersBlob(blobOf({ products: [{ _id: "new" }] }), store);
  } finally {
    store.setItem = originalSetItem;
  }

  assert.equal(store.removeCalls, 1, "a failed write must remove the previously stored key exactly once");
  assert.ok(!store.map.has(MASTERS_BLOB_KEY), "the key must actually be gone from the store");
});

test("masters-blob: readMastersBlob removes a stored value with a wrong `v`, an aged-out `at`, or a future `at` — each returns null AND clears the key", () => {
  const store = fakeStorage();
  store.map.set(
    MASTERS_BLOB_KEY,
    JSON.stringify({ v: BOOTSTRAP_VERSION + 1, at: AT_NOW, parts: { products: [{ _id: "p1" }] } }),
  );
  assert.equal(readMastersBlob(NOW, store), null, "a wrong v must read as null");
  assert.equal(store.removeCalls, 1, "a wrong v must remove the stored key");
  assert.ok(!store.map.has(MASTERS_BLOB_KEY), "the key must be gone after a wrong-v read");

  const agedStore = fakeStorage();
  const agedAt = new Date(NOW - MASTERS_BLOB_MAX_AGE_MS - 60_000).toISOString();
  agedStore.map.set(MASTERS_BLOB_KEY, JSON.stringify({ v: BOOTSTRAP_VERSION, at: agedAt, parts: { products: [] } }));
  assert.equal(readMastersBlob(NOW, agedStore), null, "an aged-out `at` must read as null");
  assert.equal(agedStore.removeCalls, 1, "an aged-out blob must remove the stored key");
  assert.ok(!agedStore.map.has(MASTERS_BLOB_KEY), "the key must be gone after an aged-out read");

  const futureStore = fakeStorage();
  const futureAt = new Date(NOW + 60_000).toISOString();
  futureStore.map.set(MASTERS_BLOB_KEY, JSON.stringify({ v: BOOTSTRAP_VERSION, at: futureAt, parts: { products: [] } }));
  assert.equal(readMastersBlob(NOW, futureStore), null, "a future `at` must read as null");
  assert.equal(futureStore.removeCalls, 1, "a future-stamped blob must remove the stored key");
  assert.ok(!futureStore.map.has(MASTERS_BLOB_KEY), "the key must be gone after a future-`at` read");
});

test("masters-blob: a stored blob carrying a staff part reads back WITHOUT staff", () => {
  const store = fakeStorage();
  store.map.set(
    MASTERS_BLOB_KEY,
    JSON.stringify({
      v: BOOTSTRAP_VERSION,
      at: AT_NOW,
      parts: { products: [{ _id: "p1" }], staff: [{ _id: "s1", name: "Asha" }] },
    }),
  );
  const read = readMastersBlob(NOW, store);
  assert.ok(read, "the blob must still normalize despite carrying a staff part");
  assert.deepEqual(Object.keys(read.parts).sort(), ["products"], "a stored staff part must be dropped on the way back in, never seeded");
  assert.equal(read.parts.staff, undefined, "staff must be absent from the read result");
});

// ── persistedBlob / isPersistedPart ─────────────────────────────────────────

test("masters-blob: isPersistedPart is true for the four persisted keys and false for staff", () => {
  for (const key of MASTERS_PERSISTED_PART_KEYS) {
    assert.ok(isPersistedPart(key), `isPersistedPart(${key}) must be true`);
  }
  assert.equal(isPersistedPart("staff"), false, "isPersistedPart(\"staff\") must be false — staff is never persisted");
});

test("masters-blob: persistedBlob strips every non-persisted part (staff) and keeps the rest byte-identical", () => {
  const blob = blobOf({
    settings: { restaurantName: "Cafe One" },
    categories: [{ _id: "c1" }],
    products: [{ _id: "p1" }],
    tables: [{ _id: "t1" }],
    staff: [{ _id: "s1", name: "Asha" }],
  });
  const persisted = persistedBlob(blob);
  assert.equal(persisted.v, blob.v);
  assert.equal(persisted.at, blob.at);
  assert.deepEqual(
    Object.keys(persisted.parts).sort(),
    ["categories", "products", "settings", "tables"],
    "persistedBlob must keep exactly the four persisted parts",
  );
  assert.equal(persisted.parts.staff, undefined, "staff must be stripped");
  assert.deepEqual(persisted.parts.products, [{ _id: "p1" }], "a kept part must be byte-identical to the input");
});

test("masters-blob: MASTERS_PERSISTED_PART_KEYS is a strict subset of MASTERS_PART_KEYS that excludes exactly \"staff\"", () => {
  const all = new Set<MastersPartKey>(MASTERS_PART_KEYS);
  const persisted = new Set<MastersPartKey>(MASTERS_PERSISTED_PART_KEYS);
  for (const key of persisted) {
    assert.ok(all.has(key), `${key} in MASTERS_PERSISTED_PART_KEYS must also be in MASTERS_PART_KEYS`);
  }
  assert.equal(persisted.size, all.size - 1, "MASTERS_PERSISTED_PART_KEYS must have exactly one fewer entry than MASTERS_PART_KEYS");
  assert.ok(!persisted.has("staff"), "staff must be excluded from MASTERS_PERSISTED_PART_KEYS");
  assert.deepEqual(
    [...all].filter((k) => !persisted.has(k)),
    ["staff"],
    "staff must be the ONLY key present in MASTERS_PART_KEYS but absent from MASTERS_PERSISTED_PART_KEYS",
  );
});

test("masters-blob: clearMastersBlob removes exactly the masters key", () => {
  const store = fakeStorage();
  store.map.set("other.key", "keep me");
  writeMastersBlob(blobOf({ products: [{ _id: "p1" }] }), store);
  assert.ok(store.map.has(MASTERS_BLOB_KEY));

  clearMastersBlob(store);
  assert.equal(store.removeCalls, 1, "clearMastersBlob must call removeItem exactly once");
  assert.ok(!store.map.has(MASTERS_BLOB_KEY), "the masters key must be gone");
  assert.equal(store.map.get("other.key"), "keep me", "no other key may be touched");
  assert.equal(readMastersBlob(NOW, store), null, "a cleared tab must read no blob");
});

// Contract change: the device store is now window.localStorage (device-scoped,
// survives a reload/closed tab/restart), not the old per-tab sessionStorage —
// owner rule 2026-09-09 ("use local store properly"; a per-tab store made the
// hold routine on every fresh launch of the counter PC).
test("masters-blob: with NO storage argument the module falls back to window.localStorage — inert when there is no window (server render), and using it when there is", () => {
  // No window (this node env == a server render): every entry point must be
  // inert rather than throwing into a render.
  assert.equal(typeof globalThis.window, "undefined", "precondition: this test env has no window, so the no-window branch is the one under test");
  assert.equal(readMastersBlob(NOW), null, "no storage and no window must read as null");
  assert.doesNotThrow(() => writeMastersBlob(blobOf({ products: [] })), "writeMastersBlob must be inert without a store");
  assert.doesNotThrow(() => upsertMastersPart("products", [], AT_NOW), "upsertMastersPart must be inert without a store");
  assert.doesNotThrow(() => clearMastersBlob(), "clearMastersBlob must be inert without a store");

  // With a window, the fallback must reach window.localStorage specifically.
  const store = fakeStorage();
  (globalThis as { window?: unknown }).window = { localStorage: store } as unknown as Window & typeof globalThis;
  try {
    writeMastersBlob(blobOf({ categories: [{ _id: "c1" }] }));
    assert.ok(store.map.has(MASTERS_BLOB_KEY), "the no-argument write must land in window.localStorage");
    const read = readMastersBlob(NOW);
    assert.ok(read, "the no-argument read must find it");
    assert.deepEqual(read.parts.categories, [{ _id: "c1" }]);
    clearMastersBlob();
    assert.equal(readMastersBlob(NOW), null, "the no-argument clear must remove it");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
  assert.equal(typeof globalThis.window, "undefined", "window must be restored for the suites that follow");
});

test("masters-blob: a window carrying ONLY sessionStorage (no localStorage) is treated as no store at all — inert, not a silent fallback to the wrong store", () => {
  const sessionOnly = fakeStorage();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: sessionOnly,
  } as unknown as Window & typeof globalThis;
  try {
    assert.equal(
      readMastersBlob(NOW),
      null,
      "a window with only sessionStorage must read as null — the module must not silently reach for the per-tab store",
    );
    assert.doesNotThrow(
      () => writeMastersBlob(blobOf({ products: [{ _id: "p1" }] })),
      "writeMastersBlob must be inert when window.localStorage is absent",
    );
    assert.equal(sessionOnly.setCalls, 0, "sessionStorage must never be touched — it is not the device store");
    assert.doesNotThrow(() => upsertMastersPart("products", [{ _id: "p1" }], AT_NOW), "upsertMastersPart must be inert too");
    assert.doesNotThrow(() => clearMastersBlob(), "clearMastersBlob must be inert too");
    assert.equal(sessionOnly.removeCalls, 0, "clearMastersBlob must not remove anything from sessionStorage");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

// ── source pin: localStorage now, never sessionStorage ──────────────────────

// Contract change (owner directive 2026-09-09/11, "use local store properly"):
// the device store is now window.localStorage, so this pin is INVERTED from
// its CB-DL-1 shape — it now requires "localStorage" (positive) and bans
// "sessionStorage" (negative) in lib/masters-blob.ts, and MasterDataProvider.tsx
// must still name neither spelling (it only ever reaches storage through
// lib/masters-blob.ts).
test("PIN: lib/masters-blob.ts uses the persistent device-scoped web store (localStorage), never the per-tab one (sessionStorage) — RAW source; MasterDataProvider.tsx names neither spelling directly", () => {
  // Needle built by concatenation so this gate cannot match its own source
  // (testing.md: a banned-string scan reads raw bytes INCLUDING comments).
  const PERSISTED = "local" + "Storage";
  const PER_TAB = "session" + "Storage";

  const blobSrc = readSrc(MASTERS_BLOB_SRC);
  assert.ok(blobSrc.length > 500, `positive landmark: ${MASTERS_BLOB_SRC} must have been read (got ${blobSrc.length} bytes)`);
  assert.ok(
    blobSrc.includes(PERSISTED),
    `positive landmark: ${MASTERS_BLOB_SRC} must read the device's persistent store (localStorage) — that is the whole point of this contract change`,
  );
  assert.ok(
    !blobSrc.includes(PER_TAB),
    `${MASTERS_BLOB_SRC} must never reference the per-tab store (sessionStorage) anywhere, comments included — a stuck placeholder on every fresh tab was exactly the bug the owner rejected`,
  );
  assert.ok(
    blobSrc.includes("MASTERS_BLOB_KEY"),
    `positive landmark: ${MASTERS_BLOB_SRC} must key its reads/writes on MASTERS_BLOB_KEY`,
  );

  // The provider must reach storage ONLY through lib/masters-blob.ts — it
  // must name neither spelling itself (RAW source, both directions).
  const providerSrc = readSrc(MASTER_DATA_PROVIDER_SRC);
  assert.ok(providerSrc.length > 500, `positive landmark: ${MASTER_DATA_PROVIDER_SRC} must have been read (got ${providerSrc.length} bytes)`);
  assert.ok(
    !providerSrc.includes(PERSISTED),
    `${MASTER_DATA_PROVIDER_SRC} must not reference localStorage directly — it reaches the device store only through lib/masters-blob.ts`,
  );
  assert.ok(
    !providerSrc.includes(PER_TAB),
    `${MASTER_DATA_PROVIDER_SRC} must not reference sessionStorage directly either`,
  );
  assert.ok(
    providerSrc.includes("readMastersBlob"),
    `positive landmark: ${MASTER_DATA_PROVIDER_SRC} must reach the device's copy through lib/masters-blob`,
  );
  assert.ok(
    providerSrc.includes("writeMastersBlob"),
    `positive landmark: ${MASTER_DATA_PROVIDER_SRC} must write the device's copy through lib/masters-blob`,
  );
});
