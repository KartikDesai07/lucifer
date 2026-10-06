import { test } from "node:test";
import assert from "node:assert/strict";

import {
  billFirstPrintFresh,
  firstBillPrintFilter,
  firstBillPrintInsertFields,
  stampFirstBillPrint,
  withFirstBillPrint,
  type BillFirstPrintDeps,
} from "@/lib/bill-first-print";
import { ID, NOW_MS, OTHER, STORED, TOTAL, fakeDb, type Doc } from "./bill-first-print.fixtures";

// Print customization S3b (Amendment A4 + A5): the bill's first print is stored on the order (billFirstPrintedAt,
// with the total it was made for: billFirstPrintedTotal), so the pay QR's "Valid till" is the same on every reprint
// of the SAME total, and a bill whose total changed starts a new window. DB-free: the order is a fake document that
// applies the REAL firstBillPrintFilter (so a filter that stops guarding something changes what the fake does); the
// REAL stamping / payload logic runs over it. The three routes that call it are pinned by their source, each with a
// positive landmark so a pin can never go vacuous.

// ── stampFirstBillPrint ──────────────────────────────────────────────────────

test("stampFirstBillPrint: a first print stamps NOW with the total it read; the CAS filter says 'no stamp yet' for that total", async () => {
  const { deps, calls, doc } = fakeDb({ total: TOTAL });
  const at = await stampFirstBillPrint(ID, NOW_MS, deps);
  assert.equal(at?.getTime(), NOW_MS);
  assert.equal(calls.cas.length, 1);
  assert.deepEqual(firstBillPrintFilter(ID, calls.cas[0].seen), { _id: ID, status: { $ne: "Cancelled" }, total: TOTAL, billFirstPrintedAt: { $exists: false } });
  assert.equal(doc?.billFirstPrintedTotal, TOTAL, "the stamp records the total it was made for");
  assert.equal(calls.read.length, 1, "a hit needs no second read");
});

test("stampFirstBillPrint: a reprint of the SAME total returns the stored stamp with zero CAS calls", async () => {
  const { deps, calls } = fakeDb({ total: TOTAL, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL });
  const at = await stampFirstBillPrint(ID, NOW_MS, deps);
  assert.equal(at?.getTime(), STORED.getTime(), "the stored time, not now");
  assert.notEqual(at?.getTime(), NOW_MS);
  assert.deepEqual([calls.read.length, calls.cas.length], [1, 0]);
});

test("stampFirstBillPrint: a total that changed since the stamp is a NEW bill - new stamp, CAS on the OLD stamp and the CURRENT total", async () => {
  const { deps, calls, doc } = fakeDb({ total: 300, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL });
  const at = await stampFirstBillPrint(ID, NOW_MS, deps);
  assert.equal(at?.getTime(), NOW_MS, "a new window starts now");
  assert.equal(calls.cas.length, 1, "landmark: it did write");
  const filter = firstBillPrintFilter(ID, calls.cas[0].seen);
  assert.equal(filter.total, 300, "the filter carries the current total");
  assert.equal((filter.billFirstPrintedAt as Date).getTime(), STORED.getTime(), "and the OLD stamp, so a racing re-stamp loses");
  assert.deepEqual([doc?.billFirstPrintedAt?.getTime(), doc?.billFirstPrintedTotal], [NOW_MS, 300], "the document now holds the new stamp and the new total");
  // Reprinting the new total keeps the new stamp.
  const again = await stampFirstBillPrint(ID, NOW_MS + 60_000, deps);
  assert.equal(again?.getTime(), NOW_MS);
  assert.equal(calls.cas.length, 1, "no second write");
});

