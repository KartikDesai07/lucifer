/**
 * Inventory lite, Slice 2 live leg: /api/inventory/items through the REAL route handlers against a real mongod,
 * with `@/lib/auth` swapped for a signed-in stub whose role is switchable (the verify-expenses-live.ts harness).
 * The `stockitems` collection is read and written RAW (an independent path from the routes).
 *
 *   node --import tsx scripts/verify-inventory-items-live.ts
 *
 * SAFETY: refuses any database without the scratch prefix, and only ever drops the ONE database named DB_NAME
 * (by exact name) at start and in finally.
 * (console output is intentional: ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { StockItem } from "@/models/StockItem";
import { STOCK_ITEMS_MAX } from "@pos/shared/inventory";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}inventory_items`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const BODY_PRINT_MAX = 150;
const ROUTE_MISSING_STATUS = 0;
const STAFF_ID = "665f0000000000000000a001";
const ADMIN_ID = "665f0000000000000000a002";
const GHOST = "665f0000000000000000beef"; // a valid ObjectId no row carries
const RAW_BUMP_MILLI = 7;

type Role = "admin" | "staff";
type Body = Record<string, unknown>;
type Res = { status: number; body: { success: boolean; data?: unknown; error?: string } };
type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface RouteModule {
  GET?: Handler;
  POST?: Handler;
  PATCH?: Handler;
}

let currentRole: Role = "admin";

function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({
      user:
        currentRole === "admin"
          ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" }
          : { id: STAFF_ID, name: "Live leg staff", role: "staff" },
    }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
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

const col = () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  return db.collection("stockitems");
};
const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
const stored = (id: string) => col().findOne({ _id: oid(id) });
const rowsOf = (res: Res): Body[] => (Array.isArray(res.body.data) ? (res.body.data as Body[]) : []);
const dataOf = (res: Res): Body => (res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {});
const has = (o: object | null, key: string) => o !== null && key in o;
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

// The exact-name guard: prefix AND the one name this leg owns.
function scratchUri(): string {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}": only ${DB_NAME} (a ${SCRATCH_PREFIX}* database) is allowed.`);
  }
  return uri;
}

async function runCases(): Promise<void> {
  const list = await loadRoute("app/api/inventory/items/route.ts");
  const item = await loadRoute("app/api/inventory/items/[id]/route.ts");
  console.log(`  routes: items ${list ? "loaded" : "MISSING"}, items/[id] ${item ? "loaded" : "MISSING"}`);
  const as = (role: Role) => {
    currentRole = role;
  };
  const get = () => call(list?.GET, req("GET", "/api/inventory/items"));
  const post = (body: unknown) => call(list?.POST, req("POST", "/api/inventory/items", body));
  const patch = (id: string, body: unknown) =>
    call(item?.PATCH, req("PATCH", `/api/inventory/items/${id}`, body), { id });

  // (a) admin create with opening stock and a low line.
  as("admin");
  const a = await post({ name: "Milk", unit: "L", openingQtyMilli: 10000, lowAtMilli: 2000 });
  const milkId = String(dataOf(a).id);
  const rawA = await stored(milkId);
  check("(a) admin POST Milk/L/10000/low 2000 is 201 with a DTO", a.status === 201 && a.body.success === true && dataOf(a).qtyMilli === 10000, a);
  check(
    "(a) raw doc: qty 10000, lowAt 2000, v 1, no archived key",
    rawA?.qty === 10000 && rawA?.lowAt === 2000 && rawA?.v === 1 && !has(rawA, "archived"),
  );

  // (b) no opening stock.
  const b = await post({ name: "Sugar", unit: "kg" });
  const sugarId = String(dataOf(b).id);
  const rawB = await stored(sugarId);
  check("(b) POST without opening: 201, raw qty 0 and no lowAt key", b.status === 201 && rawB?.qty === 0 && !has(rawB, "lowAt"), b);

  // (c) staff reads, never sees the cost.
  await col().updateOne({ _id: oid(milkId) }, { $set: { lastRatePaise: 6000 } });
  as("staff");
  const staffList = await get();
  const staffMilk = rowsOf(staffList).find((r) => r.id === milkId);
  check("(c) staff GET 200 lists the item", staffList.status === 200 && staffMilk !== undefined && rowsOf(staffList).length === 2, staffList);
  check("(c) staff rows have no lastRatePaise KEY (even after a raw $set)", rowsOf(staffList).every((r) => !has(r, "lastRatePaise")));
  as("admin");
  const adminMilk = rowsOf(await get()).find((r) => r.id === milkId);
  check("(c) admin GET has lastRatePaise 6000", adminMilk?.lastRatePaise === 6000);

  // (d) staff cannot write.
  as("staff");
  const dPost = await post({ name: "Tea", unit: "kg" });
  const before = await stored(milkId);
  const dPatch = await patch(milkId, { name: "Hacked" });
  check("(d) staff POST is 403 and nothing is written", dPost.status === 403 && (await col().countDocuments({ name: "Tea" })) === 0, dPost);
  check("(d) staff PATCH is 403 and the doc is unchanged", dPatch.status === 403 && same(await stored(milkId), before), dPatch);
  as("admin");

  // (e) duplicate name, other case.
  const e = await post({ name: "milk", unit: "L" });
  check("(e) POST milk (other case) is 400 duplicate", e.status === 400 && /already exists/.test(e.body.error ?? ""), e);

  // (f) unit and qty are not patchable.
  const rawBefore = await stored(milkId);
  const f1 = await patch(milkId, { unit: "kg" });
  const f2 = await patch(milkId, { qty: 5 });
  check("(f) PATCH unit is 400", f1.status === 400, f1);
  check("(f) PATCH qty is 400", f2.status === 400, f2);
  check("(f) raw doc unchanged", same(await stored(milkId), rawBefore));

  // (g) null clears the low line.
  const g = await patch(milkId, { lowAtMilli: null });
  check("(g) PATCH lowAtMilli null is 200 and the raw doc has no lowAt key", g.status === 200 && !has(await stored(milkId), "lowAt"), g);

  // (h) rename rules.
  const h1 = await patch(milkId, { name: "sugar" });
  const h2 = await patch(milkId, { name: "MILK" });
  check("(h) rename into another active name is 400", h1.status === 400, h1);
  check("(h) rename Milk to MILK on itself is 200", h2.status === 200 && dataOf(h2).name === "MILK", h2);

  // (i) PATCH never touches qty.
  await col().updateOne({ _id: oid(milkId) }, { $inc: { qty: RAW_BUMP_MILLI } });
  const i = await patch(milkId, { name: "Milk" });
  const rawI = await stored(milkId);
  check("(i) a rename keeps the raw $inc'd qty", i.status === 200 && rawI?.qty === 10000 + RAW_BUMP_MILLI && dataOf(i).qtyMilli === 10000 + RAW_BUMP_MILLI, i);

  // (j) archive.
  const j = await patch(milkId, { archived: true });
  check("(j) archive: 200 and raw archived true", j.status === 200 && (await stored(milkId))?.archived === true, j);
  check("(j) GET no longer lists it", !rowsOf(await get()).some((r) => r.id === milkId));
  const j2 = await post({ name: "Milk", unit: "L" });
  check("(j) POST of the archived name now succeeds", j2.status === 201, j2);
  // A sheet left open while another admin archived the item: its save is a 404 and writes nothing (not even updatedAt).
  const archivedBefore = await stored(milkId);
  const j3 = await patch(milkId, { lowAtMilli: 3000 });
  const j4 = await patch(milkId, { archived: true });
  check("(j) PATCH of an archived item is 404 and its raw doc is unchanged", j3.status === 404 && j4.status === 404 && same(await stored(milkId), archivedBefore), j3);

  // (k) bad ids and empty bodies.
  const k1 = await patch(GHOST, { name: "X" });
  const k2 = await patch("not-an-id", { name: "X" });
  const k3 = await patch(sugarId, {});
  check("(k) PATCH unknown id is 404", k1.status === 404, k1);
  check("(k) PATCH malformed id is 404", k2.status === 404, k2);
  check("(k) PATCH {} is 400", k3.status === 400, k3);

  // (l) the cap counts active items only.
  await col().deleteMany({});
  const now = new Date();
  await col().insertMany(
    Array.from({ length: STOCK_ITEMS_MAX }, (_, n) => ({ name: `Bulk ${n}`, unit: "pcs", qty: 0, v: 1, createdAt: now, updatedAt: now })),
  );
  const l1 = await post({ name: "One too many", unit: "pcs" });
  check(`(l) POST at ${STOCK_ITEMS_MAX} active items is 400 limit`, l1.status === 400 && /at most/.test(l1.body.error ?? ""), l1);
  await col().updateOne({ name: "Bulk 0" }, { $set: { archived: true } });
  const l2 = await post({ name: "One more", unit: "pcs" });
  check("(l) an archived item does not count: POST succeeds", l2.status === 201, l2);

  // (m) a fractional milli quantity is refused.
  await col().deleteMany({});
  const m = await post({ name: "Flour", unit: "kg", openingQtyMilli: 1.5 });
  check("(m) POST openingQtyMilli 1.5 is 400 and nothing is written", m.status === 400 && (await col().countDocuments()) === 0, m);
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
  console.log(`\nInventory lite Slice 2 stock-items leg: live against ${DB_NAME}\n`);

  try {
    await StockItem.createIndexes(); // the drop removed them
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
