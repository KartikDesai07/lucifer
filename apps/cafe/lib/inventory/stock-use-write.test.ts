import { test } from "node:test";
import assert from "node:assert/strict";
import { STOCK_ITEMS_MAX, STOCK_ITEM_NAME_MAX_LEN, STOCK_QTY_MAX_MILLI } from "@pos/shared/inventory";
import { STOCK_ITEM_LIMIT_ERROR } from "./items";
import {
  STOCK_USE_ITEM_REMOVED_ERROR,
  STOCK_USE_OWN_BUSY_ERROR,
  STOCK_USE_OWN_NAME_ERROR,
  STOCK_USE_PRODUCT_NOT_FOUND_ERROR,
  getStockUse,
  setStockUse,
  stockUseArchivedError,
  stockUseSizeError,
  stockUseTooBigError,
  stockUseTooSmallError,
  stockUseUnitError,
  trackOwnStock,
  type StockUseDeps,
  type UseItemRow,
  type UseProductRow,
} from "./stock-use-write";

// Inventory lite Slice 3: the stock-use read / replace / one-tap logic over fake ports (no DB). DB truth (raw stored
// values, the unique index, the concurrent taps, a real Pay Now): scripts/verify-inventory-stock-use-live.ts.

const PID = "665f0000000000000000a001";
const MILK = "665f0000000000000000b001";
const SUGAR = "665f0000000000000000b002";
const OWN = "665f0000000000000000b003";

const item = (id: string, name: string, unit: UseItemRow["unit"], archived?: boolean): UseItemRow => {
  const row: UseItemRow = { _id: id, name, unit };
  if (archived) row.archived = true;
  return row;
};

interface Fake {
  deps: StockUseDeps;
  writes: { kind: string; filter?: unknown; update?: unknown }[];
  /** Every name the duplicate-name check was asked about. */
  names: string[];
  state: { product: UseProductRow | null; reread?: UseProductRow | null; own: UseItemRow | null; items: UseItemRow[] };
  cfg: { active: number; nameTaken: boolean; matched: number; upsertThrows: unknown; casMatched: number };
}

function fake(over: Partial<Fake["state"]> = {}, cfg: Partial<Fake["cfg"]> = {}): Fake {
  const writes: Fake["writes"] = [];
  const names: string[] = [];
  const state: Fake["state"] = { product: {}, own: null, items: [], ...over };
  const c: Fake["cfg"] = { active: 0, nameTaken: false, matched: 1, upsertThrows: null, casMatched: 1, ...cfg };
  let productReads = 0;
  const deps: StockUseDeps = {
    connect: async () => {},
    findProduct: async () => {
      productReads += 1;
      return productReads > 1 && state.reread !== undefined ? state.reread : state.product;
    },
    findItems: async (ids) => state.items.filter((i) => ids.includes(String(i._id))),
    findOwnItem: async () => state.own,
    countActive: async () => c.active,
    nameTaken: async (name) => {
      names.push(name);
      return c.nameTaken;
    },
    upsertItem: async (filter, update) => {
      writes.push({ kind: "upsert", filter, update });
      if (c.upsertThrows) throw c.upsertThrows;
      return item(OWN, "Chips", "pcs");
    },
    updateProduct: async (filter, update) => {
      const isCas = JSON.stringify(filter).includes("$exists");
      writes.push({ kind: isCas ? "cas" : "product", filter, update });
      return isCas ? c.casMatched : c.matched;
    },
  };
  return { deps, writes, names, state, cfg: c };
}

const put = (f: Fake, lines: Parameters<typeof setStockUse>[1]["lines"]) => setStockUse(PID, { lines }, f.deps);

test("PUT converts the typed unit into the item's own: 150000 ml vs an L item stores 150", async () => {
  const f = fake({ product: {}, items: [item(MILK, "Milk", "L")] });
  const r = await put(f, [{ itemId: MILK, unit: "ml", qtyMilli: 150000 }]);
  assert.deepEqual(f.writes, [{ kind: "product", filter: { _id: PID }, update: { $set: { stockUse: [{ itemId: MILK, qty: 150 }] } } }]);
  assert.deepEqual(r, { ok: true, dto: { lines: [{ itemId: MILK, name: "Milk", unit: "L", qtyMilli: 150 }] } });
});

