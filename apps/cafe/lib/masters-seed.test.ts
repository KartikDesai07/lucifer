// CB-DL-1 S5.3 — lib/masters-seed.ts against a REAL TanStack QueryClient.
//
// `new QueryClient()` from "@tanstack/react-query" imports and runs under
// `node --import tsx` (measured this session — the package's React entry has
// no DOM side effects at import time), so these cases drive the shipped
// seedMasters against the real cache: real query keys, real
// setQueryData({ updatedAt }), real getQueryState().dataUpdatedAt. A fake
// query client would have proved nothing about the one rule that matters —
// never overwrite fresher client data.
//
// The five query keys are compared against the hook modules' OWN exports,
// imported directly (they also import cleanly in node), rather than harvested
// from source: a real import cannot drift the way a regex can.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";

import { SETTINGS_KEYS } from "@/hooks/use-settings";
import { CATEGORY_KEYS } from "@/hooks/use-categories";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { STAFF_KEYS } from "@/hooks/use-staff";
import {
  BOOTSTRAP_VERSION,
  MASTERS_PART_KEYS,
  type BootstrapPayload,
  type MastersBlob,
} from "@/lib/bootstrap-contract";
import {
  MASTERS_QUERY_KEYS,
  blobOfPayload,
  partsOfPayload,
  seedMasters,
} from "@/lib/masters-seed";

const AT = "2026-09-09T10:00:00.000Z";
const AT_MS = Date.parse(AT);

const SETTINGS = { restaurantName: "Cafe One" };
const CATEGORIES = [{ _id: "c1", name: "Coffee" }];
const PRODUCTS = [{ _id: "p1", name: "Latte" }];
const TABLES = [{ _id: "t1", tableNo: "T1" }];
const STAFF = [{ _id: "s1", name: "Asha" }];

function fullBlob(at: string = AT): MastersBlob {
  return {
    v: BOOTSTRAP_VERSION,
    at,
    parts: { settings: SETTINGS, categories: CATEGORIES, products: PRODUCTS, tables: TABLES, staff: STAFF },
  };
}

function payload(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    v: BOOTSTRAP_VERSION,
    at: AT,
    mastersVersion: "settings:1:0|categories:1:0|products:1:0|tables:1:0|staff:1:0",
    settings: SETTINGS as unknown as BootstrapPayload["settings"],
    categories: CATEGORIES as unknown as BootstrapPayload["categories"],
    products: PRODUCTS as unknown as BootstrapPayload["products"],
    tables: TABLES as unknown as BootstrapPayload["tables"],
    staff: STAFF as unknown as BootstrapPayload["staff"],
    ...overrides,
  };
}

// ── the query-key contract ──────────────────────────────────────────────────

test("masters-seed: MASTERS_QUERY_KEYS is exactly the five hook modules' own key exports (imported, not harvested) — a hook that renames its key must break here, not silently seed a key nobody reads", () => {
  assert.deepEqual(
    MASTERS_QUERY_KEYS,
    {
      settings: SETTINGS_KEYS.all,
      categories: CATEGORY_KEYS.all,
      products: PRODUCT_KEYS.all,
      tables: TABLE_KEYS.all,
      staff: STAFF_KEYS.all,
    },
    "MASTERS_QUERY_KEYS must be built from the hooks that own the keys",
  );
  // Every part key must have a key, and every key must be a SINGLE segment:
  // the provider's write-back only accepts length-1 keys, and the archived
  // products view (["products","archived"]) must never be seeded.
  assert.deepEqual(
    Object.keys(MASTERS_QUERY_KEYS).sort(),
    [...MASTERS_PART_KEYS].sort(),
    "every part key in MASTERS_PART_KEYS needs a query key, and no extras",
  );
  for (const part of MASTERS_PART_KEYS) {
    // Annotated: without it tsc reports TS7022 on this local, because
    // MASTERS_QUERY_KEYS' own type is being resolved through the deepEqual
    // above in the same scope.
    const key: readonly string[] = MASTERS_QUERY_KEYS[part];
    assert.equal(key.length, 1, `${part}'s query key must be a single segment, got ${JSON.stringify(key)}`);
    assert.equal(typeof key[0], "string", `${part}'s query key segment must be a string`);
  }
});

