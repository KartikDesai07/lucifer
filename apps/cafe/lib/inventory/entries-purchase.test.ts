import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { DUE_NEEDS_SUPPLIER_ERROR, PAID_OVER_TOTAL_ERROR } from "@/schemas";
import { STOCK_ITEM_NOT_FOUND_ERROR } from "./items";
import { toStockEntryDto } from "./entries-read";
import {
  ENTRY_REVERSE, STOCK_ENTRY_ALREADY_SAVED_ERROR, STOCK_ENTRY_SAVED_STOCK_OFF_ERROR, createStockEntry, deleteStockEntry,
  type NewEntryDoc, type StockEntryCommand, type StockEntryDeps, type StoredEntry,
} from "./entries-write";
import { SUPPLIER_NOT_FOUND_ERROR } from "./suppliers";

// Inventory lite Slice 5: createStockEntry for a purchase over fake ports (no DB). DB truth (raw stored values, the
// bulkWrite, the unique index, concurrent taps, the dues sum): scripts/verify-inventory-purchases-live.ts.

const MILK = "665f0000000000000000b001";
const SUGAR = "665f0000000000000000b002";
const SUPPLIER = "665f0000000000000000d001";
const USER = "665f0000000000000000a001";
const REF = "9b2f6a1e-0c43-4f1b-8a52-3d6f1c0e7a11";
const DATE = "2026-11-10";
const NEW_ID = "665f0000000000000000c001";
const NOW = new Date("2026-11-13T06:00:00.000Z");

type PurchaseCmd = Extract<StockEntryCommand, { kind: "purchase" }>;
const ident = { createdBy: "Asha", createdById: USER };
const purchase = (over: Partial<PurchaseCmd> = {}): StockEntryCommand => ({
  kind: "purchase",
  supplierId: SUPPLIER,
  date: DATE,
  lines: [
    { itemId: MILK, qtyMilli: 1500, ratePaise: 4000 },
    { itemId: SUGAR, qtyMilli: 333, ratePaise: 50 },
  ],
  paidPaise: 5000,
  clientRef: REF,
  ...ident,
  ...over,
});

const stored = (doc: NewEntryDoc, extra: Partial<StoredEntry> = {}): StoredEntry => ({
  _id: NEW_ID,
  ...doc,
  lines: doc.lines.map((l) => ({ ...l, itemId: new Types.ObjectId(l.itemId) })),
  ...(doc.supplierId ? { supplierId: new Types.ObjectId(doc.supplierId) } : {}),
  createdAt: NOW,
  ...extra,
}) as unknown as StoredEntry;

interface Fake {
  deps: StockEntryDeps;
  log: string[];
  inserts: NewEntryDoc[];
  receives: unknown[];
  moves: { lines: unknown; sign: number }[];
  cfg: { activeItems: string[]; supplier: { name: string } | null; byRef: StoredEntry | null; insertThrows: unknown; receiveThrows: boolean; casLines: NewEntryDoc["lines"] | null };
}

function fake(cfg: Partial<Fake["cfg"]> = {}): Fake {
  const log: string[] = [];
  const f: Fake = {
    log,
    inserts: [],
    receives: [],
    moves: [],
    cfg: { activeItems: [MILK, SUGAR], supplier: { name: "Sharma Dairy" }, byRef: null, insertThrows: null, receiveThrows: false, casLines: null, ...cfg },
    deps: undefined as unknown as StockEntryDeps,
  };
  const names: Record<string, { name: string; unit: "L" | "kg" }> = { [MILK]: { name: "Milk", unit: "L" }, [SUGAR]: { name: "Sugar", unit: "kg" } };
  f.deps = {
    connect: async () => {},
    findByRef: async () => {
      log.push("findByRef");
      return f.cfg.byRef;
    },
    findActiveItem: async () => null,
    findItem: async () => null,
    findActiveItems: async (ids) => {
      log.push("items");
      return new Map(ids.filter((id) => f.cfg.activeItems.includes(id)).map((id) => [id, names[id]]));
    },
    findItemInfos: async (ids) => {
      log.push("itemInfos");
      return new Map(ids.map((id) => [id, names[id]]));
    },
    findActiveSupplier: async () => {
      log.push("supplier");
      return f.cfg.supplier;
    },
    findSupplierNames: async () => new Map([[SUPPLIER, "Sharma Dairy"]]),
    insert: async (doc) => {
      log.push("insert");
      f.inserts.push(doc);
      if (f.cfg.insertThrows) throw f.cfg.insertThrows;
      return stored(doc);
    },
    move: async (lines, sign) => {
      log.push("move");
      f.moves.push({ lines, sign });
    },
    receive: async (lines) => {
      log.push("receive");
      f.receives.push(lines);
      if (f.cfg.receiveThrows) throw new Error("bulkWrite failed");
    },
    softDelete: async () => {
      log.push("softDelete");
      return f.cfg.casLines ? { lines: f.cfg.casLines } : null;
    },
  };
  return f;
}

