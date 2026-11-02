/**
 * KOT kitchen order live leg. Drives the REAL route handlers (PATCH + POST /api/categories, PUT /api/products/[id],
 * POST /api/orders, POST /api/orders/[id]/items, POST /api/order-requests/[id]/accept) against a real mongod, with only
 * `@/lib/auth` swapped for an ADMIN stub (verify-kitchen-order-live-kit.ts), so every leg runs the routes' exact
 * validators and writes. Requests carry the print-agent headers a POS tab sends, so the routes make PrintJobs we read.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_kitchenorder node --import tsx scripts/verify-kitchen-order-live.ts
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, drops the whole scratch database at start and end
 * (also on failure), prints pass/fail only. (console output is intentional - this is an ops CLI script.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Table } from "@/models/Table";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order as OrderDto } from "@/types";
import { baseResetMinutes } from "./verify-token-live-clock";
import {
  DEFAULT_URI, SCRATCH_PREFIX, answer, categoryRanks, check, hasRank, idp, kotJobNames, leg, legResults, lineOf, linesOf,
  menuOrders, rankOf, request, stageRequest, stubAuth, type Dish,
} from "./verify-kitchen-order-live-kit";

stubAuth();

const CAT = { bev: "665f0000000000000000c101", food: "665f0000000000000000c102", dessert: "665f0000000000000000c103" };
const D = {
  mojito: { _id: "665f0000000000000000a201", name: "Mojito", price: 90 },
  water: { _id: "665f0000000000000000a202", name: "Water", price: 20 },
  pizza: { _id: "665f0000000000000000a203", name: "Pizza", price: 200 },
  chips: { _id: "665f0000000000000000a204", name: "Chips", price: 60 },
  brownie: { _id: "665f0000000000000000a205", name: "Brownie", price: 120 },
  crisps: { _id: "665f0000000000000000a206", name: "Crisps", price: 40 },
} satisfies Record<string, Dish>;
const KITCHEN_IDS = [CAT.bev, CAT.food, CAT.dessert]; // the admin's Kitchen order: Beverages, Food, Dessert

async function loadRoutes() {
  return {
    categories: await import("@/app/api/categories/route"),
    product: await import("@/app/api/products/[id]/route"),
    create: await import("@/app/api/orders/route"),
    items: await import("@/app/api/orders/[id]/items/route"),
    accept: await import("@/app/api/order-requests/[id]/accept/route"),
  };
}
let r: Awaited<ReturnType<typeof loadRoutes>>;

type OrderOut = { _id: string; orderId: string; kotRounds?: number };
function create(lines: Array<ReturnType<typeof lineOf>>) {
  const sum = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const payload = { customerName: "Kitchen order leg", items: lines, subtotal: sum, total: sum, receiver: "Live leg", payment: "Unpaid", status: "Pending" };
  return answer<OrderOut>(r.create.POST(request("POST", "/api/orders", payload)));
}
const addRound = (id: string, lines: Array<ReturnType<typeof lineOf>>) =>
  answer<OrderOut>(r.items.POST(request("POST", `/api/orders/${id}/items`, { items: lines }), idp(id)));
const accept = (id: string) => answer<{ order: OrderOut }>(r.accept.POST(request("POST", `/api/order-requests/${id}/accept`), idp(id)));
const patchCats = (body: unknown) => answer<unknown>(r.categories.PATCH(request("PATCH", "/api/categories", body)));
const canon = (v: unknown): string => JSON.stringify(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
const same = (a: unknown, b: unknown) => canon(a) === canon(b); // name->number maps: key order is the DB natural order, so compare sorted
const names = (xs: string[]) => xs.join(",");

async function setup(): Promise<void> {
  // Menu order differs from the Kitchen order we save later: Food 0, Beverages 1, Dessert 2.
  await Category.create([{ _id: CAT.food, name: "Food", order: 0 }, { _id: CAT.bev, name: "Beverages", order: 1 }, { _id: CAT.dessert, name: "Dessert", order: 2 }]);
  await Product.create([
    { ...D.mojito, categoryId: CAT.bev }, { ...D.water, categoryId: CAT.bev, noKot: true }, { ...D.pizza, categoryId: CAT.food },
    { ...D.chips, categoryId: CAT.food }, { ...D.brownie, categoryId: CAT.dessert },
  ]);
  await Table.create([{ tableNo: "T-K1", capacity: 4, status: "Available" }]);
  check("landmark: 3 categories, 5 products and Water stored noKot:true", (await Category.countDocuments()) === 3 && (await Product.countDocuments()) === 5 && (await Product.countDocuments({ noKot: true })) === 1);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) throw new Error(`Refusing to run against "${dbName}" - scratch (${SCRATCH_PREFIX}*) databases only.`);
  process.env.MONGODB_URI = uri;
  r = await loadRoutes();
  await connectDB();
  try {
    await mongoose.connection.dropDatabase();
    await Promise.all([Order.createIndexes(), PrintJob.createIndexes()]);
    await Settings.create({ kotShowNumber: true, kotNumberStart: 1, tokenEnabled: false, gstEnabled: false, gstRate: 5, numberResetMinutes: baseResetMinutes() });
    invalidateSettingsCache();
    console.log(`\nKOT kitchen order - live against ${dbName}`);
    await leg("setup: the menu (Food 0, Beverages 1, Dessert 2), Water skips the kitchen", setup);
    await leg("(a) Kitchen order NOT set: POST create lines carry no kotRank key, KOT in the order added", async () => {
      const res = await create([lineOf(D.pizza), lineOf(D.mojito)]);
      const id = String(res.body.data?._id);
      const lines = await linesOf(id);
      check("landmark: 201 and both lines stored", res.status === 201 && lines.length === 2);
      check("no stored line has a kotRank key", !lines.some((l) => hasRank(l)));
      check("the KOT job lists Pizza, Mojito (as added)", names(await kotJobNames(id, 1)) === "Pizza,Mojito");
    });
    await leg("(b) PATCH {ids, list:kitchen} sets kotOrder only; a menu PATCH leaves kotOrder alone", async () => {
      const menuBefore = await menuOrders();
      const res = await patchCats({ ids: KITCHEN_IDS, list: "kitchen" });
      check("landmark: 200 and kotOrder is Beverages 0, Food 1, Dessert 2", res.status === 200 && same(await categoryRanks(), { Food: 1, Beverages: 0, Dessert: 2 }));
      check("the menu `order` values are untouched", same(await menuOrders(), menuBefore) && same(menuBefore, { Food: 0, Beverages: 1, Dessert: 2 }));
      const menu = await patchCats({ ids: [CAT.dessert, CAT.food, CAT.bev] });
      check("landmark: a menu PATCH 200 re-ordered `order` (Dessert 0, Food 1, Beverages 2)", menu.status === 200 && same(await menuOrders(), { Food: 1, Beverages: 2, Dessert: 0 }));
      check("...and left kotOrder as it was", same(await categoryRanks(), { Food: 1, Beverages: 0, Dessert: 2 }));
    });
    let tabId = "";
    await leg("(c) create, add-round, QR accept, QR accept add-round all stamp kotRank per category, never on a noKot line", async () => {
      const res = await create([lineOf(D.chips), lineOf(D.brownie), lineOf(D.pizza), lineOf(D.mojito), lineOf(D.water)]);
      tabId = String(res.body.data?._id);
      let lines = await linesOf(tabId);
      check("create: Mojito 0, Chips 1, Pizza 1, Brownie 2", [rankOf(lines, "Mojito"), rankOf(lines, "Chips"), rankOf(lines, "Pizza"), rankOf(lines, "Brownie")].map((l) => l?.kotRank).join() === "0,1,1,2");
      check("create: Water is noKot:true and has NO kotRank key (landmark: it is stored)", rankOf(lines, "Water")?.noKot === true && !hasRank(rankOf(lines, "Water")));
      const round = await addRound(tabId, [lineOf(D.pizza), lineOf(D.mojito)]);
      lines = await linesOf(tabId);
      check("items route (round 2): 200, Pizza 1, Mojito 0", round.status === 200 && rankOf(lines, "Pizza", 2)?.kotRank === 1 && rankOf(lines, "Mojito", 2)?.kotRank === 0);
      const first = await accept(await stageRequest("T-K1", "9990033001", [D.brownie, D.mojito, D.water]));
      const qrId = String(first.body.data?.order._id);
      let qr = await linesOf(qrId);
      check("QR accept (new order): 200, Brownie 2, Mojito 0, Water noKot with no kotRank", first.status === 200 && rankOf(qr, "Brownie")?.kotRank === 2 && rankOf(qr, "Mojito")?.kotRank === 0 && rankOf(qr, "Water")?.noKot === true && !hasRank(rankOf(qr, "Water")));
      const second = await accept(await stageRequest("T-K1", "9990033002", [D.pizza, D.brownie]));
      qr = await linesOf(qrId);
      check("QR accept add-round: SAME order, round 2, Pizza 1, Brownie 2", String(second.body.data?.order._id) === qrId && rankOf(qr, "Pizza", 2)?.kotRank === 1 && rankOf(qr, "Brownie", 2)?.kotRank === 2);
      check("QR round 1 KOT job lists Mojito, Brownie (Water never)", names(await kotJobNames(qrId, 1)) === "Mojito,Brownie");
    });
    await leg("(d) kotPrintJob of the saved order and the route's own KOT jobs are in kitchen order", async () => {
      check("route KOT job round 1: Mojito, Chips, Pizza, Brownie", names(await kotJobNames(tabId, 1)) === "Mojito,Chips,Pizza,Brownie");
      check("route KOT job round 2: Mojito, Pizza", names(await kotJobNames(tabId, 2)) === "Mojito,Pizza");
      const saved = JSON.parse(JSON.stringify(await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(tabId) }))) as OrderDto;
      const snap = kotPrintJob(saved, null).payload;
      const items = "snapshot" in snap ? snap.snapshot.items : [];
      check("kotPrintJob(saved, null): rounds grouped, each by rank", names(items.map((i) => i.name)) === "Mojito,Chips,Pizza,Brownie,Mojito,Pizza");
      check("landmark: the saved lines carry kotRank, the snapshot items do not", saved.items.some((l) => l.kotRank !== undefined) && !items.some((i) => "kotRank" in i));
    });
    await leg("(e) a product moved to another category: NEW lines take the new rank, old lines keep theirs", async () => {
      const moved = await answer(r.product.PUT(request("PUT", `/api/products/${D.chips._id}`, { categoryId: CAT.dessert }), idp(D.chips._id)));
      check("landmark: PUT /api/products/[id] {categoryId} 200", moved.status === 200 && String((await Product.collection.findOne({ name: "Chips" }))?.categoryId) === CAT.dessert);
      await addRound(tabId, [lineOf(D.chips)]);
      const lines = await linesOf(tabId);
      check("the round-3 Chips line is Dessert's rank 2", rankOf(lines, "Chips", 3)?.kotRank === 2);
      check("the round-1 Chips line keeps Food's rank 1", rankOf(lines, "Chips", 1)?.kotRank === 1);
    });
    let snackId = "";
    await leg("(f) a category created AFTER the kitchen order was saved: its lines are unranked and print last", async () => {
      const made = await answer<{ _id: string }>(r.categories.POST(request("POST", "/api/categories", { name: "Snacks" })));
      snackId = String(made.body.data?._id);
      check("landmark: POST /api/categories 201 and Snacks has no kotOrder", made.status === 201 && !("kotOrder" in ((await Category.collection.findOne({ name: "Snacks" })) ?? { kotOrder: 1 })));
      await Product.create({ ...D.crisps, categoryId: snackId });
      const res = await create([lineOf(D.crisps), lineOf(D.brownie), lineOf(D.pizza)]);
      const id = String(res.body.data?._id);
      const lines = await linesOf(id);
      check("Crisps carries no kotRank key; Pizza 1, Brownie 2 are stamped", !hasRank(rankOf(lines, "Crisps")) && rankOf(lines, "Pizza")?.kotRank === 1 && rankOf(lines, "Brownie")?.kotRank === 2);
      check("the KOT job lists Pizza, Brownie, Crisps (unplaced last)", names(await kotJobNames(id, 1)) === "Pizza,Brownie,Crisps");
    });
    await leg("(g) PATCH kitchen with a stale / partial id list: 409 and nothing written", async () => {
      const before = await categoryRanks();
      const partial = await patchCats({ ids: KITCHEN_IDS, list: "kitchen" });
      const extra = await patchCats({ ids: [...KITCHEN_IDS, snackId, "665f0000000000000000dead"], list: "kitchen" });
      check("landmark: the ranks before are Beverages 0, Food 1, Dessert 2, Snacks unset", same(before, { Food: 1, Beverages: 0, Dessert: 2, Snacks: "-" }));
      check("missing Snacks -> 409 with the changed-list error", partial.status === 409 && partial.body.success === false && typeof partial.body.error === "string");
      check("an unknown extra id -> 409", extra.status === 409);
      check("nothing was written", same(await categoryRanks(), before));
      const full = await patchCats({ ids: [snackId, ...KITCHEN_IDS], list: "kitchen" });
      check("positive control: the exact current set -> 200, Snacks 0, Beverages 1, Food 2, Dessert 3", full.status === 200 && same(await categoryRanks(), { Food: 2, Beverages: 1, Dessert: 3, Snacks: 0 }));
    });
    await leg("(h) PATCH {list:kitchen, clear:true}: no kotOrder anywhere, new lines unranked, old lines keep their stamps", async () => {
      const cleared = await patchCats({ list: "kitchen", clear: true });
      check("landmark: 200 and every category is unset", cleared.status === 200 && (await Category.collection.countDocuments()) === 4);
      check("no category carries a kotOrder key", (await Category.collection.countDocuments({ kotOrder: { $exists: true } })) === 0);
      const res = await create([lineOf(D.pizza), lineOf(D.mojito)]);
      const id = String(res.body.data?._id);
      check("a new order's lines carry no kotRank and the KOT reads Pizza, Mojito (as added)", !(await linesOf(id)).some((l) => hasRank(l)) && names(await kotJobNames(id, 1)) === "Pizza,Mojito");
      const old = await linesOf(tabId);
      check("the old tab keeps its stamps (Mojito 0, Pizza 1, Brownie 2, Chips 1 and 2)", rankOf(old, "Mojito", 1)?.kotRank === 0 && rankOf(old, "Pizza", 1)?.kotRank === 1 && rankOf(old, "Brownie")?.kotRank === 2 && rankOf(old, "Chips", 3)?.kotRank === 2);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  const failedLegs = legResults.filter((l) => !l.ok).length;
  console.log(`\n${legResults.length - failedLegs} legs passed, ${failedLegs} failed\n`);
  if (failedLegs > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
