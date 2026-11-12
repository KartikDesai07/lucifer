import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import {
  STOCK_ENTRY_ALREADY_SAVED_ERROR, createStockEntry, deleteStockEntry,
  type NewEntryDoc, type StockEntryCommand, type StockEntryDeps, type StoredEntry,
} from "./entries-write";
import { sameEntry } from "./entry-replay";
import { SUPPLIER_NOT_FOUND_ERROR } from "./suppliers";

// Inventory lite Slice 6: a supplier payment over fake ports (no DB), plus the shared replay same-check for all four
// kinds. DB truth (raw int32 values, no lines key, the dues sum, the race, the archive rule):
// scripts/verify-inventory-payments-live.ts.

const MILK = "665f0000000000000000b001";
const SUPPLIER = "665f0000000000000000d001";
const OTHER_SUPPLIER = "665f0000000000000000d002";
const USER = "665f0000000000000000a001";
const OTHER_USER = "665f0000000000000000a002";
const REF = "9b2f6a1e-0c43-4f1b-8a52-3d6f1c0e7a11";
const DATE = "2026-11-10";
const NEW_ID = "665f0000000000000000c001";
const NOW = new Date("2026-11-13T06:00:00.000Z");
const AMOUNT = 40000;

type PaymentCmd = Extract<StockEntryCommand, { kind: "payment" }>;
const ident = { createdBy: "Asha", createdById: USER };
const payment = (over: Partial<PaymentCmd> = {}): StockEntryCommand => ({
  kind: "payment", supplierId: SUPPLIER, amountPaise: AMOUNT, date: DATE, clientRef: REF, ...ident, ...over,
});

const stored = (doc: NewEntryDoc, extra: Partial<StoredEntry> = {}): StoredEntry => ({
  _id: NEW_ID,
  ...doc,
  ...(doc.lines ? { lines: doc.lines.map((l) => ({ ...l, itemId: new Types.ObjectId(l.itemId) })) } : {}),
  ...(doc.supplierId ? { supplierId: new Types.ObjectId(doc.supplierId) } : {}),
  createdAt: NOW,
  ...extra,
}) as unknown as StoredEntry;

interface Fake {
  deps: StockEntryDeps;
  log: string[];
  inserts: NewEntryDoc[];
  receives: unknown[];
  moves: unknown[];
  supplierReads: string[];
  nameReads: (readonly string[])[];
  cfg: { supplier: { name: string } | null; byRef: StoredEntry | null; insertThrows: unknown };
}

function fake(cfg: Partial<Fake["cfg"]> = {}): Fake {
  const log: string[] = [];
  const f: Fake = {
    log, inserts: [], receives: [], moves: [], supplierReads: [], nameReads: [],
    cfg: { supplier: { name: "Sharma Dairy" }, byRef: null, insertThrows: null, ...cfg },
    deps: undefined as unknown as StockEntryDeps,
  };
  f.deps = {
    connect: async () => {},
    findByRef: async () => {
      log.push("findByRef");
      return f.cfg.byRef;
    },
    findActiveItem: async () => null,
    findItem: async () => null,
    findActiveItems: async () => new Map(),
    findItemInfos: async () => new Map(),
    findActiveSupplier: async (id) => {
      log.push("supplier");
      f.supplierReads.push(id);
      return f.cfg.supplier;
    },
    findSupplierNames: async (ids) => {
      log.push("names");
      f.nameReads.push(ids);
      return new Map([[SUPPLIER, "Sharma Dairy"]]);
    },
    insert: async (doc) => {
      log.push("insert");
      f.inserts.push(doc);
      if (f.cfg.insertThrows) throw f.cfg.insertThrows;
      return stored(doc);
    },
    move: async (lines) => {
      log.push("move");
      f.moves.push(lines);
    },
    receive: async (lines) => {
      log.push("receive");
      f.receives.push(lines);
    },
    softDelete: async () => {
      log.push("softDelete");
      return {};
    },
  };
  return f;
}

const dup = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
const nothingWritten = (f: Fake) => assert.deepEqual([f.inserts.length, f.receives.length, f.moves.length], [0, 0, 0]);
const conflict = { ok: false, status: 409, error: STOCK_ENTRY_ALREADY_SAVED_ERROR };

