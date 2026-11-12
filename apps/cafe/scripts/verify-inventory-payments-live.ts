/**
 * Inventory lite, Slice 6 live leg: paying a supplier (POST /api/inventory/entries kind "payment", the supplier-filtered
 * history, the dues sum, the archive rule) through the REAL route handlers against a real mongod, with `@/lib/auth`
 * swapped for a signed-in stub whose role is switchable. The `stockitems`, `stockentries` and `suppliers` collections
 * are read RAW (an independent path from the routes). Harness: ./verify-inventory-purchases-live-kit.ts (unchanged; it
 * owns the scratch DB name, so this leg and the purchases leg must run one after the other, never together).
 *
 *   node --import tsx scripts/verify-inventory-payments-live.ts
 *
 * SAFETY: refuses any database without the scratch prefix, and only ever drops the ONE database named DB_NAME
 * (by exact name) at start and in finally.
 * (console output is intentional: ops CLI script, not app code.)
 */
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { cafeDateString } from "@/lib/utils";
import { SUPPLIER_HAS_DUES_ERROR } from "@/lib/inventory/suppliers";
import {
  DB_NAME, as, byRef, call, check, countRef, dataOf, entries, has, listOf, loadRoute, oid, pageOf, qtyOf,
  req, scratchUri, seedItem, seedSupplier, suppliers, tally, type Body,
} from "./verify-inventory-purchases-live-kit";

const OPENING_MILK = 10000;
const ABSENT_SUPPLIER = "665f0000000000000000d0ff";
const MS_PER_DAY = 86_400_000;
const FUTURE_DAYS = 2;