test("stampFirstBillPrint: a legacy stamp with no stored total restamps (it cannot be proven to be this total)", async () => {
  const { deps, calls } = fakeDb({ total: TOTAL, billFirstPrintedAt: STORED });
  const at = await stampFirstBillPrint(ID, NOW_MS, deps);
  assert.equal(at?.getTime(), NOW_MS);
  assert.equal(calls.cas.length, 1);
  assert.equal(calls.cas[0].seen.billFirstPrintedTotal, undefined, "landmark: the read really had no total");
  assert.equal(firstBillPrintFilter(ID, calls.cas[0].seen).billFirstPrintedAt, STORED, "the legacy stamp is the one guarded");
});

test("stampFirstBillPrint: a CAS miss to another writer's stamp of the same bill is adopted (the first stamp wins)", async () => {
  const { deps, calls } = fakeDb({ total: TOTAL }, (d) => { d.billFirstPrintedAt = OTHER; d.billFirstPrintedTotal = TOTAL; });
  const at = await stampFirstBillPrint(ID, NOW_MS, deps);
  assert.equal(at?.getTime(), OTHER.getTime(), "THEIR value, not now");
  assert.equal(calls.read.length, 2, "landmark: the CAS missed and the convergence read ran");
});

test("stampFirstBillPrint: a CAS miss where the total moved again is null - the re-read stamp is not this bill's", async () => {
  const { deps, calls } = fakeDb({ total: TOTAL }, (d) => { d.total = 999; });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, deps), null);
  assert.equal(calls.read.length, 2, "landmark: the re-read ran and found an unstamped 999 bill");
  // A stale stamp under a moved total is not adopted either.
  const stale = fakeDb({ total: TOTAL, billFirstPrintedAt: STORED, billFirstPrintedTotal: 100 }, (d) => { d.total = 999; });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, stale.deps), null);
});

test("stampFirstBillPrint: a CAS miss on an order cancelled in between is null", async () => {
  const { deps, calls } = fakeDb({ total: TOTAL }, (d) => { d.cancelled = true; });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, deps), null);
  assert.equal(calls.read.length, 2, "landmark: the re-read ran, so null is a verdict");
});

test("stampFirstBillPrint: a cancelled or missing order (readBill null) is null with no CAS", async () => {
  for (const start of [null, { total: TOTAL, cancelled: true }]) {
    const { deps, calls } = fakeDb(start);
    assert.equal(await stampFirstBillPrint(ID, NOW_MS, deps), null);
    assert.deepEqual([calls.read.length, calls.cas.length], [1, 0]);
  }
});

test("stampFirstBillPrint: a throwing readBill (first or second) or a throwing casStamp is null, never an error", async () => {
  const readBoom: BillFirstPrintDeps = { readBill: async () => { throw new Error("db down"); }, casStamp: async () => null };
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, readBoom), null);
  const casBoom = fakeDb({ total: TOTAL });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, { ...casBoom.deps, casStamp: async () => { throw new Error("db down"); } }), null);
  assert.equal(casBoom.calls.read.length, 1, "landmark: the read ran before the CAS threw");
  // The convergence re-read throwing: the first read works, the CAS misses, the second read throws.
  let reads = 0;
  const second: BillFirstPrintDeps = {
    readBill: async () => { if (++reads > 1) throw new Error("db down"); return { total: TOTAL }; },
    casStamp: async () => null,
  };
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, second), null);
  assert.equal(reads, 2, "landmark: the second read was reached");
});

test("stampFirstBillPrint: an invalid ObjectId is null with zero deps calls (a valid one does call them)", async () => {
  const { deps, calls } = fakeDb({ total: TOTAL });
  for (const bad of ["", "nope", "64b7f0c2a1d2e3f4a5b6c7d", "64b7f0c2a1d2e3f4a5b6c7dz"]) {
    assert.equal(await stampFirstBillPrint(bad, NOW_MS, deps), null, JSON.stringify(bad));
  }
  assert.deepEqual([calls.read.length, calls.cas.length], [0, 0]);
  assert.ok(await stampFirstBillPrint(ID, NOW_MS, deps), "landmark: a valid id stamps");
  assert.equal(calls.read.length, 1);
});

