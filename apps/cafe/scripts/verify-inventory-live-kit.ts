/**
 * Harness of verify-inventory-live.ts (ops CLI support module, not app code): the seed (StockItem through its model,
 * `Product.stockUse` by a raw `$set` + `cache.del("products")`), RAW readers of stock qty and `stockUsed`, the
 * POS call shapes (use-pos-tab buildCreatePayload / settlePayload over JSON), and the settle-CAS race gate.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import cache from "@/lib/cache";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";
import { StockItem } from "@/models/StockItem";
import type { Api, Line, Rec, Res } from "./reward-card-use-live-kit";

export const MILLI = 1000; // STOCK_QTY_SCALE: 1 unit of the item's own unit
export const MILK_START = 10 * MILLI; // 10 L
export const SUGAR_START = 5 * MILLI; // 5 kg
export const CHIPS_START = 50 * MILLI; // 50 pcs
export const CHAI_MILK = 150; // 150 ml of an L item
export const CHAI_MILK_LARGE = 250;
export const CHAI_SUGAR = 10; // 10 g of a kg item
export const INT32_EDGE = 2 ** 31;
export const PRICE = { chaiRegular: 20, chaiLarge: 30, chips: 10, water: 15 };
export const REASON = "customer left";
export const RACE_WAIT_MS = 5_000; // the race gate opens on its own if a racer never reaches the CAS (no hang)

export type ItemKey = "milk" | "sugar" | "chips";
export type Stock = Record<ItemKey, number>;
export interface World { ids: Record<ItemKey, mongoose.Types.ObjectId>; chai: string; chips: string; water: string }
export const seedItem = async (name: string, unit: string, qty: number) => (await StockItem.create({ name, unit, qty }))._id as mongoose.Types.ObjectId;
export async function setRecipe(productId: string, stockUse: unknown[]): Promise<void> {
  await Product.collection.updateOne({ _id: new mongoose.Types.ObjectId(productId) }, { $set: { stockUse } });
  cache.del("products");
}
export const chaiRecipe = (w: World) => [{ itemId: w.ids.milk, qty: CHAI_MILK, sizes: [{ name: "Large", qty: CHAI_MILK_LARGE }] }, { itemId: w.ids.sugar, qty: CHAI_SUGAR }];

export async function seed(): Promise<World> {
  const cat = await Category.create({ name: "Menu", order: 1 });
  const mk = async (name: string, price: number, extra: Rec = {}) =>
    String((await Product.create({ name, categoryId: cat._id, price, discount: 0, available: true, isActive: true, image: "", modifiers: [], ...extra }))._id);
  const ids = { milk: await seedItem("Milk", "L", MILK_START), sugar: await seedItem("Sugar", "kg", SUGAR_START), chips: await seedItem("Chips", "pcs", CHIPS_START) };
  const chai = await mk("Chai", PRICE.chaiRegular, { variations: [{ name: "Regular", price: PRICE.chaiRegular }, { name: "Large", price: PRICE.chaiLarge }] });
  const w: World = { ids, chai, chips: await mk("Chips", PRICE.chips), water: await mk("Water", PRICE.water) };
  await setRecipe(chai, chaiRecipe(w));
  await setRecipe(w.chips, [{ itemId: ids.chips, qty: MILLI }]);
  return w;
}

export async function stock(w: World): Promise<Stock> {
  const out = {} as Stock;
  for (const key of Object.keys(w.ids) as ItemKey[]) {
    const row = await StockItem.collection.findOne({ _id: w.ids[key] });
    assert.ok(row, `landmark: stock item ${key} exists`);
    out[key] = row.qty as number;
  }
  return out;
}
export const setQty = (w: World, key: ItemKey, qty: number | mongoose.mongo.Int32) => StockItem.collection.updateOne({ _id: w.ids[key] }, { $set: { qty } });
/** The stored BSON type of an item's qty ("int" for every real row under 2^31; "long" once an $inc promotes it). */
export async function qtyBsonType(w: World, key: ItemKey): Promise<string | undefined> {
  for (const type of ["int", "long", "double"]) {
    if (await StockItem.collection.countDocuments({ _id: w.ids[key], qty: { $type: type } })) return type;
  }
  return undefined;
}
export const assertMoved = (before: Stock, after: Stock, delta: Partial<Stock>, what: string): void =>
  (Object.keys(before) as ItemKey[]).forEach((k) => assert.equal(after[k], before[k] + (delta[k] ?? 0), `${what}: ${k} must be ${before[k]} + ${delta[k] ?? 0}, got ${after[k]}`));