// ── seeding ─────────────────────────────────────────────────────────────────

test("masters-seed: seedMasters sets every present part with dataUpdatedAt === Date.parse(blob.at) — the blob's own stamp, so each hook's staleTime governs the next refetch", () => {
  const qc = new QueryClient();
  const seeded = seedMasters(qc, fullBlob());
  assert.deepEqual([...seeded].sort(), [...MASTERS_PART_KEYS].sort(), "all five present parts must be reported as seeded");

  for (const part of MASTERS_PART_KEYS) {
    const state = qc.getQueryState(MASTERS_QUERY_KEYS[part]);
    assert.ok(state, `${part} must have a query state after seeding`);
    assert.equal(
      state.dataUpdatedAt,
      AT_MS,
      `${part} must be stamped with the blob's own at (${AT_MS}), not the browser's clock — otherwise a day-old blob would read as just-fetched`,
    );
  }
  assert.deepEqual(qc.getQueryData(MASTERS_QUERY_KEYS.products), PRODUCTS, "the products part must land under the products key");
  assert.deepEqual(qc.getQueryData(MASTERS_QUERY_KEYS.settings), SETTINGS, "the settings part must land under the settings key");
});

test("masters-seed: absent and null parts are skipped and their key stays undefined — a non-admin's staff:null must never be served as an answer", () => {
  const qc = new QueryClient();
  const blob: MastersBlob = {
    v: BOOTSTRAP_VERSION,
    at: AT,
    parts: { categories: CATEGORIES, products: PRODUCTS, settings: null },
  };
  const seeded = seedMasters(qc, blob);
  assert.deepEqual([...seeded].sort(), ["categories", "products"], "only the present, non-null parts may be seeded");
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.staff), undefined, '["staff"] must stay undefined so the admin Staff page fetches for real');
  assert.equal(qc.getQueryState(MASTERS_QUERY_KEYS.staff), undefined, '["staff"] must have no query state at all');
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.settings), undefined, "an explicit null settings part must not be seeded as null");
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.tables), undefined, "an absent tables part must not be seeded");
});

test("masters-seed: a key already holding data with a NEWER dataUpdatedAt is NOT overwritten (a mutation in this tab must not roll back to the blob)", () => {
  const qc = new QueryClient();
  const fresh = [{ _id: "p1", name: "Latte (price just changed)" }];
  qc.setQueryData(MASTERS_QUERY_KEYS.products, fresh, { updatedAt: AT_MS + 1 });

  const seeded = seedMasters(qc, fullBlob());
  assert.ok(!seeded.includes("products"), "products must be reported as NOT seeded when the key already holds fresher data");
  assert.deepEqual(
    qc.getQueryData(MASTERS_QUERY_KEYS.products),
    fresh,
    "the fresher in-tab data must survive — overwriting it would silently roll the screen back",
  );
  assert.equal(qc.getQueryState(MASTERS_QUERY_KEYS.products)?.dataUpdatedAt, AT_MS + 1, "the fresher stamp must survive too");
  // The other four had nothing, so they must all have been seeded.
  assert.deepEqual([...seeded].sort(), ["categories", "settings", "staff", "tables"], "the untouched keys must still be seeded");
});

