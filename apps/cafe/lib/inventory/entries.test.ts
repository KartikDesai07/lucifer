import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { STOCK_ENTRY_BACKDATE_MAX_DAYS } from "@pos/shared/inventory";
import { addDays } from "@/lib/dashboard/range";
import { cafeDateString } from "@/lib/utils";
import { STOCK_ITEM_NOT_FOUND_ERROR } from "./items";
import { STOCK_ENTRY_FUTURE_DATE_ERROR, STOCK_ENTRY_OLD_DATE_ERROR, entryCursorFilter, entryCursorOf, stockEntryDateError, toStockEntryDto } from "./entries-read";
import {
  ENTRY_APPLY, ENTRY_REVERSE, STOCK_ENTRY_ALREADY_SAVED_ERROR, STOCK_ENTRY_DELETED_STOCK_OFF_ERROR, STOCK_ENTRY_NOT_FOUND_ERROR,
  STOCK_ENTRY_SAVED_STOCK_OFF_ERROR, createStockEntry, deleteStockEntry,
  type NewEntryDoc, type StockEntryCommand, type StockEntryDeps, type StoredEntry,
} from "./entries-write";

// Inventory lite Slice 4: wastage / count / delete logic over fake ports (no DB). DB truth (raw stored values, the
// unique index, concurrent taps, paging): scripts/verify-inventory-entries-live.ts.

const MILK = "665f0000000000000000b001";
const SUGAR = "665f0000000000000000b002";
const USER = "665f0000000000000000a001";
const OTHER_USER = "665f0000000000000000a002";
const REF = "9b2f6a1e-0c43-4f1b-8a52-3d6f1c0e7a11";
const DATE = "2026-11-10";
const NEW_ID = "665f0000000000000000c001";
const NOW = new Date("2026-11-13T06:00:00.000Z");

type WasteCmd = Extract<StockEntryCommand, { kind: "waste" }>; type CountCmd = Extract<StockEntryCommand, { kind: "count" }>;
const ident = { createdBy: "Asha", createdById: USER };
const waste = (over: Partial<WasteCmd> = {}): StockEntryCommand => ({ kind: "waste", itemId: MILK, qtyMilli: 500, reason: "Spoiled", date: DATE, clientRef: REF, ...ident, ...over });
const count = (over: Partial<CountCmd> = {}): StockEntryCommand => ({ kind: "count", itemId: MILK, countedMilli: 4250, date: DATE, clientRef: REF, ...ident, ...over });

const stored = (doc: NewEntryDoc, extra: Partial<StoredEntry> = {}): StoredEntry => ({
  _id: NEW_ID,
  ...doc,
  lines: doc.lines.map((l) => ({ itemId: new Types.ObjectId(l.itemId), qty: l.qty, ...(l.counted !== undefined ? { counted: l.counted } : {}) })),
  createdAt: NOW,
  ...extra,
});

interface Fake {
  deps: StockEntryDeps;
  log: string[];
  moves: { lines: unknown; sign: number }[];
  inserts: NewEntryDoc[];
  cfg: {
    item: { name: string; unit: "L"; qty?: number } | null;
    byRef: StoredEntry | null;
    insertThrows: unknown;
    moveThrows: boolean;
    casLines: { itemId: string; qty: number; counted?: number }[] | null;
  };
}

function fake(cfg: Partial<Fake["cfg"]> = {}): Fake {
  const log: string[] = [];
  const f: Fake = {
    log,
    moves: [],
    inserts: [],
    cfg: { item: { name: "Milk", unit: "L", qty: 3000 }, byRef: null, insertThrows: null, moveThrows: false, casLines: null, ...cfg },
    deps: undefined as unknown as StockEntryDeps,
  };
  f.deps = {
    connect: async () => {},
    findByRef: async () => {
      log.push("findByRef");
      return f.cfg.byRef;
    },
    findActiveItem: async () => {
      log.push("read");
      return f.cfg.item ? { ...f.cfg.item } : null;
    },
    findItem: async () => (f.cfg.item ? { name: f.cfg.item.name, unit: f.cfg.item.unit } : null),
    insert: async (doc) => {
      log.push("insert");
      f.inserts.push(doc);
      if (f.cfg.insertThrows) throw f.cfg.insertThrows;
      return stored(doc);
    },
    move: async (lines, sign) => {
      log.push("move");
      f.moves.push({ lines, sign });
      if (f.cfg.moveThrows) throw new Error("bulkWrite failed");
    },
    softDelete: async () => {
      log.push("softDelete");
      return f.cfg.casLines ? { lines: f.cfg.casLines } : null;
    },
  };
  return f;
}