test("payment create: the supplier is read first, the row is EXACTLY the payment shape, nothing moves", async () => {
  const f = fake();
  const r = await createStockEntry(payment({ note: "cash" }), f.deps);
  assert.deepEqual(f.supplierReads, [SUPPLIER]);
  assert.deepEqual(f.log, ["findByRef", "supplier", "insert"], "no item read, no move, no receive");
  assert.deepEqual(f.inserts[0], {
    kind: "payment", date: DATE, note: "cash", supplierId: SUPPLIER, totalPaise: AMOUNT, duePaise: -AMOUNT,
    createdBy: "Asha", createdById: USER, clientRef: REF, v: 1,
  });
  assert.equal("lines" in f.inserts[0], false, "no lines key at all");
  assert.equal("paidPaise" in f.inserts[0], false, "no paidPaise key");
  assert.deepEqual([f.receives.length, f.moves.length], [0, 0]);
  assert.ok(r.ok && !r.replay);
  if (!r.ok) return;
  assert.equal(r.suppliers?.get(SUPPLIER), "Sharma Dairy");
  assert.equal(r.items.size, 0);
  const bare = fake();
  await createStockEntry(payment({ note: "" }), bare.deps);
  assert.equal("note" in bare.inserts[0], false, "an empty note is no note");
});

test("payment create: an archived or unknown supplier is a 404 and nothing is inserted", async () => {
  const f = fake({ supplier: null });
  assert.deepEqual(await createStockEntry(payment(), f.deps), { ok: false, status: 404, error: SUPPLIER_NOT_FOUND_ERROR });
  nothingWritten(f);
  assert.deepEqual(f.log, ["findByRef", "supplier"]);
});

test("payment create: paying more than is owed is stored as typed (the writer never reads dues)", async () => {
  const f = fake();
  const r = await createStockEntry(payment({ amountPaise: 99_999_900 }), f.deps);
  assert.ok(r.ok);
  assert.equal(f.inserts[0].totalPaise, 99_999_900);
  assert.equal(f.inserts[0].duePaise, -99_999_900);
});

test("payment replay: the same payment gets the FIRST row (names read for the supplier), and nothing is written", async () => {
  const seed = fake();
  await createStockEntry(payment({ note: "cash" }), seed.deps);
  const f = fake({ byRef: stored(seed.inserts[0]) });
  const r = await createStockEntry(payment({ note: "cash" }), f.deps);
  assert.ok(r.ok && r.replay === true);
  nothingWritten(f);
  assert.deepEqual(f.nameReads, [[SUPPLIER]]);
  assert.equal(f.supplierReads.length, 0, "a replay does not re-check the supplier is still active");
  assert.equal(r.ok && r.suppliers?.get(SUPPLIER), "Sharma Dairy");
});

test("payment replay with any change, another account, a deleted row or another kind is a 409 that writes nothing", async () => {
  const seed = fake();
  await createStockEntry(payment({ note: "cash" }), seed.deps);
  const row = stored(seed.inserts[0]);
  const cases: [string, StockEntryCommand, Partial<StoredEntry>][] = [
    ["amount", payment({ note: "cash", amountPaise: AMOUNT + 1 }), {}],
    ["supplier", payment({ note: "cash", supplierId: OTHER_SUPPLIER }), {}],
    ["date", payment({ note: "cash", date: "2026-11-09" }), {}],
    ["note", payment({ note: "card" }), {}],
    ["account", payment({ note: "cash", createdById: OTHER_USER }), {}],
    ["deleted", payment({ note: "cash" }), { deletedAt: NOW }],
    ["stored kind", payment({ note: "cash" }), { kind: "purchase" }],
  ];
  for (const [label, cmd, extra] of cases) {
    const f = fake({ byRef: { ...row, ...extra } });
    assert.deepEqual(await createStockEntry(cmd, f.deps), conflict, label);
    nothingWritten(f);
  }
});

test("payment E11000 race: the loser re-reads by ref and replays the same payment; a different one is 409; a vanished row rethrows", async () => {
  const seed = fake();
  await createStockEntry(payment(), seed.deps);
  const same = fake({ insertThrows: dup });
  same.deps.findByRef = async () => (same.log.includes("insert") ? stored(seed.inserts[0]) : null);
  const r = await createStockEntry(payment(), same.deps);
  assert.ok(r.ok && r.replay === true);
  assert.equal(r.ok && r.suppliers?.get(SUPPLIER), "Sharma Dairy");
  const other = fake({ insertThrows: dup });
  other.deps.findByRef = async () => (other.log.includes("insert") ? stored(seed.inserts[0]) : null);
  assert.deepEqual(await createStockEntry(payment({ amountPaise: AMOUNT + 5 }), other.deps), conflict);
  const gone = fake({ insertThrows: dup });
  await assert.rejects(createStockEntry(payment(), gone.deps), (e) => e === dup);
});

test("payment delete: the row has no lines, so the delete is ok and moves no stock", async () => {
  const f = fake();
  f.deps.softDelete = async () => ({});
  assert.deepEqual(await deleteStockEntry(NEW_ID, "Admin", NOW, f.deps), { ok: true });
  assert.equal(f.moves.length, 0);
  const miss = fake();
  miss.deps.softDelete = async () => null;
  assert.deepEqual(await deleteStockEntry(NEW_ID, "Admin", NOW, miss.deps), { ok: false, status: 404, error: "Entry not found" });
});