// ── printedTotal: the total on the slip being printed (a stale view) ─────────

test("stampFirstBillPrint: a slip whose total is the one the stored stamp was made for gets that stamp, with no write, even after the order grew", async () => {
  const { deps, calls } = fakeDb({ total: 700, billFirstPrintedAt: STORED, billFirstPrintedTotal: 500 });
  const at = await stampFirstBillPrint(ID, NOW_MS, deps, 500);
  assert.equal(at?.getTime(), STORED.getTime(), "T1, the stamp made for 500");
  assert.equal(calls.cas.length, 0);
  // Landmark: the same DB, asked about the current total (700), is a new bill and DOES write.
  const fresh = fakeDb({ total: 700, billFirstPrintedAt: STORED, billFirstPrintedTotal: 500 });
  assert.equal((await stampFirstBillPrint(ID, NOW_MS, fresh.deps, 700))?.getTime(), NOW_MS, "printedTotal 700 starts a new window");
  assert.equal(fresh.calls.cas.length, 1);
});

test("stampFirstBillPrint: a never-stamped order printed from a stale view (slip total differs from the DB) is null with zero CAS calls", async () => {
  const { deps, calls } = fakeDb({ total: 700 });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, deps, 500), null, "a stale slip neither starts nor moves a window");
  assert.deepEqual([calls.read.length, calls.cas.length], [1, 0]);
  // Landmark: the same order printed at its real total does stamp.
  assert.equal((await stampFirstBillPrint(ID, NOW_MS, deps, 700))?.getTime(), NOW_MS);
  assert.equal(calls.cas.length, 1);
  // A stale stamp under a moved total is not moved by a stale slip either.
  const stale = fakeDb({ total: 700, billFirstPrintedAt: STORED, billFirstPrintedTotal: 300 });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, stale.deps, 500), null);
  assert.equal(stale.calls.cas.length, 0);
});

test("stampFirstBillPrint: a printedTotal equal to the order's total behaves exactly like an absent one", async () => {
  const docs: Doc[] = [
    { total: TOTAL },
    { total: TOTAL, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL },
    { total: 300, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL },
    { total: TOTAL, billFirstPrintedAt: STORED },
    { total: TOTAL, cancelled: true },
  ];
  for (const doc of docs) {
    const without = fakeDb({ ...doc });
    const withTotal = fakeDb({ ...doc });
    const a = await stampFirstBillPrint(ID, NOW_MS, without.deps);
    const b = await stampFirstBillPrint(ID, NOW_MS, withTotal.deps, doc.total);
    assert.equal(b?.getTime(), a?.getTime(), JSON.stringify(doc));
    assert.deepEqual([withTotal.calls.read.length, withTotal.calls.cas.length], [without.calls.read.length, without.calls.cas.length], JSON.stringify(doc));
  }
});

test("stampFirstBillPrint: a CAS miss whose re-read is fresh for the DB's NEW total but not for the slip's total is null", async () => {
  // Slip and DB agree at read time (700); another device then grows the order to 800 and stamps THAT bill.
  const { deps, calls } = fakeDb({ total: 700 }, (d) => { d.total = 800; d.billFirstPrintedAt = OTHER; d.billFirstPrintedTotal = 800; });
  assert.equal(await stampFirstBillPrint(ID, NOW_MS, deps, 700), null, "a stamp for 800 is not this 700 slip's window");
  assert.equal(calls.read.length, 2, "landmark: the re-read ran");
  // Landmark: the same race with a stamp made for the slip's own total is adopted.
  const same = fakeDb({ total: 700 }, (d) => { d.billFirstPrintedAt = OTHER; d.billFirstPrintedTotal = 700; });
  assert.equal((await stampFirstBillPrint(ID, NOW_MS, same.deps, 700))?.getTime(), OTHER.getTime());
});