const dup = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
const lineOf = (doc: NewEntryDoc) => doc.lines[0];
test("waste: inserts the signed line, THEN moves stock with ENTRY_APPLY", async () => {
  const f = fake();
  const r = await createStockEntry(waste({ note: "dropped" }), f.deps);
  assert.ok(r.ok && !r.replay);
  assert.deepEqual(f.inserts[0].lines, [{ itemId: MILK, qty: -500 }]);
  assert.equal(f.inserts[0].reason, "Spoiled");
  assert.equal(f.inserts[0].note, "dropped");
  assert.equal(f.inserts[0].createdById, USER);
  assert.ok(f.log.indexOf("insert") < f.log.indexOf("move"), "insert before move");
  assert.deepEqual(f.moves, [{ lines: [{ itemId: MILK, qty: -500 }], sign: ENTRY_APPLY }]);
  assert.equal(r.ok && r.items.get(MILK)?.name, "Milk");
});

test("waste: an empty note is no note key", async () => {
  const f = fake();
  await createStockEntry(waste({ note: "" }), f.deps);
  assert.equal("note" in f.inserts[0], false);
});

test("waste on a missing or archived item: 404, nothing inserted or moved", async () => {
  const f = fake({ item: null });
  const r = await createStockEntry(waste(), f.deps);
  assert.deepEqual(r, { ok: false, status: 404, error: STOCK_ITEM_NOT_FOUND_ERROR });
  assert.deepEqual([f.inserts.length, f.moves.length], [0, 0]);
});

test("count: records the change (3000 to 4250 is +1250, counted 4250), THEN moves stock by exactly it", async () => {
  const f = fake();
  const r = await createStockEntry(count(), f.deps);
  assert.ok(r.ok);
  assert.deepEqual(f.inserts[0].lines, [{ itemId: MILK, qty: 1250, counted: 4250 }]);
  assert.deepEqual(f.moves, [{ lines: [{ itemId: MILK, qty: 1250 }], sign: ENTRY_APPLY }]);
  assert.deepEqual(f.log, ["findByRef", "read", "insert", "move"], "the row lands before stock moves");
  assert.equal("reason" in f.inserts[0], false);
});

test("count (review s116): a failed insert moves nothing, so the retry after a sale applies the count once", async () => {
  const boom = new Error("network");
  const first = fake({ insertThrows: boom });
  await assert.rejects(createStockEntry(count(), first.deps), (e) => e === boom);
  assert.equal(first.moves.length, 0, "no stock write before the row landed");
  // A sale took 1000 meanwhile: the retry reads 2000 and brings the stock to 4250 with ONE move of +2250.
  const retry = fake({ item: { name: "Milk", unit: "L", qty: 2000 } });
  await createStockEntry(count(), retry.deps);
  assert.deepEqual(retry.moves, [{ lines: [{ itemId: MILK, qty: 2250 }], sign: ENTRY_APPLY }]);
  assert.equal(lineOf(retry.inserts[0]).qty, 2250, "the row records exactly what moved");
});

test("count: a before-image without qty is 0; a no-change count records 0 and moves nothing", async () => {
  const noQty = fake({ item: { name: "Milk", unit: "L" } });
  await createStockEntry(count(), noQty.deps);
  assert.equal(lineOf(noQty.inserts[0]).qty, 4250);
  const same = fake({ item: { name: "Milk", unit: "L", qty: 4250 } });
  await createStockEntry(count(), same.deps);
  assert.equal(lineOf(same.inserts[0]).qty, 0);
  assert.equal(same.moves.length, 0);
});

test("count on a missing or archived item: 404, nothing inserted", async () => {
  const f = fake({ item: null });
  const r = await createStockEntry(count(), f.deps);
  assert.deepEqual(r, { ok: false, status: 404, error: STOCK_ITEM_NOT_FOUND_ERROR });
  assert.deepEqual([f.inserts.length, f.moves.length], [0, 0]);
});