/** The raw stockUsed as [{itemId, qty}] in stored order (undefined = no key on the doc). */
export const usedOf = (doc: Rec) => ("stockUsed" in doc ? (doc.stockUsed as Rec[]).map((l) => ({ itemId: String(l.itemId), qty: l.qty as number })) : undefined);
/** What the plan says a sale took out: summed per item, sorted by itemId. */
export const expectUsed = (w: World, by: Partial<Stock>) =>
  (Object.keys(by) as ItemKey[]).map((k) => ({ itemId: String(w.ids[k]), qty: by[k]! })).sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
export function assertNoStockUsed(doc: Rec, status: string, what: string): void {
  assert.equal(doc.status, status, `landmark: ${what} is ${status}`);
  assert.equal("stockUsed" in doc, false, `${what}: the raw doc must carry no stockUsed key`);
}
export const ok = (res: Res, status: number, what: string) => assert.equal(res.status, status, `${what}: got ${res.status} ${res.body.error ?? ""}`);

export const ln = (productId: string, name: string, price: number, qty: number, variation?: string): Line & Rec =>
  ({ productId, name, price, qty, ...(variation ? { variation } : {}), modifiers: [] });
export const chaiR = (w: World, qty = 1) => ln(w.chai, "Chai", PRICE.chaiRegular, qty, "Regular");
export const chaiL = (w: World, qty = 1) => ln(w.chai, "Chai", PRICE.chaiLarge, qty, "Large");
export const chipsLn = (w: World, qty: number) => ln(w.chips, "Chips", PRICE.chips, qty);
/** use-pos-tab buildCreatePayload over JSON (undefined keys drop): an open tab, or Pay Now (paidAmount omitted = full). */
export function createBody(lines: Line[], payNow = false): Rec {
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const base = { customerName: "Walk-In", items: lines, subtotal: total, discount: 0, discountKind: null, gstAmount: 0, extraCharges: [], total, receiver: "Live leg", idemKey: randomUUID() };
  return payNow ? { ...base, status: "Completed", payment: "Cash" } : { ...base, paidAmount: 0, payment: "Unpaid", status: "Pending" };
}
/** use-pos-tab settlePayload for a full Cash payment (paidAmount omitted), from the tab the POS holds. */
export const settleBody = (tab: Rec): Rec => ({
  payment: "Cash", discount: tab.discount ?? 0, discountKind: null, extraCharges: [], total: tab.total,
  expectedTotal: tab.total, expectedVoids: ((tab.voids as unknown[] | undefined) ?? []).length, expectedTableNo: null,
});
export async function openTab(api: Api, lines: Line[]): Promise<Rec> {
  const res = await api.create(createBody(lines));
  ok(res, 201, "fixture: the counter create opens the tab");
  return res.body.data!;
}
export async function settled(api: Api, lines: Line[]): Promise<Rec> {
  const tab = await openTab(api, lines);
  ok(await api.settle(String(tab._id), settleBody(tab)), 200, "the settle lands");
  return tab;
}

export type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
export async function call(handler: Handler, method: string, url: string, id = ""): Promise<Res> {
  const res = await handler(new Request(`http://127.0.0.1${url}`, { method, headers: { host: "127.0.0.1" } }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Res["body"] };
}

/** Holds the settle CAS (filter status Pending on this id) until both racers reached it: both read Pending first. */
export function holdSettleCas(id: string): { arrived: () => number; restore: () => void } {
  let arrived = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const timer = setTimeout(() => open(), RACE_WAIT_MS);
  const model = Order as unknown as { findOneAndUpdate: (f: Rec, ...rest: unknown[]) => { exec: (...a: unknown[]) => Promise<unknown> } };
  const real = model.findOneAndUpdate.bind(Order);
  model.findOneAndUpdate = (filter, ...rest) => {
    const query = real(filter, ...rest);
    if (filter.status !== "Pending" || String(filter._id) !== id) return query;
    const exec = query.exec.bind(query);
    query.exec = async (...a: unknown[]) => {
      arrived += 1;
      if (arrived >= 2) open();
      await gate;
      return exec(...a);
    };
    return query;
  };
  const restore = () => {
    model.findOneAndUpdate = real;
    clearTimeout(timer);
  };
  return { arrived: () => arrived, restore };
}