// ── the pure helpers ─────────────────────────────────────────────────────────

test("billFirstPrintFresh: stamped AND for this same total - nothing else is fresh", () => {
  assert.equal(billFirstPrintFresh({ total: 240, billFirstPrintedAt: STORED, billFirstPrintedTotal: 240 }), true);
  assert.equal(billFirstPrintFresh({ total: 0, billFirstPrintedAt: STORED, billFirstPrintedTotal: 0 }), true, "a zero total is a real total");
  assert.equal(billFirstPrintFresh({ total: 300, billFirstPrintedAt: STORED, billFirstPrintedTotal: 240 }), false, "total changed");
  assert.equal(billFirstPrintFresh({ total: 240, billFirstPrintedAt: STORED }), false, "legacy stamp, no stored total");
  assert.equal(billFirstPrintFresh({ total: 240, billFirstPrintedTotal: 240 }), false, "a total with no stamp");
  assert.equal(billFirstPrintFresh({ total: 240 }), false, "never printed");
  assert.equal(billFirstPrintFresh({ total: 240, billFirstPrintedAt: STORED.toISOString() as unknown as Date, billFirstPrintedTotal: 240 }), false, "only a real Date counts as a stamp");
});

test("firstBillPrintFilter: the exact CAS shapes - first print guards 'no stamp', a re-stamp guards the stamp it saw", () => {
  assert.deepEqual(firstBillPrintFilter(ID, { total: TOTAL }), { _id: ID, status: { $ne: "Cancelled" }, total: TOTAL, billFirstPrintedAt: { $exists: false } });
  assert.deepEqual(
    firstBillPrintFilter(ID, { total: 300, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL }),
    { _id: ID, status: { $ne: "Cancelled" }, total: 300, billFirstPrintedAt: STORED },
  );
});

test("firstBillPrintInsertFields: true stamps the insert with the moment AND the total, false adds no key at all", () => {
  const on = firstBillPrintInsertFields(true, NOW_MS, TOTAL);
  assert.deepEqual(on, { billFirstPrintedAt: new Date(NOW_MS), billFirstPrintedTotal: TOTAL });
  assert.ok(on.billFirstPrintedAt instanceof Date);
  assert.equal(firstBillPrintInsertFields(true, NOW_MS, 0).billFirstPrintedTotal, 0, "a zero total is still recorded");
  const off = firstBillPrintInsertFields(false, NOW_MS, TOTAL);
  assert.deepEqual(off, {});
  assert.equal("billFirstPrintedAt" in off || "billFirstPrintedTotal" in off, false);
  // The stamp an insert writes is fresh for the order it creates.
  assert.equal(billFirstPrintFresh({ total: TOTAL, ...on }), true);
});

test("withFirstBillPrint: a Date sets the stamp on a copy; null on an unstamped order is the SAME object; null on a stamped one drops the stale stamp (on a copy)", () => {
  const order: { _id: string; total: number; billFirstPrintedAt?: Date } = { _id: ID, total: 100 };
  assert.equal(withFirstBillPrint(order, null), order);
  const stamped = withFirstBillPrint(order, STORED);
  assert.notEqual(stamped, order);
  assert.deepEqual(stamped, { ...order, billFirstPrintedAt: STORED });
  assert.equal("billFirstPrintedAt" in order, false);
  // A failed restamp: the order's own stored stamp belongs to another total, so it must not ride along.
  const old = { ...order, billFirstPrintedAt: STORED };
  const dropped = withFirstBillPrint(old, null);
  assert.notEqual(dropped, old);
  assert.equal("billFirstPrintedAt" in dropped, false, "the stale stamp is gone from the answer");
  assert.deepEqual(dropped, order);
  assert.equal(old.billFirstPrintedAt, STORED, "the input is not mutated");
  // A new Date replaces a stored one.
  assert.equal(withFirstBillPrint(old, OTHER).billFirstPrintedAt, OTHER);
});