test("masters-seed: with { force: true } a NEWER existing entry IS overwritten — the bootstrap response is the authoritative refresh, so a client clock running ahead cannot pin older data forever", () => {
  const qc = new QueryClient();
  const aheadOfServer = [{ _id: "p-clock-skew" }];
  qc.setQueryData(MASTERS_QUERY_KEYS.products, aheadOfServer, { updatedAt: AT_MS + 60_000 });

  // Default path first: the newer entry survives (that is the STORED-copy rule).
  const unforced = seedMasters(qc, fullBlob());
  assert.ok(!unforced.includes("products"), "precondition: without force the newer entry must survive");
  assert.deepEqual(qc.getQueryData(MASTERS_QUERY_KEYS.products), aheadOfServer);

  const forced = seedMasters(qc, fullBlob(), { force: true });
  assert.ok(forced.includes("products"), "with force:true the newer entry must be overwritten");
  assert.deepEqual([...forced].sort(), [...MASTERS_PART_KEYS].sort(), "force must write EVERY present non-null part, regardless of stamps");
  assert.deepEqual(
    qc.getQueryData(MASTERS_QUERY_KEYS.products),
    PRODUCTS,
    "the payload's part must win under force — a browser clock minutes ahead of the server must not freeze the menu",
  );
  assert.equal(
    qc.getQueryState(MASTERS_QUERY_KEYS.products)?.dataUpdatedAt,
    AT_MS,
    "and the stamp must be rewritten to the payload's own at, not left in the client's future",
  );
});

test("masters-seed: force still skips absent and null parts — it overrides the freshness gate only, never the presence rule", () => {
  const qc = new QueryClient();
  const seeded = seedMasters(
    qc,
    { v: BOOTSTRAP_VERSION, at: AT, parts: { products: PRODUCTS, staff: null } },
    { force: true },
  );
  assert.deepEqual(seeded, ["products"], "force must not turn a null part into a seeded one");
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.staff), undefined, '["staff"] must stay undefined even under force');
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.tables), undefined, "an absent part must stay absent even under force");
});

test("masters-seed: force:false and an omitted opts object behave identically (the default is the skip-when-fresher rule)", () => {
  for (const opts of [undefined, {}, { force: false }] as const) {
    const qc = new QueryClient();
    const fresher = [{ _id: "p-fresh" }];
    qc.setQueryData(MASTERS_QUERY_KEYS.products, fresher, { updatedAt: AT_MS + 1 });
    const seeded = seedMasters(qc, fullBlob(), opts);
    assert.ok(
      !seeded.includes("products"),
      `opts=${JSON.stringify(opts)} must keep the default rule — only an explicit force:true may overwrite fresher data`,
    );
    assert.deepEqual(qc.getQueryData(MASTERS_QUERY_KEYS.products), fresher);
  }
});

test("masters-seed: an entry stamped EXACTLY at the blob's at is left alone (the gate is >=), while a strictly OLDER entry IS overwritten", () => {
  const equalQc = new QueryClient();
  const sameAge = [{ _id: "p-same" }];
  equalQc.setQueryData(MASTERS_QUERY_KEYS.products, sameAge, { updatedAt: AT_MS });
  const equalSeeded = seedMasters(equalQc, fullBlob());
  assert.ok(!equalSeeded.includes("products"), "same-age data must not be re-seeded — the gate is existingAt >= at");
  assert.deepEqual(equalQc.getQueryData(MASTERS_QUERY_KEYS.products), sameAge, "same-age data must survive untouched");

  const olderQc = new QueryClient();
  olderQc.setQueryData(MASTERS_QUERY_KEYS.products, [{ _id: "p-old" }], { updatedAt: AT_MS - 1 });
  const olderSeeded = seedMasters(olderQc, fullBlob());
  assert.ok(olderSeeded.includes("products"), "strictly older data must be overwritten by the blob");
  assert.deepEqual(olderQc.getQueryData(MASTERS_QUERY_KEYS.products), PRODUCTS, "the blob's part must win over strictly older data");
  assert.equal(olderQc.getQueryState(MASTERS_QUERY_KEYS.products)?.dataUpdatedAt, AT_MS, "and it must carry the blob's stamp");
});