async function runCases(): Promise<void> {
  const list = await loadRoute("app/api/inventory/entries/route.ts");
  const one = await loadRoute("app/api/inventory/entries/[id]/route.ts");
  const sup = await loadRoute("app/api/inventory/suppliers/route.ts");
  const supOne = await loadRoute("app/api/inventory/suppliers/[id]/route.ts");
  console.log(`  routes: entries ${list ? "loaded" : "MISSING"}, entries/[id] ${one ? "loaded" : "MISSING"}, suppliers ${sup ? "loaded" : "MISSING"}, suppliers/[id] ${supOne ? "loaded" : "MISSING"}`);
  const post = (body: unknown) => call(list?.POST, req("POST", "/api/inventory/entries", body));
  const getFor = (query: string) => call(list?.GET, req("GET", `/api/inventory/entries${query}`));
  const del = (id: string) => call(one?.DELETE, req("DELETE", `/api/inventory/entries/${id}`), { id });
  const getSuppliers = () => call(sup?.GET, req("GET", "/api/inventory/suppliers"));
  const patchSupplier = (id: string, body: unknown) => call(supOne?.PATCH, req("PATCH", `/api/inventory/suppliers/${id}`, body), { id });
  const dueOf = async (id: string) => listOf(await getSuppliers()).find((s) => s.id === id)?.duePaise;
  const rowCount = () => entries().countDocuments();

  const today = cafeDateString(new Date());
  const future = new Date(Date.now() + FUTURE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const pay = (supplierId: string, amountPaise: number, over: Body = {}): Body => ({ kind: "payment", supplierId, amountPaise, date: today, clientRef: randomUUID(), ...over });

  const milk = await seedItem("Milk", "L", OPENING_MILK);
  const sharma = await seedSupplier("Sharma Dairy");
  const rao = await seedSupplier("Rao Traders");
  const gone = await seedSupplier("Gone Traders", true);

  // (a) seed: S buys 10 units at Rs 100, paid nothing -> S owes 100000. Another supplier's purchase and a wastage
  // exist too, so the history filter has something to leave out.
  const a1 = await post({ kind: "purchase", date: today, supplierId: sharma, lines: [{ itemId: milk, qtyMilli: 10000, ratePaise: 10000 }], paidPaise: 0, clientRef: randomUUID() });
  const a2 = await post({ kind: "purchase", date: today, supplierId: rao, lines: [{ itemId: milk, qtyMilli: 1000, ratePaise: 5000 }], paidPaise: 0, clientRef: randomUUID() });
  const a3 = await post({ kind: "waste", itemId: milk, qtyMilli: 500, reason: "Spoiled", date: today, clientRef: randomUUID() });
  const purchaseId = String(dataOf(a1).id);
  check("(a) S purchase (10 units at Rs 100, paid nothing), T purchase and a wastage are all 201", a1.status === 201 && a2.status === 201 && a3.status === 201, a1);
  check("(a) S owes 100000 paise", (await dueOf(sharma)) === 100000);
  const stockAfterSeed = await qtyOf(milk);

  // (b) pay Rs 400.
  const bBody = pay(sharma, 40000, { note: "cash" });
  const b = await post(bBody);
  const rawB = await byRef(String(bBody.clientRef));
  check("(b) payment of 40000 is 201 with a payment DTO", b.status === 201 && dataOf(b).kind === "payment" && dataOf(b).totalPaise === 40000 && dataOf(b).supplierName === "Sharma Dairy", b);
  check("(b) S due is now 60000", (await dueOf(sharma)) === 60000);
  check("(b) raw row: kind payment, totalPaise 40000, duePaise -40000, createdBy from the session", rawB?.kind === "payment" && rawB?.totalPaise === 40000 && rawB?.duePaise === -40000 && rawB?.createdBy === "Live leg admin" && String(rawB?.supplierId) === sharma);
  check("(b) totalPaise and duePaise are BSON int32", (await entries().countDocuments({ clientRef: bBody.clientRef, totalPaise: { $type: "int" }, duePaise: { $type: "int" } })) === 1);
  check("(b) raw row has no lines key and no paidPaise key", rawB !== null && !has(rawB, "lines") && !has(rawB, "paidPaise"));
  const bId = String(dataOf(b).id);

  // (c) the same body again: the first row comes back, nothing more is written.
  const c = await post(bBody);
  check("(c) same body and clientRef is 200 with the same entry; still one row; due still 60000", c.status === 200 && dataOf(c).id === bId && (await countRef(String(bBody.clientRef))) === 1 && (await dueOf(sharma)) === 60000, c);

  // (d) the same clientRef with another amount is a conflict.
  const rowsBeforeD = await rowCount();
  const d = await post({ ...bBody, amountPaise: 50000 });
  check("(d) same clientRef, other amount is 409; nothing changed", d.status === 409 && (await rowCount()) === rowsBeforeD && (await byRef(String(bBody.clientRef)))?.totalPaise === 40000 && (await dueOf(sharma)) === 60000, d);

  // (e) overpay: Rs 1,000 against a due of 60000 -> paid ahead; a negative due blocks the archive.
  const eBody = pay(sharma, 100000);
  const e = await post(eBody);
  check("(e) overpay 100000 is 201 and the due goes to -40000", e.status === 201 && (await dueOf(sharma)) === -40000, e);
  const eId = String(dataOf(e).id);
  const e2 = await patchSupplier(sharma, { archived: true });
  check("(e) archive is refused with SUPPLIER_HAS_DUES_ERROR while paid ahead", e2.status === 400 && e2.body.error === SUPPLIER_HAS_DUES_ERROR && !has(await suppliers().findOne({ _id: oid(sharma) }), "archived"), e2);

  // (f) S's history: its purchase and its two payments, newest first; nothing of T's or the wastage.
  const f = await getFor(`?supplierId=${sharma}`);
  const fRows = pageOf(f).rows;
  check("(f) the list is exactly S's purchase and 2 payments, newest first", f.status === 200 && JSON.stringify(fRows.map((r) => r.id)) === JSON.stringify([eId, bId, purchaseId]), f);
  check("(f) no other supplier's purchase and no wastage in it", fRows.every((r) => r.supplierId === sharma && r.kind !== "waste"));
  check("(f) a payment row carries its supplier name, total and a negative due; no lines", fRows[0]?.kind === "payment" && fRows[0]?.supplierName === "Sharma Dairy" && fRows[0]?.totalPaise === 100000 && fRows[0]?.duePaise === -100000 && ((fRows[0]?.lines as unknown[] | undefined) ?? []).length === 0);
  const fAll = await getFor("");
  check("(f) without the filter the list still shows every kind (T's purchase and the wastage too)", pageOf(fAll).rows.length === 5 && pageOf(fAll).rows.some((r) => r.kind === "waste") && pageOf(fAll).rows.some((r) => r.supplierId === rao), fAll);
  const fBad = await getFor("?supplierId=bad");
  check("(f) ?supplierId=bad is 400", fBad.status === 400, fBad);

  // (g) delete a payment: the due comes back by itself; a second delete is a 404; stock never moved.
  const g1 = await del(eId);
  check("(g) DELETE the 1000 payment is 200 and the due is back to 60000", g1.status === 200 && (await dueOf(sharma)) === 60000, g1);
  const g2 = await del(eId);
  check("(g) a second DELETE is 404 and the due is unchanged", g2.status === 404 && (await dueOf(sharma)) === 60000, g2);
  check("(g) the item's stock is unchanged across the payments and the deletes", (await qtyOf(milk)) === stockAfterSeed);

  // (h) staff may not pay a supplier or read a supplier's history.
  as("staff");
  const rowsBeforeH = await rowCount();
  const h1 = await post(pay(sharma, 1000));
  const h2 = await getFor(`?supplierId=${sharma}`);
  as("admin");
  check("(h) staff payment POST is 403 and nothing is written", h1.status === 403 && (await rowCount()) === rowsBeforeH && (await dueOf(sharma)) === 60000, h1);
  check("(h) staff GET ?supplierId is 403", h2.status === 403, h2);

  // (i) the supplier must be active.
  const rowsBeforeI = await rowCount();
  const i1 = await post(pay(gone, 1000));
  const i2 = await post(pay(ABSENT_SUPPLIER, 1000));
  check("(i) a payment to an archived supplier is 404, to an unknown id is 404, nothing written", i1.status === 404 && i2.status === 404 && (await rowCount()) === rowsBeforeI, i1);

  // (j) the body is validated.
  const j1 = await post(pay(sharma, 0));
  const j2 = await post(pay(sharma, 1000, { date: future }));
  check("(j) amount 0 is 400; a future date is 400; nothing written", j1.status === 400 && j2.status === 400 && (await rowCount()) === rowsBeforeI, j2);

  // (k) two concurrent POSTs with one clientRef: one row, the due moves once.
  const kBody = pay(sharma, 1000);
  const kBoth = await Promise.all([post(kBody), post(kBody)]);
  const kStatuses = kBoth.map((r) => r.status).sort();
  check("(k) concurrent same-ref payments: one 201 and one 200, one row, the due moved once (60000 -> 59000)", kStatuses[0] === 200 && kStatuses[1] === 201 && (await countRef(String(kBody.clientRef))) === 1 && (await dueOf(sharma)) === 59000, kBoth[0]);
  const kRow = await byRef(String(kBody.clientRef));
  await del(String(kRow?._id));
  check("(k) deleting that payment puts the due back to 60000", (await dueOf(sharma)) === 60000);

  // (l) pay what is left: due 0, and now the supplier can be archived.
  const l1 = await post(pay(sharma, 60000));
  check("(l) paying the remaining 60000 is 201 and the due is 0", l1.status === 201 && (await dueOf(sharma)) === 0, l1);
  const l2 = await patchSupplier(sharma, { archived: true });
  check("(l) archive is 200 once the due is 0", l2.status === 200 && (await suppliers().findOne({ _id: oid(sharma) }))?.archived === true, l2);
  const l3 = await post(pay(sharma, 1000));
  check("(l) and an archived supplier can no longer be paid (404)", l3.status === 404, l3);

  // (m) review s118 (MED): an archived supplier's dues are 0 by the archive rule, but their rows still hold +100000 and
  // -100000. Deleting one of those rows would bring back a due nobody can see or pay (no Pay for an archived supplier),
  // so the delete is refused (409) and nothing moves: the row stays active, the raw due sum stays 0, stock unchanged.
  const rawDue = async (id: string) => {
    const rows = await entries().aggregate<{ due: number }>([{ $match: { supplierId: oid(id), deletedAt: { $exists: false }, duePaise: { $exists: true } } }, { $group: { _id: null, due: { $sum: "$duePaise" } } }]).toArray();
    return rows[0]?.due ?? 0;
  };
  const lId = String(dataOf(l1).id);
  const stockBeforeM = await qtyOf(milk);
  const m1 = await del(lId);
  const m2 = await del(purchaseId);
  const isActive = async (id: string) => (await entries().countDocuments({ _id: oid(id), deletedAt: { $exists: false } })) === 1;
  check("(m) deleting an archived supplier's payment is 409; the row stays and the raw due stays 0", m1.status === 409 && (await isActive(lId)) && (await rawDue(sharma)) === 0, m1);
  check("(m) deleting an archived supplier's purchase is 409; the row stays, the due stays 0, stock unchanged", m2.status === 409 && (await isActive(purchaseId)) && (await rawDue(sharma)) === 0 && (await qtyOf(milk)) === stockBeforeM, m2);
  // A row of an ACTIVE supplier still deletes (the guard is only about archived ones): T's purchase.
  const m3 = await del(String(dataOf(a2).id));
  check("(m) an active supplier's purchase still deletes (200)", m3.status === 200, m3);
}

async function main(): Promise<void> {
  const uri = scratchUri();
  process.env.MONGODB_URI = uri;

  const scratch = await mongoose.createConnection(uri).asPromise();
  try {
    await scratch.dropDatabase();
  } finally {
    await scratch.close();
  }

  await connectDB();
  if (!mongoose.connection.db || mongoose.connection.name !== DB_NAME) throw new Error("Unexpected database, aborting.");
  console.log(`\nInventory lite Slice 6 supplier payments leg: live against ${DB_NAME}\n`);

  try {
    await runCases();
  } finally {
    // Drop ONLY this scratch database, by exact name.
    if (mongoose.connection.name === DB_NAME) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  const { passed, failed } = tally();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