test("PUT converts g to kg: 10000 milli-g vs a kg item stores 10", async () => {
  const f = fake({ items: [item(SUGAR, "Sugar", "kg")] });
  await put(f, [{ itemId: SUGAR, unit: "g", qtyMilli: 10000 }]);
  assert.deepEqual(f.writes[0].update, { $set: { stockUse: [{ itemId: SUGAR, qty: 10 }] } });
});

test("PUT sizes: converted, 0 kept, and no sizes key on a line that gave none", async () => {
  const f = fake({ product: { variations: [{ name: "Small" }, { name: "Large" }] }, items: [item(MILK, "Milk", "L"), item(SUGAR, "Sugar", "kg")] });
  const r = await put(f, [
    { itemId: MILK, unit: "ml", qtyMilli: 150000, sizes: [{ name: "Small", qtyMilli: 100000 }, { name: "Large", qtyMilli: 0 }] },
    { itemId: SUGAR, unit: "kg", qtyMilli: 1000 },
  ]);
  assert.deepEqual(f.writes[0].update, {
    $set: {
      stockUse: [
        { itemId: MILK, qty: 150, sizes: [{ name: "Small", qty: 100 }, { name: "Large", qty: 0 }] },
        { itemId: SUGAR, qty: 1000 },
      ],
    },
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.dto.lines[0].sizes, [{ name: "Small", qtyMilli: 100 }, { name: "Large", qtyMilli: 0 }]);
    assert.equal("sizes" in r.dto.lines[1], false);
  }
});

test("PUT refusals write nothing: a unit from another group names the item and its unit", async () => {
  const f = fake({ items: [item(MILK, "Milk", "L")] });
  const r = await put(f, [{ itemId: MILK, unit: "g", qtyMilli: 5000 }]);
  assert.deepEqual(r, { ok: false, status: 400, error: stockUseUnitError("Milk", "L") });
  assert.equal(stockUseUnitError("Milk", "L"), "Pick a unit that fits Milk (L)");
  assert.deepEqual(f.writes, []);
});

test("PUT refusals write nothing: a missing stock item, an archived one", async () => {
  const gone = fake({ items: [] });
  assert.deepEqual(await put(gone, [{ itemId: MILK, unit: "L", qtyMilli: 1000 }]), { ok: false, status: 400, error: STOCK_USE_ITEM_REMOVED_ERROR });
  assert.deepEqual(gone.writes, []);
  const old = fake({ items: [item(MILK, "Milk", "L", true)] });
  assert.deepEqual(await put(old, [{ itemId: MILK, unit: "L", qtyMilli: 1000 }]), { ok: false, status: 400, error: stockUseArchivedError("Milk") });
  assert.deepEqual(old.writes, []);
});

test("PUT refusals write nothing: an unknown size, and sizes on an item with no sizes", async () => {
  const f = fake({ product: { variations: [{ name: "Small" }] }, items: [item(MILK, "Milk", "L")] });
  const r = await put(f, [{ itemId: MILK, unit: "L", qtyMilli: 1000, sizes: [{ name: "small", qtyMilli: 1 }] }]);
  assert.deepEqual(r, { ok: false, status: 400, error: stockUseSizeError("small") });
  assert.equal(stockUseSizeError("small"), 'This item has no size named "small". Close the item and open it again.');
  const bare = fake({ product: {}, items: [item(MILK, "Milk", "L")] });
  const r2 = await put(bare, [{ itemId: MILK, unit: "L", qtyMilli: 1000, sizes: [{ name: "Small", qtyMilli: 1 }] }]);
  assert.equal(r2.ok, false);
  assert.deepEqual([f.writes, bare.writes], [[], []]);
});