const dup = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
const nothingWritten = (f: Fake) => assert.deepEqual([f.inserts.length, f.receives.length, f.moves.length], [0, 0, 0]);

test("purchase: reads run in order (ref, items, supplier), the row lands, THEN stock is received", async () => {
  const f = fake();
  const r = await createStockEntry(purchase({ note: "weekly" }), f.deps);
  assert.ok(r.ok && !r.replay);
  assert.deepEqual(f.log, ["findByRef", "items", "supplier", "insert", "receive"]);
});

test("purchase: the server works out the amounts, total and due (rounded once per line); due only when not 0", async () => {
  const f = fake();
  await createStockEntry(purchase({ note: "weekly" }), f.deps);
  assert.deepEqual(f.inserts[0], {
    kind: "purchase",
    date: DATE,
    lines: [
      { itemId: MILK, qty: 1500, ratePaise: 4000, amountPaise: 6000 },
      { itemId: SUGAR, qty: 333, ratePaise: 50, amountPaise: 17 },
    ],
    note: "weekly",
    supplierId: SUPPLIER,
    totalPaise: 6017,
    paidPaise: 5000,
    duePaise: 1017,
    createdBy: "Asha",
    createdById: USER,
    clientRef: REF,
    v: 1,
  });
  const full = fake();
  await createStockEntry(purchase({ paidPaise: 6017, note: "" }), full.deps);
  for (const key of ["duePaise", "note"]) assert.equal(key in full.inserts[0], false, `${key} omitted`);
  assert.equal(full.inserts[0].paidPaise, 6017);
  const none = fake();
  await createStockEntry(purchase({ supplierId: undefined, paidPaise: 6017 }), none.deps);
  assert.equal("supplierId" in none.inserts[0], false, "no supplier, no supplierId key");
  assert.deepEqual(none.log, ["findByRef", "items", "insert", "receive"], "no supplier read without a supplier");
});

test("purchase: receive gets the non-zero lines with their rates; the answer carries item and supplier names", async () => {
  const f = fake();
  const r = await createStockEntry(purchase(), f.deps);
  assert.deepEqual(f.receives, [[
    { itemId: MILK, qty: 1500, ratePaise: 4000 },
    { itemId: SUGAR, qty: 333, ratePaise: 50 },
  ]]);
  assert.equal(f.moves.length, 0, "a purchase never goes through moveStock");
  assert.ok(r.ok);
  if (!r.ok) return;
  const dto = toStockEntryDto(r.row, r.items, r.suppliers);
  assert.equal(dto.supplierName, "Sharma Dairy");
  assert.deepEqual([dto.totalPaise, dto.paidPaise, dto.duePaise], [6017, 5000, 1017]);
  assert.deepEqual(dto.lines.map((l) => [l.name, l.qtyMilli, l.ratePaise, l.amountPaise]), [["Milk", 1500, 4000, 6000], ["Sugar", 333, 50, 17]]);
});

test("purchase 400s write and move nothing: paid over total, a due without a supplier, a total over the cap", async () => {
  const over = fake();
  assert.deepEqual(await createStockEntry(purchase({ paidPaise: 6018 }), over.deps), { ok: false, status: 400, error: PAID_OVER_TOTAL_ERROR });
  nothingWritten(over);
  assert.deepEqual(over.log, ["findByRef"], "the money check comes before any item or supplier read");
  const due = fake();
  assert.deepEqual(await createStockEntry(purchase({ supplierId: undefined, paidPaise: 100 }), due.deps), { ok: false, status: 400, error: DUE_NEEDS_SUPPLIER_ERROR });
  nothingWritten(due);
  const big = fake();
  const r = await createStockEntry(purchase({ lines: [{ itemId: MILK, qtyMilli: 100_000_000, ratePaise: 50_000_000 }], paidPaise: 0 }), big.deps);
  assert.ok(!r.ok && r.status === 400);
  nothingWritten(big);
});

test("purchase: a missing or archived item among the lines is a 404 that writes nothing; so is an unknown supplier", async () => {
  const item = fake({ activeItems: [MILK] });
  assert.deepEqual(await createStockEntry(purchase(), item.deps), { ok: false, status: 404, error: STOCK_ITEM_NOT_FOUND_ERROR });
  nothingWritten(item);
  assert.deepEqual(item.log, ["findByRef", "items"], "ONE read for all the items, and no supplier read after a miss");
  const sup = fake({ supplier: null });
  assert.deepEqual(await createStockEntry(purchase(), sup.deps), { ok: false, status: 404, error: SUPPLIER_NOT_FOUND_ERROR });
  nothingWritten(sup);
});

