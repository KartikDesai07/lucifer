/**
 * Inventory lite, Slice 5 live leg: suppliers and purchases (/api/inventory/suppliers, /api/inventory/entries) through
 * the REAL route handlers against a real mongod, with `@/lib/auth` swapped for a signed-in stub whose role is
 * switchable. The `stockitems`, `stockentries` and `suppliers` collections are read and written RAW (an independent
 * path from the routes). Harness: ./verify-inventory-purchases-live-kit.ts.
 *
 *   node --import tsx scripts/verify-inventory-purchases-live.ts
 *
 * SAFETY: refuses any database without the scratch prefix, and only ever drops the ONE database named DB_NAME
 * (by exact name) at start and in finally.
 * (console output is intentional: ops CLI script, not app code.)
 */
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { cafeDateString } from "@/lib/utils";
import {
  DB_NAME, as, byRef, call, check, countRef, dataOf, entries, has, listOf, loadRoute, oid, pageOf, qtyOf, rateOf,
  req, scratchUri, seedItem, seedSupplier, snapshot, suppliers, tally, type Body, type Res,
} from "./verify-inventory-purchases-live-kit";

const OPENING_MILK = 10000;
const OPENING_SUGAR = 5000;
const ABSENT_SUPPLIER = "665f0000000000000000d0ff";