test("PUT amounts: too small (400 milli-ml vs L rounds to 0) and too large are 400s, a size too", async () => {
  const f = fake({ items: [item(MILK, "Milk", "L")] });
  assert.deepEqual(await put(f, [{ itemId: MILK, unit: "ml", qtyMilli: 400 }]), { ok: false, status: 400, error: stockUseTooSmallError("Milk") });
  assert.deepEqual(f.writes, []);
  const edge = await put(f, [{ itemId: MILK, unit: "L", qtyMilli: STOCK_QTY_MAX_MILLI }]);
  assert.deepEqual(edge, { ok: true, dto: { lines: [{ itemId: MILK, name: "Milk", unit: "L", qtyMilli: STOCK_QTY_MAX_MILLI }] } });
  const big = fake({ items: [item(SUGAR, "Sugar", "g")] });
  assert.deepEqual(await put(big, [{ itemId: SUGAR, unit: "kg", qtyMilli: STOCK_QTY_MAX_MILLI }]), { ok: false, status: 400, error: stockUseTooBigError("Sugar") });
  const size = fake({ product: { variations: [{ name: "S" }] }, items: [item(SUGAR, "Sugar", "g")] });
  const sized = await put(size, [{ itemId: SUGAR, unit: "g", qtyMilli: 1000, sizes: [{ name: "S", qtyMilli: STOCK_QTY_MAX_MILLI + 1 }] }]);
  assert.deepEqual(sized, { ok: false, status: 400, error: stockUseTooBigError("Sugar") });
  assert.deepEqual([big.writes, size.writes], [[], []]);
});

test("PUT: a size typed above 0 that rounds to 0 is a 400 (never stored as uses none); a typed 0 is kept", async () => {
  const sized = () => fake({ product: { variations: [{ name: "S" }, { name: "L" }] }, items: [item(MILK, "Milk", "L")] });
  const f = sized();
  const tiny = await put(f, [{ itemId: MILK, unit: "ml", qtyMilli: 150000, sizes: [{ name: "S", qtyMilli: 400 }, { name: "L", qtyMilli: 0 }] }]);
  assert.deepEqual(tiny, { ok: false, status: 400, error: stockUseTooSmallError("Milk") });
  assert.equal(f.writes.length, 0);
  const g = sized();
  const zero = await put(g, [{ itemId: MILK, unit: "ml", qtyMilli: 150000, sizes: [{ name: "S", qtyMilli: 500 }, { name: "L", qtyMilli: 0 }] }]);
  assert.ok(zero.ok);
  assert.deepEqual((g.writes[0].update as { $set: { stockUse: unknown } }).$set.stockUse, [
    { itemId: MILK, qty: 150, sizes: [{ name: "S", qty: 1 }, { name: "L", qty: 0 }] },
  ]);
});

test("PUT lines [] is one $unset (never a $set of an empty array) and reads no stock items", async () => {
  const f = fake();
  let itemReads = 0;
  f.deps.findItems = async () => {
    itemReads += 1;
    return [];
  };
  assert.deepEqual(await put(f, []), { ok: true, dto: { lines: [] } });
  assert.deepEqual(f.writes, [{ kind: "product", filter: { _id: PID }, update: { $unset: { stockUse: "" } } }]);
  assert.equal(itemReads, 0);
});

test("PUT: a product that is gone is a 404, on the read and on the write", async () => {
  const none = fake({ product: null });
  assert.deepEqual(await put(none, []), { ok: false, status: 404, error: STOCK_USE_PRODUCT_NOT_FOUND_ERROR });
  const raced = fake({ items: [item(MILK, "Milk", "L")] }, { matched: 0 });
  assert.deepEqual(await put(raced, [{ itemId: MILK, unit: "L", qtyMilli: 1000 }]), { ok: false, status: 404, error: STOCK_USE_PRODUCT_NOT_FOUND_ERROR });
});

