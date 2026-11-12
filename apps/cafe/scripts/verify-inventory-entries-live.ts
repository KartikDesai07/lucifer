/**
 * Inventory lite, Slice 4 live leg: /api/inventory/entries (wastage, counts, list, delete) through the REAL route
 * handlers against a real mongod, with `@/lib/auth` swapped for a signed-in stub whose role is switchable (the
 * verify-inventory-items-live.ts harness). The `stockitems` and `stockentries` collections are read and written RAW
 * (an independent path from the routes).
 *
 *   node --import tsx scripts/verify-inventory-entries-live.ts
 *
 * SAFETY: refuses any database without the scratch prefix, and only ever drops the ONE database named DB_NAME
 * (by exact name) at start and in finally.
 * (console output is intentional: ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { addDays } from "@/lib/dashboard/range";
import { cafeDateString } from "@/lib/utils";
import { STOCK_ENTRY_BACKDATE_MAX_DAYS, STOCK_ENTRY_PAGE_MAX } from "@pos/shared/inventory";
import { runCountLegs } from "./verify-inventory-entries-live-count";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}inventory_entries`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const BODY_PRINT_MAX = 150;
const ROUTE_MISSING_STATUS = 0;
const STAFF_ID = "665f0000000000000000a001";
const ADMIN_ID = "665f0000000000000000a002";
const OPENING_MILK = 10000;
const OPENING_SUGAR = 5000;

type Role = "admin" | "staff";
type Body = Record<string, unknown>;
type Res = { status: number; body: { success: boolean; data?: unknown; error?: string } };
type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface RouteModule { GET?: Handler; POST?: Handler; DELETE?: Handler }

let currentRole: Role = "admin";

function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  const who = () => (currentRole === "admin" ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" } : { id: STAFF_ID, name: "Live leg staff", role: "staff" });
  stub.exports = { auth: async () => ({ user: who() }), handlers: {}, signIn: async () => undefined, signOut: async () => undefined };
  require.cache[file] = stub;
}
stubAuth();

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, res?: Res): void {
  if (ok) passed += 1;
  else failed += 1;
  const seen = res ? ` -> ${res.status} ${JSON.stringify(res.body).slice(0, BODY_PRINT_MAX)}` : "";
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${seen}`);
}

async function loadRoute(relative: string): Promise<RouteModule | null> {
  const abs = path.join(__dirname, "..", ...relative.split("/"));
  const mod: unknown = await import(pathToFileURL(abs).href).catch(() => null);
  return mod as RouteModule | null;
}

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://live.test${url}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(handler: Handler | undefined, request: Request, params: Record<string, string> = {}): Promise<Res> {
  if (!handler) return { status: ROUTE_MISSING_STATUS, body: { success: false, error: "route or handler missing" } };
  const res = await handler(request, { params: Promise.resolve(params) });
  const body = (await res.json().catch(() => ({ success: false, error: "non-JSON body" }))) as Res["body"];
  return { status: res.status, body };
}

const db = () => {
  const handle = mongoose.connection.db;
  if (!handle) throw new Error("not connected");
  return handle;
};
const items = () => db().collection("stockitems");
const entries = () => db().collection("stockentries");
const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
const qtyOf = async (id: string) => (await items().findOne({ _id: oid(id) }))?.qty as number | undefined;
const byRef = (ref: string) => entries().findOne({ clientRef: ref });
const countRef = (ref: string) => entries().countDocuments({ clientRef: ref });
const has = (o: object | null, key: string) => o !== null && key in o;
const dataOf = (res: Res): Body => (res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {});
const pageOf = (res: Res): { rows: Body[]; nextBefore?: string } =>
  (res.body.data ?? { rows: [] }) as { rows: Body[]; nextBefore?: string };
const firstLine = (e: object | null) => (e as { lines?: Array<Record<string, unknown>> } | null)?.lines?.[0];

// The exact-name guard: prefix AND the one name this leg owns.
function scratchUri(): string {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}": only ${DB_NAME} (a ${SCRATCH_PREFIX}* database) is allowed.`);
  }
  return uri;
}

async function seedItem(name: string, unit: string, qty: number, archived = false): Promise<string> {
  const now = new Date();
  const doc: Body = { name, unit, qty, v: 1, createdAt: now, updatedAt: now };
  if (archived) doc.archived = true;
  return String((await items().insertOne(doc)).insertedId);
}

async function runCases(): Promise<void> {
  const list = await loadRoute("app/api/inventory/entries/route.ts");
  const one = await loadRoute("app/api/inventory/entries/[id]/route.ts");
  console.log(`  routes: entries ${list ? "loaded" : "MISSING"}, entries/[id] ${one ? "loaded" : "MISSING"}`);
  const as = (role: Role) => {
    currentRole = role;
  };
  const get = (query = "") => call(list?.GET, req("GET", `/api/inventory/entries${query}`));
  const post = (body: unknown) => call(list?.POST, req("POST", "/api/inventory/entries", body));
  const del = (id: string) => call(one?.DELETE, req("DELETE", `/api/inventory/entries/${id}`), { id });

  const today = cafeDateString(new Date());
  const wasteBody = (itemId: string, qtyMilli: number, over: Body = {}): Body => ({ kind: "waste", itemId, qtyMilli, reason: "Spoiled", date: today, clientRef: randomUUID(), ...over });
  const countBody = (itemId: string, countedMilli: number, over: Body = {}): Body => ({ kind: "count", itemId, countedMilli, date: today, clientRef: randomUUID(), ...over });

  const milk = await seedItem("Milk", "L", OPENING_MILK);
  const sugar = await seedItem("Sugar", "kg", OPENING_SUGAR);
  const old = await seedItem("Old tea", "kg", 100, true);

  // (a) staff wastage.
  as("staff");
  const aBody = wasteBody(milk, 2500, { note: "dropped tray" });
  const aRef = String(aBody.clientRef);
  const a = await post(aBody);
  const rawA = await byRef(aRef);
  check("(a) staff waste POST is 201 with a DTO", a.status === 201 && dataOf(a).kind === "waste", a);
  check("(a) stock moved by exactly -2500", (await qtyOf(milk)) === OPENING_MILK - 2500);
  check(
    "(a) raw entry: kind waste, one line -2500, createdBy from the session, no deletedAt key",
    rawA?.kind === "waste" && firstLine(rawA)?.qty === -2500 && String(firstLine(rawA)?.itemId) === milk &&
      rawA?.createdBy === "Live leg staff" && rawA?.createdById === STAFF_ID && !has(rawA, "deletedAt"),
  );
  const refIndex = (await entries().indexes()).find((i) => i.key && "clientRef" in i.key);
  check("(a) the unique clientRef index was built by the first write (modelReady)", refIndex?.unique === true);
  const aId = String(dataOf(a).id);
  const qtyAfterA = OPENING_MILK - 2500;

  // (b) replay.
  const b = await post(aBody);
  check("(b) same clientRef replay is 200, stock unchanged, still one entry", b.status === 200 && (await qtyOf(milk)) === qtyAfterA && (await countRef(aRef)) === 1, b);

  // (c) same ref, different qty.
  const c = await post({ ...aBody, qtyMilli: 3000 });
  check("(c) same ref with another qty is 409 and stock unchanged", c.status === 409 && (await qtyOf(milk)) === qtyAfterA && (await countRef(aRef)) === 1, c);

  // (d) staff cannot count.
  const entriesBeforeD = await entries().countDocuments();
  const d = await post(countBody(milk, 1));
  check("(d) staff count is 403 and nothing is written", d.status === 403 && (await qtyOf(milk)) === qtyAfterA && (await entries().countDocuments()) === entriesBeforeD, d);

  // (e) admin count after a raw set.
  as("admin");
  await items().updateOne({ _id: oid(milk) }, { $set: { qty: 6000 } });
  const eBody = countBody(milk, 7250, { note: "end of day" });
  const e = await post(eBody);
  const rawE = await byRef(String(eBody.clientRef));
  check("(e) admin count is 201, stock == counted", e.status === 201 && (await qtyOf(milk)) === 7250, e);
  check("(e) raw line: qty == counted - before (1250), counted stored", firstLine(rawE)?.qty === 1250 && firstLine(rawE)?.counted === 7250 && rawE?.kind === "count");
  const eId = String(dataOf(e).id);

  // (f) count replay after a raw bump must not reset the stock.
  await items().updateOne({ _id: oid(milk) }, { $set: { qty: 9000 } });
  const f = await post(eBody);
  check("(f) count replay is 200 and the stock is NOT reset", f.status === 200 && (await qtyOf(milk)) === 9000 && (await countRef(String(eBody.clientRef))) === 1, f);

  // (g) archived item.
  const entriesBeforeG = await entries().countDocuments();
  const g1 = await post(wasteBody(old, 10));
  const g2 = await post(countBody(old, 5));
  check("(g) waste and count on an archived item are 404, nothing written", g1.status === 404 && g2.status === 404 && (await qtyOf(old)) === 100 && (await entries().countDocuments()) === entriesBeforeG, g1);

  // (h) the date window.
  const entriesBeforeH = await entries().countDocuments();
  const h1 = await post(wasteBody(sugar, 100, { date: addDays(today, 1) }));
  const h2 = await post(wasteBody(sugar, 100, { date: addDays(today, -STOCK_ENTRY_BACKDATE_MAX_DAYS - 1) }));
  check("(h) tomorrow and 32 days back are 400, nothing written", h1.status === 400 && h2.status === 400 && (await entries().countDocuments()) === entriesBeforeH && (await qtyOf(sugar)) === OPENING_SUGAR, h1);
  const h3 = await post(wasteBody(sugar, 100, { date: addDays(today, -STOCK_ENTRY_BACKDATE_MAX_DAYS) }));
  check("(h) 31 days back is 201", h3.status === 201 && (await qtyOf(sugar)) === OPENING_SUGAR - 100, h3);

  // (i) the list: staff refused, order, joined names, paging, bad queries. Two more same-day rows exercise the id tie-break.
  await post(wasteBody(sugar, 10));
  await post(wasteBody(sugar, 10));
  as("staff");
  const iStaff = await get();
  as("admin");
  const iAll = await get();
  const expected = (await entries().find({ deletedAt: { $exists: false } }).sort({ date: -1, _id: -1 }).toArray()).map((r) => String(r._id));
  const gotIds = pageOf(iAll).rows.map((r) => String(r.id));
  const milkRow = pageOf(iAll).rows.find((r) => r.id === aId);
  const milkLine = (milkRow?.lines as Body[] | undefined)?.[0];
  check("(i) staff GET is 403", iStaff.status === 403, iStaff);
  check("(i) admin GET lists every active entry newest first", iAll.status === 200 && JSON.stringify(gotIds) === JSON.stringify(expected) && gotIds.length === 5, iAll);
  check("(i) names and units are joined; no internal keys", milkLine?.name === "Milk" && milkLine?.unit === "L" && milkRow !== undefined && !has(milkRow, "clientRef") && !has(milkRow, "createdById") && !has(milkRow, "v"));
  const visited: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard <= expected.length + 1; guard += 1) {
    const page = await get(`?limit=1${cursor ? `&before=${cursor}` : ""}`);
    visited.push(...pageOf(page).rows.map((r) => String(r.id)));
    cursor = pageOf(page).nextBefore;
    if (!cursor) break;
  }
  check("(i) limit=1 paging via nextBefore visits every active entry exactly once, in order", JSON.stringify(visited) === JSON.stringify(expected), undefined);
  const badBefore = await get("?before=garbage");
  const badLimit = await get(`?limit=${STOCK_ENTRY_PAGE_MAX + 1}`);
  check("(i) a malformed cursor and an over-cap limit are 400", badBefore.status === 400 && badLimit.status === 400, badBefore);

  // (j) delete a wastage.
  const qtyBeforeJ = await qtyOf(milk);
  const j1 = await del(aId);
  const rawJ = await byRef(aRef);
  check("(j) DELETE waste is 200 and gives the stock back exactly", j1.status === 200 && (await qtyOf(milk)) === (qtyBeforeJ ?? 0) + 2500, j1);
  check("(j) raw entry is soft-deleted with who and when", rawJ?.deletedAt instanceof Date && rawJ?.deletedBy === "Live leg admin");
  const j2 = await del(aId);
  check("(j) a second DELETE is 404 and moves nothing", j2.status === 404 && (await qtyOf(milk)) === (qtyBeforeJ ?? 0) + 2500, j2);
  check("(j) the deleted entry is gone from the list", !pageOf(await get()).rows.some((r) => r.id === aId));
  const j3 = await del("not-an-id");
  check("(j) a malformed id is 404", j3.status === 404, j3);

  // (k) two concurrent deletes reverse once.
  const kBody = wasteBody(sugar, 1000);
  const kId = String(dataOf(await post(kBody)).id);
  const qtyBeforeK = await qtyOf(sugar);
  const kBoth = await Promise.all([del(kId), del(kId)]);
  const kStatuses = kBoth.map((r) => r.status).sort();
  check("(k) concurrent DELETEs: one 200 and one 404, reversed once", kStatuses[0] === 200 && kStatuses[1] === 404 && (await qtyOf(sugar)) === (qtyBeforeK ?? 0) + 1000, kBoth[0]);

  // (l) delete a count moves stock back by its delta.
  const qtyBeforeL = await qtyOf(milk);
  const l = await del(eId);
  check("(l) DELETE count moves the stock back by its change (-1250)", l.status === 200 && (await qtyOf(milk)) === (qtyBeforeL ?? 0) - 1250, l);

  // (m) two concurrent same-ref wastes land once.
  const mBody = wasteBody(sugar, 400);
  const qtyBeforeM = await qtyOf(sugar);
  const mBoth = await Promise.all([post(mBody), post(mBody)]);
  const mStatuses = mBoth.map((r) => r.status).sort();
  check("(m) concurrent same-ref POSTs: one 201 and one 200, one entry, stock moved once", mStatuses[0] === 200 && mStatuses[1] === 201 && (await countRef(String(mBody.clientRef))) === 1 && (await qtyOf(sugar)) === (qtyBeforeM ?? 0) - 400, mBoth[0]);

  // (n) staff cannot delete.
  const nRef = String(mBody.clientRef);
  const nId = String((await byRef(nRef))?._id);
  as("staff");
  const n = await del(nId);
  check("(n) staff DELETE is 403 and the entry is untouched", n.status === 403 && !has(await byRef(nRef), "deletedAt"), n);
  as("admin");

  // (o) stock may go below zero.
  const thin = await seedItem("Thin", "pcs", 1000);
  const o = await post(wasteBody(thin, 3000));
  check("(o) waste past zero is 201 and the stock goes negative", o.status === 201 && (await qtyOf(thin)) === -2000, o);
  await runCountLegs({ post, seedItem, countBody, check }); // (p) and (q): a count never applies twice
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
  console.log(`\nInventory lite Slice 4 stock-entries leg: live against ${DB_NAME}\n`);

  try {
    await runCases();
  } finally {
    // Drop ONLY this scratch database, by exact name.
    if (mongoose.connection.name === DB_NAME) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