async function runCases(): Promise<void> {
  const list = await loadRoute("app/api/inventory/entries/route.ts");
  const one = await loadRoute("app/api/inventory/entries/[id]/route.ts");
  const sup = await loadRoute("app/api/inventory/suppliers/route.ts");
  const supOne = await loadRoute("app/api/inventory/suppliers/[id]/route.ts");
  console.log(`  routes: entries ${list ? "loaded" : "MISSING"}, entries/[id] ${one ? "loaded" : "MISSING"}, suppliers ${sup ? "loaded" : "MISSING"}, suppliers/[id] ${supOne ? "loaded" : "MISSING"}`);
  const getEntries = () => call(list?.GET, req("GET", "/api/inventory/entries"));
  const post = (body: unknown) => call(list?.POST, req("POST", "/api/inventory/entries", body));
  const del = (id: string) => call(one?.DELETE, req("DELETE", `/api/inventory/entries/${id}`), { id });
  const getSuppliers = () => call(sup?.GET, req("GET", "/api/inventory/suppliers"));
  const postSupplier = (body: unknown) => call(sup?.POST, req("POST", "/api/inventory/suppliers", body));
  const patchSupplier = (id: string, body: unknown) => call(supOne?.PATCH, req("PATCH", `/api/inventory/suppliers/${id}`, body), { id });
  const dueOf = async (id: string) => listOf(await getSuppliers()).find((s) => s.id === id)?.duePaise;

  const today = cafeDateString(new Date());
  type L = { itemId: string; qtyMilli: number; ratePaise: number };
  const buy = (lines: L[], paidPaise: number, over: Body = {}): Body => ({ kind: "purchase", date: today, lines, paidPaise, clientRef: randomUUID(), ...over });

  const milk = await seedItem("Milk", "L", OPENING_MILK);
  const sugar = await seedItem("Sugar", "kg", OPENING_SUGAR);
  const old = await seedItem("Old tea", "kg", 100, true);
  const sharma = await seedSupplier("Sharma Dairy");
  const gone = await seedSupplier("Gone Traders", true);
  const both = [milk, sugar, old];

  // (a) staff may not buy or touch suppliers.
  as("staff");
  const before = await snapshot(both);
  const a1 = await post(buy([{ itemId: milk, qtyMilli: 1000, ratePaise: 100 }], 100));
  const a2 = await getSuppliers();
  const a3 = await postSupplier({ name: "Staff Made" });
  const a4 = await patchSupplier(sharma, { name: "Hacked" });
  check("(a) staff purchase POST is 403 and nothing is written", a1.status === 403 && (await snapshot(both)) === before, a1);
  check("(a) staff supplier GET, POST and PATCH are all 403; no supplier was added or renamed", a2.status === 403 && a3.status === 403 && a4.status === 403 && (await suppliers().countDocuments()) === 2 && (await suppliers().findOne({ _id: oid(sharma) }))?.name === "Sharma Dairy", a4);
  as("admin");

  // (b) admin purchase, two lines, paid in full, no supplier; a rounding line (333 milli x 50 paise = 16.65 -> 17).
  const bBody = buy([{ itemId: milk, qtyMilli: 1500, ratePaise: 4000 }, { itemId: sugar, qtyMilli: 333, ratePaise: 50 }], 6017);
  const b = await post(bBody);
  const rawB = await byRef(String(bBody.clientRef));
  check("(b) admin purchase is 201 with a DTO", b.status === 201 && dataOf(b).kind === "purchase", b);
  check("(b) stock moved by +1500 and +333", (await qtyOf(milk)) === OPENING_MILK + 1500 && (await qtyOf(sugar)) === OPENING_SUGAR + 333);
  check("(b) lastRatePaise set on both items", (await rateOf(milk)) === 4000 && (await rateOf(sugar)) === 50);
  const bLines = (rawB as { lines?: Body[] } | null)?.lines ?? [];
  check("(b) the server computed the amounts (6000, 17) and the total 6017", bLines[0]?.amountPaise === 6000 && bLines[1]?.amountPaise === 17 && rawB?.totalPaise === 6017 && rawB?.paidPaise === 6017);
  check("(b) raw row: no duePaise and no supplierId key; createdBy from the session", !has(rawB, "duePaise") && !has(rawB, "supplierId") && rawB?.createdBy === "Live leg admin" && rawB?.kind === "purchase");
  check("(b) money is stored as BSON int32", (await entries().countDocuments({ clientRef: bBody.clientRef, totalPaise: { $type: "int" }, paidPaise: { $type: "int" }, "lines.amountPaise": { $type: "int" } })) === 1);
  const bId = String(dataOf(b).id);

  // (c) part paid with a supplier: the due is total - paid and shows in the supplier list; a second purchase adds up.
  const c1Body = buy([{ itemId: milk, qtyMilli: 2000, ratePaise: 3000 }], 2500, { supplierId: sharma, note: "weekly" });
  const c1 = await post(c1Body);
  const rawC1 = await byRef(String(c1Body.clientRef));
  check("(c) part paid purchase is 201; raw duePaise = 6000 - 2500", c1.status === 201 && rawC1?.duePaise === 3500 && String(rawC1?.supplierId) === sharma && rawC1?.note === "weekly", c1);
  check("(c) milk stock +2000 and its last rate is now 3000", (await qtyOf(milk)) === OPENING_MILK + 3500 && (await rateOf(milk)) === 3000);
  check("(c) GET suppliers shows the supplier owing 3500", (await dueOf(sharma)) === 3500);
  const c2Body = buy([{ itemId: sugar, qtyMilli: 1000, ratePaise: 1000 }], 0, { supplierId: sharma });
  const c2 = await post(c2Body);
  check("(c) a second purchase adds to the same due (3500 + 1000)", c2.status === 201 && (await dueOf(sharma)) === 4500, c2);
  const c1Id = String(dataOf(c1).id);
  const c2Id = String(dataOf(c2).id);

  // (d) (e) (f) refusals write NOTHING.
  const one1: L[] = [{ itemId: milk, qtyMilli: 1000, ratePaise: 100 }];
  const refusals: [string, Res, number][] = [];
  const snap = await snapshot(both);
  refusals.push(["(d) paid over the total", await post(buy(one1, 101, { supplierId: sharma })), 400]);
  refusals.push(["(e) a due with no supplier", await post(buy(one1, 40)), 400]);
  refusals.push(["(f) an unknown supplier", await post(buy(one1, 100, { supplierId: ABSENT_SUPPLIER })), 404]);
  refusals.push(["(f) an archived supplier", await post(buy(one1, 100, { supplierId: gone })), 404]);
  refusals.push(["(f) an archived item", await post(buy([{ itemId: old, qtyMilli: 1000, ratePaise: 100 }], 100)), 404]);
  refusals.push(["(f) one archived item among good ones: the good ones move nothing either", await post(buy([...one1, { itemId: old, qtyMilli: 1000, ratePaise: 100 }], 200)), 404]);
  for (const [label, res, status] of refusals) check(`${label} is ${status}`, res.status === status, res);
  check("(d-f) no refusal wrote a row or moved a stock number or a last rate", (await snapshot(both)) === snap);

  // (g) the same clientRef again: 200, stock moved once; an edited resend is a 409.
  // Paid 40 of 100, so the row carries a due of 60: a replay that landed a second row would read 4620, not 4560.
  const gBody = buy([{ itemId: sugar, qtyMilli: 500, ratePaise: 200 }], 40, { supplierId: sharma });
  const g1 = await post(gBody);
  const afterG1 = await snapshot(both);
  const g2 = await post(gBody);
  check("(g) same-ref resend is 200 with the same entry, and moved nothing", g1.status === 201 && g2.status === 200 && dataOf(g2).id === dataOf(g1).id && (await snapshot(both)) === afterG1, g2);
  const g3 = await post({ ...gBody, paidPaise: 50 }); // a valid purchase (due 50), just not the one first saved
  check("(g) an edited resend (paid changed) is 409 and moved nothing", g3.status === 409 && (await snapshot(both)) === afterG1, g3);
  check("(g) still one row for that ref; the supplier due counts it once (4500 + 60)", (await countRef(String(gBody.clientRef))) === 1 && (await dueOf(sharma)) === 4560);
  await del(String(dataOf(g1).id));

  // (h) two concurrent same-ref POSTs: one row, stock moved once.
  const hBody = buy([{ itemId: sugar, qtyMilli: 400, ratePaise: 100 }], 40);
  const qtyBeforeH = await qtyOf(sugar);
  const hBoth = await Promise.all([post(hBody), post(hBody)]);
  const hStatuses = hBoth.map((r) => r.status).sort();
  check("(h) concurrent same-ref POSTs: one 201 and one 200, one row, stock moved once", hStatuses[0] === 200 && hStatuses[1] === 201 && (await countRef(String(hBody.clientRef))) === 1 && (await qtyOf(sugar)) === (qtyBeforeH ?? 0) + 400, hBoth[0]);

  // (i) a free line moves stock but not the last rate.
  const rateBeforeI = await rateOf(sugar);
  const qtyBeforeI = await qtyOf(sugar);
  const i = await post(buy([{ itemId: sugar, qtyMilli: 250, ratePaise: 0 }], 0));
  check("(i) a rate-0 line is 201, stock +250 and the last rate is unchanged", i.status === 201 && (await qtyOf(sugar)) === (qtyBeforeI ?? 0) + 250 && (await rateOf(sugar)) === rateBeforeI, i);

  // (j) the entries list shows the purchase with its money and the supplier name; never the internal keys.
  const j = await getEntries();
  const row = pageOf(j).rows.find((r) => r.id === c1Id);
  const jLine = (row?.lines as Body[] | undefined)?.[0];
  check("(j) the list shows supplierName, total, paid, due", row?.supplierName === "Sharma Dairy" && row?.supplierId === sharma && row?.totalPaise === 6000 && row?.paidPaise === 2500 && row?.duePaise === 3500, j);
  check("(j) the line carries the name, rate and amount", jLine?.name === "Milk" && jLine?.ratePaise === 3000 && jLine?.amountPaise === 6000 && jLine?.qtyMilli === 2000);
  check("(j) never clientRef, createdById or v", row !== undefined && !has(row, "clientRef") && !has(row, "createdById") && !has(row, "v"));
  const paidRow = pageOf(j).rows.find((r) => r.id === bId);
  check("(j) a settled purchase has no duePaise key and no supplier name", paidRow !== undefined && !has(paidRow, "duePaise") && !has(paidRow, "supplierName") && paidRow.totalPaise === 6017);

  // (k) delete a purchase: stock back, due gone; a second delete is a 404 and reverses nothing more.
  const qtyBeforeK = await qtyOf(milk);
  const k1 = await del(c1Id);
  check("(k) DELETE purchase is 200: stock goes back by exactly 2000 and the due drops to 1000", k1.status === 200 && (await qtyOf(milk)) === (qtyBeforeK ?? 0) - 2000 && (await dueOf(sharma)) === 1000, k1);
  const k2 = await del(c1Id);
  check("(k) a second DELETE is 404 and reverses nothing", k2.status === 404 && (await qtyOf(milk)) === (qtyBeforeK ?? 0) - 2000, k2);
  check("(k) the last rate is NOT restored by a delete (accepted residual)", (await rateOf(milk)) === 3000);
  await del(c2Id);
  check("(k) deleting the other purchase settles the supplier (due 0)", (await dueOf(sharma)) === 0);

  // (l) the supplier lifecycle.
  const l1 = await postSupplier({ name: "Rao Traders", phone: "99999 11111", note: "Net 7" });
  const raoId = String(dataOf(l1).id);
  const rawRao = await suppliers().findOne({ _id: oid(raoId) });
  check("(l) create is 201 with duePaise 0; raw row has phone, note and v", l1.status === 201 && dataOf(l1).duePaise === 0 && rawRao?.phone === "99999 11111" && rawRao?.v === 1, l1);
  const l2 = await postSupplier({ name: "RAO TRADERS" });
  check("(l) the same name in another case is 400", l2.status === 400 && (await suppliers().countDocuments({ name: /rao/i })) === 1, l2);
  const l3 = await postSupplier({ name: "Bare Bones", phone: "" });
  check("(l) an empty phone is not stored", l3.status === 201 && !has(await suppliers().findOne({ _id: oid(String(dataOf(l3).id)) }), "phone"), l3);
  const l4 = await patchSupplier(raoId, { name: "Rao and Sons" });
  const l4b = await patchSupplier(raoId, { name: "Sharma dairy" });
  check("(l) rename is 200; renaming onto another active supplier is 400", l4.status === 200 && dataOf(l4).name === "Rao and Sons" && l4b.status === 400, l4b);
  const l5 = await patchSupplier(raoId, { phone: null });
  check("(l) phone null clears it (the key is gone); the note stays", l5.status === 200 && !has(await suppliers().findOne({ _id: oid(raoId) }), "phone") && (await suppliers().findOne({ _id: oid(raoId) }))?.note === "Net 7", l5);
  const l6 = await patchSupplier(raoId, {});
  const l7 = await patchSupplier("not-an-id", { name: "X" });
  const l8 = await patchSupplier(ABSENT_SUPPLIER, { name: "X" });
  check("(l) nothing to change is 400, a malformed id and an unknown id are 404", l6.status === 400 && l7.status === 404 && l8.status === 404, l6);
  const lBody = buy([{ itemId: milk, qtyMilli: 1000, ratePaise: 5000 }], 1000, { supplierId: raoId });
  const lId = String(dataOf(await post(lBody)).id);
  const l9 = await patchSupplier(raoId, { archived: true });
  check("(l) archive is refused while a due remains (4000), and the supplier stays active", l9.status === 400 && (await dueOf(raoId)) === 4000 && !has(await suppliers().findOne({ _id: oid(raoId) }), "archived"), l9);
  await del(lId);
  const advance = await entries().insertOne({ kind: "payment", date: today, supplierId: oid(raoId), totalPaise: 500, duePaise: -500, createdBy: "t", createdById: "t", clientRef: randomUUID(), v: 1, createdAt: new Date(), updatedAt: new Date() });
  const l10 = await patchSupplier(raoId, { archived: true });
  check("(l) a negative due (paid in advance) also blocks the archive", l10.status === 400 && (await dueOf(raoId)) === -500, l10);
  await entries().deleteOne({ _id: advance.insertedId });
  const l11 = await patchSupplier(raoId, { archived: true });
  const names = listOf(await getSuppliers()).map((s) => s.name);
  check("(l) archive is 200 once the due is 0; the supplier leaves the list, the others stay", l11.status === 200 && !names.includes("Rao and Sons") && names.includes("Sharma Dairy") && names.includes("Bare Bones"), l11);
  const l12 = await patchSupplier(raoId, { name: "Back Again" });
  check("(l) an archived supplier cannot be edited (404)", l12.status === 404, l12);
  check("(l) the list is A to Z", JSON.stringify(names) === JSON.stringify([...names].sort((x, y) => String(x).localeCompare(String(y), "en", { sensitivity: "base" }))), undefined);
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
  console.log(`\nInventory lite Slice 5 suppliers and purchases leg: live against ${DB_NAME}\n`);

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