test("GET maps name/unit/archived/sizes and drops a link whose stock item is gone", async () => {
  const f = fake({
    product: {
      stockUse: [
        { itemId: MILK, qty: 150, sizes: [{ name: "S", qty: 100 }] },
        { itemId: SUGAR, qty: 5 },
        { itemId: OWN, qty: 1000 },
      ],
    },
    items: [item(MILK, "Milk", "L", true), item(SUGAR, "Sugar", "kg")],
  });
  assert.deepEqual(await getStockUse(PID, f.deps), {
    ok: true,
    dto: {
      lines: [
        { itemId: MILK, name: "Milk", unit: "L", archived: true, qtyMilli: 150, sizes: [{ name: "S", qtyMilli: 100 }] },
        { itemId: SUGAR, name: "Sugar", unit: "kg", qtyMilli: 5 },
      ],
    },
  });
  assert.deepEqual(await getStockUse(PID, fake({ product: null }).deps), { ok: false, status: 404, error: STOCK_USE_PRODUCT_NOT_FOUND_ERROR });
  assert.deepEqual(await getStockUse(PID, fake({ product: {} }).deps), { ok: true, dto: { lines: [] } });
});

// ── trackOwnStock ──

const own = (over: Partial<Fake["state"]> = {}, cfg: Partial<Fake["cfg"]> = {}) => fake({ product: { name: "Chips" }, ...over }, cfg);

test("own: an item that already uses other stock is a 409 and no StockItem is written", async () => {
  const f = own({ product: { name: "Chips", stockUse: [{ itemId: MILK, qty: 1 }] } });
  assert.deepEqual(await trackOwnStock(PID, "pcs", f.deps), { ok: false, status: 409, error: STOCK_USE_OWN_BUSY_ERROR });
  assert.deepEqual(f.writes, []);
  // Two links, one of them its own, is still "uses stock".
  const two = own({ product: { name: "Chips", stockUse: [{ itemId: OWN, qty: 1000 }, { itemId: MILK, qty: 1 }] }, own: item(OWN, "Chips", "pcs") });
  assert.equal((await trackOwnStock(PID, "pcs", two.deps)).ok, false);
  assert.deepEqual(two.writes, []);
});

test("own: replay (only the own link) is a 200 with the current DTO and no writes", async () => {
  const f = own({ product: { name: "Chips", stockUse: [{ itemId: OWN, qty: 1000 }] }, own: item(OWN, "Chips", "pcs"), items: [item(OWN, "Chips", "pcs")] });
  assert.deepEqual(await trackOwnStock(PID, "pcs", f.deps), { ok: true, dto: { lines: [{ itemId: OWN, name: "Chips", unit: "pcs", qtyMilli: 1000 }] } });
  assert.deepEqual(f.writes, []);
});

test("own: a product that is gone is a 404", async () => {
  assert.deepEqual(await trackOwnStock(PID, "pcs", fake({ product: null }).deps), { ok: false, status: 404, error: STOCK_USE_PRODUCT_NOT_FOUND_ERROR });
});

test("own: another active item with the name is a 409 and nothing is written; the cap is a 400", async () => {
  const taken = own({}, { nameTaken: true });
  assert.deepEqual(await trackOwnStock(PID, "pcs", taken.deps), { ok: false, status: 409, error: STOCK_USE_OWN_NAME_ERROR });
  assert.deepEqual(taken.writes, []);
  const full = own({}, { active: STOCK_ITEMS_MAX });
  assert.deepEqual(await trackOwnStock(PID, "pcs", full.deps), { ok: false, status: 400, error: STOCK_ITEM_LIMIT_ERROR });
  assert.deepEqual(full.writes, []);
});

test("own: the fresh path upserts with $setOnInsert {name<=60, unit} only, then claims with the $exists CAS", async () => {
  const long = "  " + "x".repeat(STOCK_ITEM_NAME_MAX_LEN - 1) + "  yyy";
  const f = own({ product: { name: long } });
  const r = await trackOwnStock(PID, "kg", f.deps);
  const name = "x".repeat(STOCK_ITEM_NAME_MAX_LEN - 1);
  assert.deepEqual(f.writes, [
    { kind: "upsert", filter: { ownerProductId: PID }, update: { $setOnInsert: { name, unit: "kg" }, $unset: { archived: "" } } },
    { kind: "cas", filter: { _id: PID, stockUse: { $exists: false } }, update: { $set: { stockUse: [{ itemId: OWN, qty: 1000 }] } } },
  ]);
  assert.deepEqual(r, { ok: true, dto: { lines: [{ itemId: OWN, name: "Chips", unit: "pcs", qtyMilli: 1000 }] } });
});