test("purchase: a receive that throws AFTER the insert is a 500 SAVED_STOCK_OFF and the row stays (nothing reverted)", async () => {
  const f = fake({ receiveThrows: true });
  const r = await createStockEntry(purchase(), f.deps);
  assert.deepEqual(r, { ok: false, status: 500, error: STOCK_ENTRY_SAVED_STOCK_OFF_ERROR });
  assert.deepEqual(f.log.slice(-2), ["insert", "receive"]);
  assert.equal(f.log.includes("softDelete"), false, "no delete, no compensation");
});

test("purchase replay: the same sheet gets the FIRST row (200 shape) with names, and nothing is read for writing or written", async () => {
  const seed = fake();
  await createStockEntry(purchase(), seed.deps);
  const f = fake({ byRef: stored(seed.inserts[0]) });
  const r = await createStockEntry(purchase(), f.deps);
  assert.ok(r.ok && r.replay === true);
  nothingWritten(f);
  assert.equal(r.ok && r.suppliers?.get(SUPPLIER), "Sharma Dairy");
  assert.equal(r.ok && r.items.get(MILK)?.name, "Milk");
  assert.equal(f.log.includes("items"), false, "a replay does not re-validate against today's items");
});

test("purchase replay with any change, another account, or a deleted row is a 409 that writes nothing", async () => {
  const seed = fake();
  await createStockEntry(purchase({ note: "a" }), seed.deps);
  const row = stored(seed.inserts[0]);
  const cases: [string, StockEntryCommand, Partial<StoredEntry>][] = [
    ["paid", purchase({ note: "a", paidPaise: 5001 }), {}],
    ["supplier", purchase({ note: "a", supplierId: undefined, paidPaise: 6017 }), {}],
    ["qty", purchase({ note: "a", lines: [{ itemId: MILK, qtyMilli: 1501, ratePaise: 4000 }, { itemId: SUGAR, qtyMilli: 333, ratePaise: 50 }] }), {}],
    ["rate", purchase({ note: "a", lines: [{ itemId: MILK, qtyMilli: 1500, ratePaise: 4001 }, { itemId: SUGAR, qtyMilli: 333, ratePaise: 50 }] }), {}],
    ["a line less", purchase({ note: "a", lines: [{ itemId: MILK, qtyMilli: 1500, ratePaise: 4000 }], paidPaise: 0 }), {}],
    ["note", purchase({ note: "b" }), {}],
    ["date", purchase({ note: "a", date: "2026-11-09" }), {}],
    ["account", purchase({ note: "a", createdById: "665f0000000000000000a002" }), {}],
    ["kind", { kind: "waste", itemId: MILK, qtyMilli: 1, reason: "Spoiled", date: DATE, clientRef: REF, ...ident }, {}],
    ["deleted", purchase({ note: "a" }), { deletedAt: NOW }],
  ];
  for (const [label, cmd, extra] of cases) {
    const f = fake({ byRef: { ...row, ...extra } });
    assert.deepEqual(await createStockEntry(cmd, f.deps), { ok: false, status: 409, error: STOCK_ENTRY_ALREADY_SAVED_ERROR }, label);
    nothingWritten(f);
  }
});

test("purchase E11000 race: re-read by ref, then a replay that moves nothing; a vanished row rethrows", async () => {
  const seed = fake();
  await createStockEntry(purchase(), seed.deps);
  const f = fake({ insertThrows: dup });
  f.deps.findByRef = async () => (f.log.includes("insert") ? stored(seed.inserts[0]) : null);
  const r = await createStockEntry(purchase(), f.deps);
  assert.ok(r.ok && r.replay === true);
  assert.equal(f.receives.length, 0, "the loser of the race receives nothing");
  assert.equal(r.ok && r.suppliers?.get(SUPPLIER), "Sharma Dairy");
  const gone = fake({ insertThrows: dup });
  await assert.rejects(createStockEntry(purchase(), gone.deps), (e) => e === dup);
  assert.equal(gone.receives.length, 0);
});

test("purchase delete: reverses each line once with ENTRY_REVERSE; a second delete (CAS miss) is a 404 and moves nothing", async () => {
  const seed = fake();
  await createStockEntry(purchase(), seed.deps);
  const f = fake({ casLines: seed.inserts[0].lines });
  assert.deepEqual(await deleteStockEntry(NEW_ID, "Admin", NOW, f.deps), { ok: true });
  assert.deepEqual(f.moves, [{ lines: [{ itemId: MILK, qty: 1500 }, { itemId: SUGAR, qty: 333 }], sign: ENTRY_REVERSE }]);
  const again = fake({ casLines: null });
  assert.deepEqual(await deleteStockEntry(NEW_ID, "Admin", NOW, again.deps), { ok: false, status: 404, error: "Entry not found" });
  assert.equal(again.moves.length, 0);
});
