/**
 * "Modifiers come ticked" live leg (UI batch 1 F, 2026-09-29) — proves against
 * a REAL Mongo what the DB-free tests cannot: that strict:true keeps the new
 * paths (an undeclared path is dropped silently — this codebase's own
 * note/rewardItem incidents), and that the omit-empty contract holds on disk.
 *
 *  - a product saved with modifiersPreselected:true reads it back; one saved
 *    without stores NO key;
 *  - an Order line with removedModifiers ["Mushroom"] stores and reads it; a
 *    line without stores NO key (raw document, native driver);
 *  - voiding that line through the REAL resolveItemVoid + the void route's
 *    write shape keeps the removals on the trail entry;
 *  - the REAL priceRequestItems (the public gate) passes a removal on the
 *    flagged product and refuses it on a normal one, fed REAL lean rows;
 *  - an OrderRequest built by the REAL buildRequestDoc keeps the removals.
 *
 *   npm run verify:removed-modifiers:live
 *
 * SAFETY: refuses any database not named pos_scratch_*, and drops the whole
 * scratch database at start and end.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose, { type FilterQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { Product } from "@/models/Product";
import { Order, type IOrder } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { resolveItemVoid, voidGuardFilter } from "@/lib/order-void";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import { buildRequestDoc } from "@/lib/order-request-intake";
import { mintUniquePublicCode } from "@/lib/public-token";
import { orderLineKey, REMOVED_MODIFIERS_NOT_ALLOWED_ERROR } from "@pos/shared/utils";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import { ensureCategoryId } from "./verify-shared/ensure-category";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}removed_modifiers`;
const PIZZA_MODIFIERS = ["Mushroom", "Onion", "Olives"];

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

async function productLegs(): Promise<{ pizza: string; tea: string }> {
  console.log("\n── product flag: round-trip + omit-empty ───────────────────────");
  const categoryId = await ensureCategoryId("Pizza");
  const pizza = await Product.create({
    name: "Pizza", categoryId, price: 300, modifiers: PIZZA_MODIFIERS, modifiersPreselected: true,
  });
  const tea = await Product.create({ name: "Tea", categoryId, price: 40, modifiers: ["Sugar"] });
  const pizzaDoc = await Product.findById(pizza._id).lean();
  check("a product saved with modifiersPreselected:true reads it back", pizzaDoc?.modifiersPreselected === true);
  const teaDoc = await Product.findById(tea._id).lean();
  check("a product saved without the flag stores NO key (absent = off)", teaDoc !== null && !Object.hasOwn(teaDoc, "modifiersPreselected"));
  return { pizza: String(pizza._id), tea: String(tea._id) };
}

async function orderAndVoidLegs(pizzaId: string, teaId: string): Promise<void> {
  console.log("\n── order line + void trail: removals survive strict:true ───────");
  const order = await Order.create({
    orderId: "ORD-RMV-1",
    customerName: "Walk-In",
    items: [
      { productId: pizzaId, name: "Pizza", price: 300, qty: 1, modifiers: [], removedModifiers: ["Mushroom"], instructions: "", kotRound: 1 },
      { productId: teaId, name: "Tea", price: 40, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: 340, discount: 0, gstAmount: 0, total: 340, paidAmount: 0,
    payment: "Unpaid", status: "Pending", receiver: "Verifier", kotRounds: 1,
  });
  const readBack = await Order.findById(order._id).lean();
  check("an order line with removedModifiers stores and reads them back", readBack?.items[0]?.removedModifiers?.[0] === "Mushroom");
  const raw = await mongoose.connection.db!.collection("orders").findOne({ _id: order._id });
  const rawItems = (raw?.items ?? []) as Array<Record<string, unknown>>;
  check("landmark: the raw document holds both lines", rawItems.length === 2);
  check("a line with no removals stores NO removedModifiers key on disk (omit-empty)", rawItems.length === 2 && !Object.hasOwn(rawItems[1], "removedModifiers"));

  const line = readBack!.items[0]!;
  const resolved = resolveItemVoid({
    items: readBack!.items,
    request: {
      index: 0,
      lineKey: orderLineKey({ ...line, productId: String(line.productId) }),
      qty: 1,
      reason: "Customer changed their mind",
      voidedBy: "Verifier",
      at: new Date(),
    },
    discount: 0,
    discountKind: undefined,
    reward: undefined,
    charge: 0,
    gstCfg: { gstEnabled: false, gstRate: 0, gstMode: "inclusive" },
  });
  if ("error" in resolved) {
    check(`resolveItemVoid must resolve, not error (${resolved.error})`, false);
    return;
  }
  check("the void entry carries the removals forward", resolved.entry.removedModifiers?.[0] === "Mushroom");
  const filter: FilterQuery<IOrder> = { _id: order._id, status: "Pending", payment: "Unpaid", kotRounds: 1, ...voidGuardFilter(0) };
  const voided = await Order.findOneAndUpdate(
    filter,
    { $set: { items: resolved.nextItems, subtotal: resolved.totals.subtotal, total: resolved.totals.total }, $push: { voids: resolved.entry } },
    { new: true, runValidators: true },
  ).lean();
  check("the stored void-trail entry keeps NO Mushroom — the void slip names which pizza to stop", voided?.voids?.[0]?.removedModifiers?.[0] === "Mushroom");
}

async function publicLegs(pizzaId: string, teaId: string): Promise<void> {
  console.log("\n── public gate + order request: real lean rows ────────────────");
  const products = (await Product.find({ _id: { $in: [pizzaId, teaId] } })
    .select("name price discount available modifiers modifiersPreselected variations")
    .lean()) as unknown as PricedProductSource[];
  const refused = priceRequestItems(products, [{ productId: teaId, modifiers: [], removedModifiers: ["Sugar"], qty: 1 }]);
  check("a removal on a normal-mode item is refused by the public gate", "error" in refused && refused.error === REMOVED_MODIFIERS_NOT_ALLOWED_ERROR("Tea"));
  const priced = priceRequestItems(products, [{ productId: pizzaId, modifiers: [], removedModifiers: ["Onion"], qty: 1 }]);
  if ("error" in priced) {
    check(`the flagged pizza must price (${priced.error})`, false);
    return;
  }
  check("the priced line carries the removal", priced.lines[0]?.removedModifiers?.[0] === "Onion");
  const input: CreatePublicOrderRequestInput = {
    target: { kind: "parcel" },
    items: [{ productId: pizzaId, modifiers: [], removedModifiers: ["Onion"], qty: 1 }],
    name: "Verifier",
    mobile: "9876543210",
  } as CreatePublicOrderRequestInput;
  const doc = buildRequestDoc(input, priced.lines, null, null, true, 0, undefined);
  const shortCode = await mintUniquePublicCode((code) => OrderRequest.exists({ shortCode: code }).then(Boolean));
  const created = await OrderRequest.create({ ...doc, shortCode });
  const back = await OrderRequest.findById(created._id).lean();
  check("an OrderRequest line keeps the removal (accept mints the Order line from it)", back?.items[0]?.removedModifiers?.[0] === "Onion");
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase();
  console.log(`\nRemoved-modifiers write/read shapes — live against ${dbName}`);
  const { pizza, tea } = await productLegs();
  await orderAndVoidLegs(pizza, tea);
  await publicLegs(pizza, tea);
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