test("own: an existing active own item is not upserted (its unit is fixed), only claimed", async () => {
  const f = own({ own: item(OWN, "Chips", "g") });
  const r = await trackOwnStock(PID, "pcs", f.deps);
  assert.deepEqual(f.writes.map((w) => w.kind), ["cas"]);
  assert.ok(r.ok && r.dto.lines[0].unit === "g");
});

test("own: a CAS miss that finds the own link on re-read is a 200 replay; any other link is a 409; gone is a 404", async () => {
  const replay = own({ reread: { stockUse: [{ itemId: OWN, qty: 1000 }] }, items: [item(OWN, "Chips", "pcs")] }, { casMatched: 0 });
  assert.deepEqual(await trackOwnStock(PID, "pcs", replay.deps), { ok: true, dto: { lines: [{ itemId: OWN, name: "Chips", unit: "pcs", qtyMilli: 1000 }] } });
  const other = own({ reread: { stockUse: [{ itemId: MILK, qty: 5 }] } }, { casMatched: 0 });
  assert.deepEqual(await trackOwnStock(PID, "pcs", other.deps), { ok: false, status: 409, error: STOCK_USE_OWN_BUSY_ERROR });
  const gone = own({ reread: null }, { casMatched: 0 });
  assert.deepEqual(await trackOwnStock(PID, "pcs", gone.deps), { ok: false, status: 404, error: STOCK_USE_PRODUCT_NOT_FOUND_ERROR });
});

test("own: E11000 on the upsert re-reads by ownerProductId and goes on; another error propagates", async () => {
  const race = own({}, { upsertThrows: { code: 11000 } });
  const finds: string[] = [];
  race.deps.findOwnItem = async (id) => {
    finds.push(id);
    return finds.length === 1 ? null : item(OWN, "Chips", "pcs");
  };
  const r = await trackOwnStock(PID, "pcs", race.deps);
  assert.ok(r.ok);
  assert.deepEqual(finds, [PID, PID]);
  const boom = own({}, { upsertThrows: new Error("down") });
  await assert.rejects(trackOwnStock(PID, "pcs", boom.deps), /down/);
});

test("own: an archived own item takes the restore path, gated by the cap and the name like a fresh one", async () => {
  const archived = item(OWN, "Chips", "pcs", true);
  const full = own({ own: archived }, { active: STOCK_ITEMS_MAX });
  assert.deepEqual(await trackOwnStock(PID, "pcs", full.deps), { ok: false, status: 400, error: STOCK_ITEM_LIMIT_ERROR });
  const taken = own({ own: archived }, { nameTaken: true });
  assert.deepEqual(await trackOwnStock(PID, "pcs", taken.deps), { ok: false, status: 409, error: STOCK_USE_OWN_NAME_ERROR });
  assert.deepEqual([full.writes, taken.writes], [[], []]);
  const ok = own({ own: archived });
  const r = await trackOwnStock(PID, "pcs", ok.deps);
  assert.deepEqual(ok.names, ["Chips"]);
  assert.deepEqual(ok.writes.map((w) => w.kind), ["upsert", "cas"]);
  assert.deepEqual((ok.writes[0].update as { $unset: unknown }).$unset, { archived: "" });
  assert.ok(r.ok);
});

test("own: a restored item keeps its stored name, so that name (not the menu item's) is the one checked", async () => {
  const renamed = own({ product: { name: "Chips Large" }, own: item(OWN, "Chips", "pcs", true) });
  assert.ok((await trackOwnStock(PID, "pcs", renamed.deps)).ok);
  assert.deepEqual(renamed.names, ["Chips"]);
  const fresh = own({ product: { name: "  Chips Large  " } });
  assert.ok((await trackOwnStock(PID, "pcs", fresh.deps)).ok);
  assert.deepEqual(fresh.names, ["Chips Large"]);
});
