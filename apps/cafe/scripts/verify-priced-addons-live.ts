/**
 * Priced add-ons live leg (owner, 2026-11-02) — drives the REAL route handlers against a real mongod:
 * POST /api/orders, POST /api/orders/[id]/items, POST /api/public/order-request, POST /api/order-requests/[id]/accept,
 * POST /api/products, PUT /api/products/[id], POST /api/products/import. Only what a script cannot have is swapped:
 * `@/lib/auth` (a signed-in admin), `botid/server` (never a bot), `next/headers` (no diner cookie) and `next/server`'s
 * `after` (needs a Next request scope). Validators, menu re-check, stamps, drift check and writes are the product's own.
 * Proves what the DB-free tests cannot: the stamp lands on disk (raw document, no _id, sorted, omit-empty), the $unset /
 * $pull write shapes, and the accept drift rejection. Every case runs; a case PASSES when all its checks did.
 *
 *   npm run verify:priced-addons:live
 *
 * SAFETY: refuses any database not named pos_scratch_*, drops the whole scratch database at start and at the end (also
 * on failure). (console output is intentional — this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { Product } from "@/models/Product";
import { PublicRateLimit } from "@/models/PublicRateLimit";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { PRICE_DRIFT_ERROR } from "@/lib/public-pricing";
import { ADD_ON_PRICES_TICKED_ERROR } from "@pos/shared/modifier-prices";
import { ensureCategoryId } from "./verify-shared/ensure-category";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}priced_addons`;
const ADMIN_ID = "665f0000000000000000beef";
const MOBILE = "9876543210";

type Rec = Record<string, unknown>;
type Res = { status: number; body: { success: boolean; data?: Rec; error?: string } };
type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function installStubs(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({ user: { id: ADMIN_ID, name: "Live leg", role: "admin" } }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const real = loader._load;
  loader._load = function (this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (request === "botid/server") return { checkBotId: async () => ({ isBot: false }) };
    if (request === "next/headers") return { cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) };
    const loaded = real.call(this, request, parent, isMain);
    if (request === "next/server") return { ...(loaded as Rec), after: () => undefined };
    return loaded;
  };
}
installStubs();

// ── case runner ──
const results: { name: string; ok: boolean }[] = [];
let caseOk = true;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) caseOk = false;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail !== undefined ? ` -- got ${JSON.stringify(detail)}` : ""}`);
}
async function runCase(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  caseOk = true;
  try {
    await fn();
  } catch (e) {
    caseOk = false;
    console.log(`  FAIL threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  results.push({ name, ok: caseOk });
  console.log(`  => ${caseOk ? "PASS" : "FAIL"}  ${name}`);
}

// ── the routes' exact call shapes ──
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, url: string, body: unknown): Request =>
  new Request(`http://127.0.0.1${url}`, { method, headers: { "content-type": "application/json", host: "127.0.0.1" }, body: JSON.stringify(body) });
async function answer(pending: Promise<Response>): Promise<Res> {
  const res = await pending;
  return { status: res.status, body: (await res.json()) as Res["body"] };
}
interface Api {
  create: (body: Rec) => Promise<Res>;
  addRound: (id: string, body: Rec) => Promise<Res>;
  submitQr: (body: Rec) => Promise<Res>;
  accept: (requestId: string) => Promise<Res>;
  postProduct: (body: Rec) => Promise<Res>;
  putProduct: (id: string, body: Rec) => Promise<Res>;
  importCsv: (rows: Rec[]) => Promise<Res>;
}
async function loadApi(): Promise<Api> {
  const orders = await import("@/app/api/orders/route");
  const items = await import("@/app/api/orders/[id]/items/route");
  const pub = await import("@/app/api/public/order-request/route");
  const accept = await import("@/app/api/order-requests/[id]/accept/route");
  const products = await import("@/app/api/products/route");
  const product = await import("@/app/api/products/[id]/route");
  const imp = await import("@/app/api/products/import/route");
  const at = (h: Handler, method: string, url: string, id: string, body: unknown) => answer(h(jsonReq(method, url, body), idp(id)));
  return {
    create: (body) => answer(orders.POST(jsonReq("POST", "/api/orders", body))),
    addRound: (id, body) => at(items.POST, "POST", `/api/orders/${id}/items`, id, body),
    submitQr: async (body) => {
      await PublicRateLimit.deleteMany({});
      return answer(pub.POST(jsonReq("POST", "/api/public/order-request", body)));
    },
    accept: (requestId) => at(accept.POST, "POST", `/api/order-requests/${requestId}/accept`, requestId, {}),
    postProduct: (body) => answer(products.POST(jsonReq("POST", "/api/products", body))),
    putProduct: (id, body) => at(product.PUT, "PUT", `/api/products/${id}`, id, body),
    importCsv: (rows) => answer(imp.POST(jsonReq("POST", "/api/products/import", { dryRun: false, rows }))),
  };
}

// ── fixtures ──
const PIZZA_MODS = ["Cheese Burst", "Olives", "Jalapeno"];
const PIZZA_PRICES = [{ name: "Cheese Burst", price: 100 }, { name: "Olives", price: 30 }];
const STAMP_BOTH = [{ name: "Cheese Burst", price: 100 }, { name: "Olives", price: 30 }];
const BASE = 225; // 250 less 10%
let pizzaId = "";
const line = (price: number, modifiers: string[], extra: Rec = {}): Rec => ({ productId: pizzaId, name: "Pizza", price, qty: 1, modifiers, ...extra });
const orderBody = (items: Rec[]): Rec => {
  const sum = items.reduce((s, l) => s + (l.price as number) * (l.qty as number), 0);
  return { customerName: "Addon leg", items, subtotal: sum, discount: 0, total: sum, paidAmount: 0, payment: "Unpaid", status: "Pending", receiver: "Live leg" };
};
const roundBody = (items: Rec[]): Rec => ({ items, discount: 0, discountKind: null, extraCharges: [] });
const qrBody = (modifiers: string[]): Rec => ({ target: { kind: "parcel" }, items: [{ productId: pizzaId, modifiers, qty: 1 }], name: "Addon Diner", mobile: MOBILE });
const rawOrder = async (id: unknown): Promise<Rec> => ((await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(String(id)) })) ?? {}) as Rec;
const rawProduct = async (id: string): Promise<Rec> => ((await Product.collection.findOne({ _id: new mongoose.Types.ObjectId(id) })) ?? {}) as Rec;
const itemsOf = (o: Rec): Rec[] => (o.items ?? []) as Rec[];
const orderCount = () => Order.collection.countDocuments({});
const same = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const resetPizza = () => api.putProduct(pizzaId, { modifiers: PIZZA_MODS, modifierPrices: PIZZA_PRICES });
let api: Api;
let categoryId = "";

async function case1(): Promise<void> {
  const res = await api.create(orderBody([line(355, ["Olives", "Cheese Burst"])]));
  const stored = itemsOf(await rawOrder(res.body.data?._id))[0] ?? {};
  check("POS create: Olives + Cheese Burst at 355 (225 + 130) -> 201", res.status === 201, res.status);
  check("stored line price is 355", stored.price === 355, stored.price);
  check("stored modifierPrices is exactly [Cheese Burst 100, Olives 30] (sorted, raw, no _id)", same(stored.modifierPrices, STAMP_BOTH), stored.modifierPrices);
  const free = await api.create(orderBody([line(BASE, ["Jalapeno"])]));
  const freeLine = itemsOf(await rawOrder(free.body.data?._id))[0] ?? {};
  check("a Jalapeno-only line at 225 -> 201 and stores NO modifierPrices key", free.status === 201 && freeLine.price === BASE && !Object.hasOwn(freeLine, "modifierPrices"), [free.status, freeLine]);
}

async function case2(): Promise<void> {
  const before = await orderCount();
  const res = await api.create(orderBody([line(BASE, ["Olives", "Cheese Burst"])]));
  check("same pick at the base-only price 225 -> 409", res.status === 409, res.status);
  check("the refusal says \"Price changed\"", (res.body.error ?? "").includes("Price changed"), res.body.error);
  check("nothing written (order count unchanged)", (await orderCount()) === before);
}

async function case3(): Promise<void> {
  const res = await api.create(orderBody([line(BASE + 100, ["Cheese Burst"], { modifierPrices: [{ name: "Cheese Burst", price: 0 }] })]));
  const stored = itemsOf(await rawOrder(res.body.data?._id))[0] ?? {};
  check("client-sent modifierPrices [Cheese Burst 0] at the right price 325 -> 201", res.status === 201, [res.status, res.body.error]);
  check("the stored stamp is the server's (Cheese Burst 100), not the client's 0", same(stored.modifierPrices, [{ name: "Cheese Burst", price: 100 }]), stored.modifierPrices);
}

async function case4(): Promise<void> {
  const tab = await api.create(orderBody([line(BASE, ["Jalapeno"])]));
  const id = String(tab.body.data?._id);
  check("fixture: the open tab is created (201)", tab.status === 201, tab.status);
  const bad = await api.addRound(id, roundBody([line(BASE, ["Olives", "Cheese Burst"])]));
  const afterBad = itemsOf(await rawOrder(id));
  check("round with the base-only price 225 -> 409 and no line added", bad.status === 409 && afterBad.length === 1, [bad.status, afterBad.length]);
  const ok = await api.addRound(id, roundBody([line(355, ["Olives", "Cheese Burst"])]));
  const lines = itemsOf(await rawOrder(id));
  check("round with the priced pick at 355 -> 200 and a second line is stored", ok.status === 200 && lines.length === 2, [ok.status, ok.body.error, lines.length]);
  check("the new line is stamped [Cheese Burst 100, Olives 30]", same(lines[1]?.modifierPrices, STAMP_BOTH), lines[1]?.modifierPrices);
  check("the first (Jalapeno) line still has no modifierPrices key", !Object.hasOwn(lines[0] ?? {}, "modifierPrices"));
}

async function case5(): Promise<void> {
  const res = await api.submitQr(qrBody(["Cheese Burst"]));
  check("QR request with Cheese Burst -> 201", res.status === 201, [res.status, res.body.error]);
  const request = ((await OrderRequest.collection.findOne({ shortCode: res.body.data?.shortCode })) ?? {}) as Rec;
  const reqLine = itemsOf(request)[0] ?? {};
  check("stored request line price is 325 (225 + 100)", reqLine.price === 325, reqLine.price);
  check("stored request line carries the stamp [Cheese Burst 100]", same(reqLine.modifierPrices, [{ name: "Cheese Burst", price: 100 }]), reqLine.modifierPrices);
  check("the quoted total includes the add-on (325, GST off)", res.body.data?.total === 325 && request.quotedTotal === 325, [res.body.data?.total, request.quotedTotal]);
  const accepted = await api.accept(String(request._id));
  const order = (accepted.body.data?.order ?? {}) as Rec;
  const orderLine = itemsOf(await rawOrder(order._id))[0] ?? {};
  check("staff accept -> 200", accepted.status === 200, [accepted.status, accepted.body.error]);
  check("the accepted order line carries price 325 and the stamp", orderLine.price === 325 && same(orderLine.modifierPrices, [{ name: "Cheese Burst", price: 100 }]), orderLine);

}

async function case6(): Promise<void> {
  const second = await api.submitQr(qrBody(["Cheese Burst"]));
  check("fixture: a second request is pending", second.status === 201, second.status);
  const moved = await api.putProduct(pizzaId, { modifierPrices: [{ name: "Cheese Burst", price: 120 }, { name: "Olives", price: 30 }] });
  check("admin PUT Cheese Burst 100 -> 120 -> 200", moved.status === 200, [moved.status, moved.body.error]);
  const secondDoc = ((await OrderRequest.collection.findOne({ shortCode: second.body.data?.shortCode })) ?? {}) as Rec;
  const drift = await api.accept(String(secondDoc._id));
  check("accept rejects with the PRICE_DRIFT_ERROR message", drift.body.success === false && drift.body.error === PRICE_DRIFT_ERROR, [drift.status, drift.body.error]);
  check("...and wrote no order for it", (await Order.collection.countDocuments({ sourceRequestIds: secondDoc._id })) === 0);
  await resetPizza();
}

async function case7(): Promise<void> {
  const created = await api.postProduct({ name: "Tea Ticked", categoryId, price: 50, modifiers: ["Sugar"], modifiersPreselected: true, modifierPrices: [{ name: "Sugar", price: 5 }] });
  check("POST a product with modifiersPreselected + modifierPrices -> 400 (ticked error)", created.status === 400 && created.body.error === ADD_ON_PRICES_TICKED_ERROR, [created.status, created.body.error]);
  check("...and the product was not created", (await Product.collection.countDocuments({ name: "Tea Ticked" })) === 0);
  const before = await rawProduct(pizzaId);
  check("landmark: Pizza is stored with its two amounts", same(before.modifierPrices, PIZZA_PRICES), before.modifierPrices);
  const bare = await api.putProduct(pizzaId, { modifiersPreselected: true });
  check("bare PUT { modifiersPreselected: true } on the priced Pizza -> 400", bare.status === 400 && bare.body.error === ADD_ON_PRICES_TICKED_ERROR, [bare.status, bare.body.error]);
  const frac = await api.putProduct(pizzaId, { modifierPrices: [{ name: "Olives", price: 99.5 }] });
  check("a modifierPrices entry 99.5 -> 400", frac.status === 400, frac.status);
  const after = await rawProduct(pizzaId);
  check("the DB document is unchanged by both refusals", same(after, before));
  const burger = await Product.create({ name: "Burger", categoryId, price: 80, modifiers: ["Cheese"], modifierPrices: [{ name: "Cheese", price: 20 }] });
  const cleared = await api.putProduct(String(burger._id), { modifierPrices: null });
  const burgerDoc = await rawProduct(String(burger._id));
  check("PUT { modifierPrices: null } -> 200", cleared.status === 200, [cleared.status, cleared.body.error]);
  check("the field is ABSENT in the DB (not null, not [])", !Object.hasOwn(burgerDoc, "modifierPrices") && burgerDoc.name === "Burger", burgerDoc);
}

async function case8(): Promise<void> {
  const before = await orderCount();
  const pos = await api.create(orderBody([line(BASE + 200, ["Cheese Burst", "Cheese Burst"])]));
  check("POS create with [Cheese Burst, Cheese Burst] -> 400", pos.status === 400, [pos.status, pos.body.error]);
  check("...and nothing written", (await orderCount()) === before);
  const requests = await OrderRequest.collection.countDocuments({});
  const qr = await api.submitQr(qrBody(["Cheese Burst", "Cheese Burst"]));
  check("QR request with [Cheese Burst, Cheese Burst] -> 400", qr.status === 400, [qr.status, qr.body.error]);
  check("...and no request stored", (await OrderRequest.collection.countDocuments({})) === requests);
}

async function case9(): Promise<void> {
  const edit = await api.putProduct(pizzaId, { modifiers: ["Olives", "Jalapeno"], modifierPrices: [{ name: "Olives", price: 30 }] });
  const doc = await rawProduct(pizzaId);
  check("admin PUT drops Cheese Burst from modifiers and modifierPrices -> 200", edit.status === 200 && !(doc.modifiers as string[]).includes("Cheese Burst"), [edit.status, edit.body.error, doc.modifiers]);
  const before = await orderCount();
  const res = await api.create(orderBody([line(325, ["Cheese Burst"])]));
  check("a POS line still carrying Cheese Burst at the old price -> 409", res.status === 409, [res.status, res.body.error]);
  check("the message contains \"Add-on no longer on the menu: Cheese Burst (Pizza)\"", (res.body.error ?? "").includes("Add-on no longer on the menu: Cheese Burst (Pizza)"), res.body.error);
  check("nothing written", (await orderCount()) === before);
  await resetPizza();
}

async function case10(): Promise<void> {
  const pre = await rawProduct(pizzaId);
  check("landmark: Pizza is back to all three add-ons and both amounts", same(pre.modifierPrices, PIZZA_PRICES) && (pre.modifiers as string[]).length === 3, pre);
  const re = await api.importCsv([{ name: "Pizza", category: "Pizza", price: "250", discount: "10", modifiers: "Olives|Jalapeno", isActive: "true" }]);
  const doc = await rawProduct(pizzaId);
  check("(a) re-import of Pizza with modifiers Olives|Jalapeno -> 200, updated 1", re.status === 200 && re.body.data?.updated === 1, [re.status, re.body.error, re.body.data]);
  check("(a) stored modifiers are [Olives, Jalapeno]", same(doc.modifiers, ["Olives", "Jalapeno"]), doc.modifiers);
  check("(a) modifierPrices keeps Olives 30 and loses Cheese Burst ($pull)", same(doc.modifierPrices, [{ name: "Olives", price: 30 }]), doc.modifierPrices);
  const fresh = await api.importCsv([{ name: "Import Fresh", category: "Import Cat", price: "60", modifiers: "A|B", isActive: "true" }]);
  const freshDoc = ((await Product.collection.findOne({ name: "Import Fresh" })) ?? {}) as Rec;
  check("(b) a NEW product via import (upsert insert) -> 200, created 1 ($pull on insert did not error)", fresh.status === 200 && fresh.body.data?.created === 1, [fresh.status, fresh.body.error, fresh.body.data]);
  check("(b) the new product exists with its modifiers and has NO modifierPrices key", same(freshDoc.modifiers, ["A", "B"]) && !Object.hasOwn(freshDoc, "modifierPrices"), freshDoc);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" - the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  delete process.env.TENANT_ID; // the public route's host gate: a bare loopback host is the "dev" tenant
  process.env.MONGODB_URI = uri;
  await connectDB();
  try {
    await mongoose.connection.dropDatabase();
    console.log(`\nPriced add-ons - live against ${dbName}`);
    await getSettings(); // the default Settings row (GST off, selfOrderMode approve)
    invalidateSettingsCache();
    const cat = await ensureCategoryId("Pizza");
    categoryId = String(cat);
    const pizza = await Product.create({ name: "Pizza", categoryId: cat, price: 250, discount: 10, modifiers: PIZZA_MODS, modifierPrices: PIZZA_PRICES });
    pizzaId = String(pizza._id);
    api = await loadApi();
    await runCase("Case 1 - POS create stamps the priced picks", case1);
    await runCase("Case 2 - base-only price is refused (409), nothing written", case2);
    await runCase("Case 3 - a client-sent modifierPrices is replaced by the server's stamp", case3);
    await runCase("Case 4 - add-round (POST /api/orders/[id]/items) stamps / refuses", case4);
    await runCase("Case 5 - QR request is priced and stamped, accept carries it", case5);
    await runCase("Case 6 - amount moved between request and accept rejects (PRICE_DRIFT_ERROR)", case6);
    await runCase("Case 7 - product write rules and the null clear", case7);
    await runCase("Case 8 - a repeated modifier is refused on POS and QR", case8);
    await runCase("Case 9 - an add-on removed from the menu is refused (409)", case9);
    await runCase("Case 10 - CSV import $pull and upsert-insert", case10);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} cases passed, ${failed.length} failed${failed.length ? `: ${failed.map((r) => r.name).join("; ")}` : ""}\n`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