test("replay (same ref, same entry): replay:true and NOTHING is set, inserted or moved", async () => {
  const wDoc = fake();
  await createStockEntry(waste(), wDoc.deps);
  const w = fake({ byRef: stored(wDoc.inserts[0]) });
  const rw = await createStockEntry(waste(), w.deps);
  assert.ok(rw.ok && rw.replay === true);
  assert.deepEqual([w.inserts.length, w.moves.length], [0, 0]);

  const cDoc = fake();
  await createStockEntry(count(), cDoc.deps);
  const c = fake({ byRef: stored(cDoc.inserts[0]) });
  const rc = await createStockEntry(count(), c.deps);
  assert.ok(rc.ok && rc.replay === true);
  assert.deepEqual([c.inserts.length, c.moves.length], [0, 0], "a replayed count never moves the stock again");
});

test("replay with a different qty / reason / note / account / date / item / kind or a deleted row: 409", async () => {
  const base = fake();
  await createStockEntry(waste({ note: "a" }), base.deps);
  const row = stored(base.inserts[0]);
  const cases: [string, StockEntryCommand, Partial<StoredEntry>][] = [
    ["qty", waste({ note: "a", qtyMilli: 501 }), {}],
    ["reason", waste({ note: "a", reason: "Other" }), {}],
    ["note", waste({ note: "b" }), {}],
    ["no note", waste(), {}],
    ["account", waste({ note: "a", createdById: OTHER_USER }), {}],
    ["date", waste({ note: "a", date: "2026-11-09" }), {}],
    ["item", waste({ note: "a", itemId: SUGAR }), {}],
    ["kind", count({ note: "a" }), {}],
    ["deleted", waste({ note: "a" }), { deletedAt: NOW }],
  ];
  for (const [label, cmd, extra] of cases) {
    const f = fake({ byRef: { ...row, ...extra } });
    const r = await createStockEntry(cmd, f.deps);
    assert.deepEqual(r, { ok: false, status: 409, error: STOCK_ENTRY_ALREADY_SAVED_ERROR }, label);
    assert.deepEqual([f.inserts.length, f.moves.length], [0, 0], label);
  }
  const cBase = fake();
  await createStockEntry(count(), cBase.deps);
  const cf = fake({ byRef: stored(cBase.inserts[0]) });
  const rc = await createStockEntry(count({ countedMilli: 4251 }), cf.deps);
  assert.equal(rc.ok, false, "a count replay with another counted amount is a 409");
});

test("E11000 on insert: re-read by ref, then a replay (no move); a vanished row rethrows", async () => {
  const seed = fake();
  await createStockEntry(waste(), seed.deps);
  const f = fake({ insertThrows: dup });
  f.deps.findByRef = async () => (f.log.includes("insert") ? stored(seed.inserts[0]) : null);
  const r = await createStockEntry(waste(), f.deps);
  assert.ok(r.ok && r.replay === true);
  assert.equal(f.moves.length, 0, "the loser of the race moves nothing");

  const gone = fake({ insertThrows: dup });
  await assert.rejects(createStockEntry(waste(), gone.deps), (e) => e === dup);

  const countRace = fake({ insertThrows: dup });
  const cSeed = fake();
  await createStockEntry(count(), cSeed.deps);
  countRace.deps.findByRef = async () => (countRace.log.includes("insert") ? stored(cSeed.inserts[0]) : null);
  const rc = await createStockEntry(count(), countRace.deps);
  assert.ok(rc.ok && rc.replay === true);
  assert.equal(countRace.moves.length, 0, "the loser of a count race moves nothing either");
});

test("waste: a move that throws AFTER the insert is a 500 SAVED_STOCK_OFF and nothing is reverted", async () => {
  const f = fake({ moveThrows: true });
  const r = await createStockEntry(waste(), f.deps);
  assert.deepEqual(r, { ok: false, status: 500, error: STOCK_ENTRY_SAVED_STOCK_OFF_ERROR });
  assert.deepEqual(f.log.filter((l) => l !== "findByRef" && l !== "read"), ["insert", "move"], "no delete, no second move");
});

test("delete: a CAS miss is a 404 and moves nothing", async () => {
  const f = fake({ casLines: null });
  const r = await deleteStockEntry(NEW_ID, "Admin", NOW, f.deps);
  assert.deepEqual(r, { ok: false, status: 404, error: STOCK_ENTRY_NOT_FOUND_ERROR });
  assert.equal(f.moves.length, 0);
});