// sameEntry: the extraction of the old replayOf same-check keeps waste / count / purchase semantics.
const base = { date: DATE, createdBy: "Asha", createdById: USER, clientRef: REF, v: 1 };
const oid = (hex: string) => new Types.ObjectId(hex);
const wasteRow = { ...base, kind: "waste", reason: "Spoiled", lines: [{ itemId: oid(MILK), qty: -500 }] } as unknown as StoredEntry;
const countRow = { ...base, kind: "count", lines: [{ itemId: oid(MILK), qty: 200, counted: 1200 }] } as unknown as StoredEntry;
const purchaseRow = {
  ...base, kind: "purchase", supplierId: oid(SUPPLIER), paidPaise: 100, totalPaise: 600, duePaise: 500,
  lines: [{ itemId: oid(MILK), qty: 1500, ratePaise: 400, amountPaise: 600 }],
} as unknown as StoredEntry;
const paymentRow = { ...base, kind: "payment", supplierId: oid(SUPPLIER), totalPaise: AMOUNT, duePaise: -AMOUNT } as unknown as StoredEntry;

const w = (over: object = {}) => ({ kind: "waste", itemId: MILK, qtyMilli: 500, reason: "Spoiled", date: DATE, clientRef: REF, createdById: USER, ...over }) as Parameters<typeof sameEntry>[1];
const c = (over: object = {}) => ({ kind: "count", itemId: MILK, countedMilli: 1200, date: DATE, clientRef: REF, createdById: USER, ...over }) as Parameters<typeof sameEntry>[1];
const p = (over: object = {}) => ({
  kind: "purchase", supplierId: SUPPLIER, paidPaise: 100, lines: [{ itemId: MILK, qtyMilli: 1500, ratePaise: 400 }], date: DATE, clientRef: REF, createdById: USER, ...over,
}) as Parameters<typeof sameEntry>[1];
const pay = (over: object = {}) => ({ kind: "payment", supplierId: SUPPLIER, amountPaise: AMOUNT, date: DATE, clientRef: REF, createdById: USER, ...over }) as Parameters<typeof sameEntry>[1];

test("sameEntry table: every kind is true for itself and false for each single change", () => {
  const table: [string, StoredEntry, Parameters<typeof sameEntry>[1], boolean][] = [
    ["waste same", wasteRow, w(), true],
    ["waste other reason", wasteRow, w({ reason: "Expired" }), false],
    ["waste other qty", wasteRow, w({ qtyMilli: 501 }), false],
    ["waste other item", wasteRow, w({ itemId: "665f0000000000000000b002" }), false],
    ["waste missing lines", { ...wasteRow, lines: undefined } as StoredEntry, w(), false],
    ["count same", countRow, c(), true],
    ["count other counted", countRow, c({ countedMilli: 1201 }), false],
    ["count other item", countRow, c({ itemId: "665f0000000000000000b002" }), false],
    ["count missing lines", { ...countRow, lines: [] } as unknown as StoredEntry, c(), false],
    ["purchase same", purchaseRow, p(), true],
    ["purchase other paid", purchaseRow, p({ paidPaise: 101 }), false],
    ["purchase other rate", purchaseRow, p({ lines: [{ itemId: MILK, qtyMilli: 1500, ratePaise: 401 }] }), false],
    ["purchase other order/lines", purchaseRow, p({ lines: [{ itemId: MILK, qtyMilli: 1500, ratePaise: 400 }, { itemId: MILK, qtyMilli: 1, ratePaise: 1 }] }), false],
    ["purchase other supplier", purchaseRow, p({ supplierId: OTHER_SUPPLIER }), false],
    ["payment same", paymentRow, pay(), true],
    ["payment other amount", paymentRow, pay({ amountPaise: AMOUNT - 1 }), false],
    ["payment other supplier", paymentRow, pay({ supplierId: OTHER_SUPPLIER }), false],
    ["payment note differs", paymentRow, pay({ note: "x" }), false],
    ["common: other account", wasteRow, w({ createdById: OTHER_USER }), false],
    ["common: other date", countRow, c({ date: "2026-11-09" }), false],
    ["common: deleted row", { ...purchaseRow, deletedAt: NOW } as StoredEntry, p(), false],
    ["common: other kind under the ref", wasteRow, c(), false],
  ];
  assert.ok(table.some(([, , , want]) => want) && table.some(([, , , want]) => !want), "landmark: both verdicts are exercised");
  for (const [label, row, cmd, want] of table) assert.equal(sameEntry(row, cmd), want, label);
});