test("masters-seed: re-seeding the SAME blob is a no-op — it returns [] and leaves the data and stamps identical (the seed is idempotent, so the provider's effect can run twice)", () => {
  const qc = new QueryClient();
  const first = seedMasters(qc, fullBlob());
  assert.equal(first.length, MASTERS_PART_KEYS.length, "the first seed must seed all five");

  const before = MASTERS_PART_KEYS.map((p) => ({
    data: qc.getQueryData(MASTERS_QUERY_KEYS[p]),
    at: qc.getQueryState(MASTERS_QUERY_KEYS[p])?.dataUpdatedAt,
  }));

  const second = seedMasters(qc, fullBlob());
  assert.deepEqual(second, [], "re-seeding the same blob must report NOTHING seeded — every key already holds data at that exact stamp");

  const after = MASTERS_PART_KEYS.map((p) => ({
    data: qc.getQueryData(MASTERS_QUERY_KEYS[p]),
    at: qc.getQueryState(MASTERS_QUERY_KEYS[p])?.dataUpdatedAt,
  }));
  assert.deepEqual(after, before, "the cache must be byte-identical after the second seed");
});

test("masters-seed: a blob whose `at` is unparseable seeds NOTHING rather than stamping the cache with NaN", () => {
  const qc = new QueryClient();
  const seeded = seedMasters(qc, { v: BOOTSTRAP_VERSION, at: "not a date", parts: { products: PRODUCTS } });
  assert.deepEqual(seeded, [], "an unparseable at must seed nothing");
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.products), undefined, "nothing may land in the cache");
});

// ── payload -> blob ─────────────────────────────────────────────────────────

test("masters-seed: partsOfPayload drops null settings and null staff, and keeps every other part", () => {
  const both = partsOfPayload(payload());
  assert.deepEqual(Object.keys(both).sort(), [...MASTERS_PART_KEYS].sort(), "a full payload must yield all five parts");

  const nonAdmin = partsOfPayload(payload({ staff: null }));
  assert.ok(!Object.hasOwn(nonAdmin, "staff"), "a non-admin payload's staff:null must not become a part (D3: the staff part is admin-only)");
  assert.deepEqual(Object.keys(nonAdmin).sort(), ["categories", "products", "settings", "tables"]);

  const unconfigured = partsOfPayload(payload({ settings: null, staff: null }));
  assert.deepEqual(
    Object.keys(unconfigured).sort(),
    ["categories", "products", "tables"],
    "a cluster with no Settings document yet must not seed settings:null as if it were an answer",
  );

  const emptyLists = partsOfPayload(payload({ categories: [], products: [] }));
  assert.deepEqual(emptyLists.categories, [], "an EMPTY array is a real answer (a cafe with no categories) and must still be a part");
  assert.ok(Object.hasOwn(emptyLists, "products"), "an empty products list must still be a part");
});

test("masters-seed: blobOfPayload carries the current version and the payload's own `at`, with only its present parts", () => {
  const blob = blobOfPayload(payload({ staff: null }));
  assert.equal(blob.v, BOOTSTRAP_VERSION, "the blob must be stamped with the current payload version so a bump discards it");
  assert.equal(blob.at, AT, "the blob must carry the payload's server-side at, not the browser's clock");
  assert.deepEqual(Object.keys(blob.parts).sort(), ["categories", "products", "settings", "tables"], "only the present parts ride along");
  assert.deepEqual(blob.parts.products, PRODUCTS, "the part values must be the payload's own");
});

test("masters-seed: blobOfPayload -> seedMasters is the provider's real path — a non-admin payload seeds four keys and leaves the staff key untouched", () => {
  const qc = new QueryClient();
  const seeded = seedMasters(qc, blobOfPayload(payload({ staff: null })));
  assert.deepEqual([...seeded].sort(), ["categories", "products", "settings", "tables"], "four parts for a non-admin session");
  assert.equal(qc.getQueryData(MASTERS_QUERY_KEYS.staff), undefined, '["staff"] must remain untouched for a non-admin');
  for (const part of ["categories", "products", "settings", "tables"] as const) {
    assert.equal(qc.getQueryState(MASTERS_QUERY_KEYS[part])?.dataUpdatedAt, AT_MS, `${part} must carry the payload's at`);
  }
});