test("delete: a CAS win reverses each nonzero line once with ENTRY_REVERSE; zero lines are skipped", async () => {
  const f = fake({ casLines: [{ itemId: MILK, qty: -500 }, { itemId: SUGAR, qty: 0, counted: 3 }] });
  const r = await deleteStockEntry(NEW_ID, "Admin", NOW, f.deps);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(f.moves, [{ lines: [{ itemId: MILK, qty: -500 }], sign: ENTRY_REVERSE }]);
  const none = fake({ casLines: [{ itemId: MILK, qty: 0, counted: 4250 }] });
  assert.deepEqual(await deleteStockEntry(NEW_ID, "Admin", NOW, none.deps), { ok: true });
  assert.equal(none.moves.length, 0, "nothing to move: no call at all");
  assert.equal(ENTRY_APPLY, -ENTRY_REVERSE);
});

test("delete: a reversal that throws is a 500 DELETED_STOCK_OFF (the delete stays)", async () => {
  const f = fake({ casLines: [{ itemId: MILK, qty: -500 }], moveThrows: true });
  const r = await deleteStockEntry(NEW_ID, "Admin", NOW, f.deps);
  assert.deepEqual(r, { ok: false, status: 500, error: STOCK_ENTRY_DELETED_STOCK_OFF_ERROR });
});

test("stockEntryDateError: today ok, the 31-days-back edge ok, 32 back refused, tomorrow refused", () => {
  const today = cafeDateString(NOW);
  assert.equal(stockEntryDateError(today, NOW), null);
  assert.equal(stockEntryDateError(addDays(today, -STOCK_ENTRY_BACKDATE_MAX_DAYS), NOW), null);
  assert.equal(stockEntryDateError(addDays(today, -STOCK_ENTRY_BACKDATE_MAX_DAYS - 1), NOW), STOCK_ENTRY_OLD_DATE_ERROR);
  assert.equal(stockEntryDateError(addDays(today, 1), NOW), STOCK_ENTRY_FUTURE_DATE_ERROR);
});

test("cursor: entryCursorOf is date_id; entryCursorFilter is {} or the strictly-older $or", () => {
  assert.equal(entryCursorOf({ date: DATE, _id: new Types.ObjectId(NEW_ID) }), `${DATE}_${NEW_ID}`);
  assert.deepEqual(entryCursorFilter(), {});
  const filter = entryCursorFilter(`${DATE}_${NEW_ID}`);
  assert.equal(filter.$or?.length, 2);
  assert.deepEqual(filter.$or?.[0], { date: { $lt: DATE } });
  const second = filter.$or?.[1] as { date: string; _id: { $lt: Types.ObjectId } };
  assert.equal(second.date, DATE);
  assert.ok(second._id.$lt instanceof Types.ObjectId && second._id.$lt.toHexString() === NEW_ID);
});

test("toStockEntryDto: unknown-item lines left out, order kept, no internal keys", () => {
  const known = new Map([[MILK, { name: "Milk", unit: "L" as const }]]);
  const row = {
    ...stored({ kind: "count", date: DATE, lines: [], createdBy: "Asha", createdById: USER, clientRef: REF, v: 1, note: "n" }),
    lines: [
      { itemId: new Types.ObjectId("665f0000000000000000b009"), qty: 5 },
      { itemId: new Types.ObjectId(MILK), qty: 1250, counted: 4250 },
    ],
    supplierId: "x",
    totalPaise: 1,
  } as unknown as StoredEntry;
  const dto = toStockEntryDto(row, known);
  assert.deepEqual(dto.lines, [{ itemId: MILK, name: "Milk", unit: "L", qtyMilli: 1250, countedMilli: 4250 }]);
  assert.equal(dto.note, "n");
  assert.equal(dto.createdAt, NOW.toISOString());
  assert.equal("reason" in dto, false);
  for (const key of ["clientRef", "createdById", "v", "deletedAt", "deletedBy", "supplierId", "totalPaise", "duePaise"]) {
    assert.equal(key in dto, false, key);
  }
  const w = toStockEntryDto(
    stored({ kind: "waste", date: DATE, lines: [{ itemId: MILK, qty: -500 }], reason: "Spoiled", createdBy: "A", createdById: USER, clientRef: REF, v: 1 }),
    known,
  );
  assert.equal(w.reason, "Spoiled");
  assert.equal("countedMilli" in w.lines[0], false);
  assert.equal("note" in w, false);
});
