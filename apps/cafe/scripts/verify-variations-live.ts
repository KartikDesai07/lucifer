/**
 * Menu-item VARIATIONS live leg — proves the write shapes the DB-free unit tests
 * cannot (SPEC-variations.md): real Mongo round-trips of the omit-empty storage
 * contract, the order/void snapshot, checkItemVariations fed from REAL saved
 * documents (not the hand-built fakes lib/variations.test.ts uses), and the CSV
 * re-import guard against the import route's ACTUAL update document.
 *
 *  - a product saved WITH variations round-trips them; one saved WITHOUT stores
 *    NO key at all (Object.hasOwn === false) — the omit-empty claim, proven
 *    against a real Mongoose write/read, not just the schema's `default:`;
 *  - an order whose item carries a `variation` round-trips it, and voiding that
 *    line through the REAL resolveItemVoid + the void route's real write shape
 *    keeps the variation on the trail entry;
 *  - checkItemVariations, fed the real saved Product rows (not the plain
 *    literals lib/variations.test.ts uses), rejects each of the same cases —
 *    proving a variations array that has been through a real Mongo round-trip
 *    still compares correctly (a lean() read could in principle hand back
 *    something checkItemVariations' `.find`/`.includes` didn't expect);
 *  - the CSV re-importer's actual $set update document (reproduced verbatim
 *    from app/api/products/import/route.ts) leaves a product's variations
 *    untouched — the omitted-column-wipes-data bug CR1.6 already found once;
 *  - a variation's price and the product's discount combine through the REAL
 *    effectivePrice helper to the exact number the cart would have billed.
 *
 * SCOPE — reproduces the write/read shapes the two order routes and the void
 * route actually issue, using the REAL `checkItemVariations`, `resolveItemVoid`,
 * `voidGuardFilter`, `orderLineKey`, and `effectivePrice` helpers plus the REAL
 * `Product`/`Order` models. It does NOT stand up the HTTP routes (no auth, no
 * session, no Zod) — those are pinned by lib/variation-paths.test.ts reading
 * the routes' actual source.
 *
 *   npm run verify:variations:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_variations npm run verify:variations:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end) rather
 * than leaving a prior run's fixed ids to collide with this one's.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose, { type FilterQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { Product } from "@/models/Product";
import { Order, type IOrder } from "@/models/Order";
import { checkItemVariations, type VariationSource } from "@/lib/variations";
import { resolveItemVoid, voidGuardFilter } from "@/lib/order-void";
import { orderLineKey } from "@pos/shared/utils";
import { effectivePrice } from "@/hooks/use-cart";
import { buildUpdate } from "@/lib/crud-route";
import { updateProductSchema } from "@/schemas";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}variations`;

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

// Minimal but schema-valid order doc — money/GST fields are trivial on purpose
// (this leg is about the `variation` field surviving the round-trip, not GST
// math, which lib/receipt.test.ts already owns).
function buildOrder(opts: {
  orderId: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    qty: number;
    variation?: string;
    modifiers?: string[];
    instructions?: string;
    kotRound?: number;
  }>;
}) {
  const subtotal = opts.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return {
    orderId: opts.orderId,
    customerName: "Walk-In",
    items: opts.items.map((it) => ({
      productId: it.productId,
      name: it.name,
      price: it.price,
      qty: it.qty,
      variation: it.variation,
      modifiers: it.modifiers ?? [],
      instructions: it.instructions ?? "",
      kotRound: it.kotRound ?? 1,
    })),
    subtotal,
    discount: 0,
    gstAmount: 0,
    total: subtotal,
    paidAmount: 0,
    payment: "Unpaid" as const,
    status: "Pending" as const,
    receiver: "Verifier",
    kotRounds: 1,
  };
}

// ── 1. the omit-empty storage contract, against a REAL Mongo write/read ─────

async function productOmitEmptyLegs(): Promise<{ sized: string; plain: string }> {
  console.log("\n── product variations: omit-empty round-trip ──────────────────");

  const sized = await Product.create({
    name: "Coco",
    category: "Beverages",
    price: 120, // base/reference price — variations override it for ordering
    discount: 10,
    variations: [
      { name: "Small", price: 99 },
      { name: "Large", price: 149 },
    ],
  });
  const sizedDoc = await Product.findById(sized._id).lean();
  check(
    "a product saved WITH variations round-trips both rows, in order, with the right prices",
    Array.isArray(sizedDoc?.variations) &&
      sizedDoc.variations.length === 2 &&
      sizedDoc.variations[0]?.name === "Small" &&
      sizedDoc.variations[0]?.price === 99 &&
      sizedDoc.variations[1]?.name === "Large" &&
      sizedDoc.variations[1]?.price === 149,
  );

  const plain = await Product.create({ name: "Tea", category: "Beverages", price: 40 });
  const plainDoc = await Product.findById(plain._id).lean();
  check(
    "a product saved WITHOUT variations stores NO key at all (Object.hasOwn === false) — not an empty array",
    plainDoc !== null && Object.hasOwn(plainDoc, "variations") === false,
  );

  return { sized: String(sized._id), plain: String(plain._id) };
}

// ── 2. an order item's variation round-trips, and a void keeps it ──────────

async function orderAndVoidLegs(sizedProductId: string): Promise<void> {
  console.log("\n── order item + void trail: variation snapshot ────────────────");

  // The unit price a Large actually bills at: the variation's OWN price run
  // through the REAL effectivePrice helper against the product's discount —
  // exactly what use-cart.ts's addToCart computes, not a hand-picked number.
  const unitPrice = effectivePrice({ price: 149, discount: 10 });
  check(
    "effectivePrice(variation price, product discount) matches the hand-worked figure (149 - 10% = 134.1, rounds to 134) — the number the cart would have billed",
    unitPrice === 134,
  );

  // A second, unrelated line rides along on purpose: resolveItemVoid refuses to
  // empty a tab down to zero items (that is a cancellation, not a void — see
  // its own comment), so voiding the WHOLE Coco line below needs a line left
  // over for the tab to still hold.
  const order = await Order.create(
    buildOrder({
      orderId: "ORD-VAR-1",
      items: [
        {
          productId: sizedProductId,
          name: "Coco",
          price: unitPrice,
          qty: 2,
          variation: "Large",
        },
        { productId: "plain-line", name: "Tea", price: 40, qty: 1 },
      ],
    }),
  );

  const readBack = await Order.findById(order._id).lean();
  check(
    "an order item carrying a variation round-trips it verbatim, price included",
    readBack?.items[0]?.variation === "Large" && readBack.items[0]?.price === 134,
  );

  // Void the line through the REAL pure resolver, using the REAL orderLineKey
  // echo — exactly what the void route's request body carries from the client.
  const line = readBack!.items[0]!;
  const resolved = resolveItemVoid({
    items: readBack!.items,
    request: {
      index: 0,
      lineKey: orderLineKey(line),
      qty: line.qty,
      reason: "Wrong size punched in",
      voidedBy: "Verifier",
      at: new Date(),
    },
    discount: readBack!.discount,
    charge: 0,
    gstCfg: { gstEnabled: false, gstRate: 0, gstMode: "inclusive" },
  });
  if ("error" in resolved) {
    check(`resolveItemVoid must resolve, not error (${resolved.error})`, false);
    return;
  }
  check(
    "resolveItemVoid's own entry carries the variation forward from the voided line",
    resolved.entry.variation === "Large",
  );

  // The void route's ACTUAL write shape (app/api/orders/[id]/items/void/route.ts):
  // $set the recomputed items/totals, $push the entry onto voids. Reproduced
  // here verbatim rather than re-derived, so a change to that shape that drops
  // `variation` from the $push payload fails THIS leg, not just a unit fake.
  const filter: FilterQuery<IOrder> = {
    _id: order._id,
    status: "Pending",
    payment: "Unpaid",
    kotRounds: readBack!.kotRounds ?? 0,
    ...voidGuardFilter(0),
  };
  const voided = await Order.findOneAndUpdate(
    filter,
    {
      $set: {
        items: resolved.nextItems,
        subtotal: resolved.totals.subtotal,
        discount: resolved.totals.discount,
        gstAmount: resolved.totals.gstAmount,
        total: resolved.totals.total,
      },
      $push: { voids: resolved.entry },
    },
    { new: true, runValidators: true },
  ).lean();
  check(
    "the void write actually lands, and the stored void-trail entry keeps the variation — the kitchen's VOID slip can say WHICH size to stop making",
    voided?.voids?.[0]?.variation === "Large",
  );
}

// ── 3. checkItemVariations against REAL saved documents ────────────────────

async function checkItemVariationsLegs(sizedProductId: string, plainProductId: string): Promise<void> {
  console.log("\n── checkItemVariations against real saved Product rows ────────");

  // The exact query both order-write routes run: select only what the checker
  // needs, .lean() it, and hand the rows straight to checkItemVariations — no
  // hand-built VariationSource literals (that is lib/variations.test.ts's job;
  // this leg's whole point is that a REAL lean() read still compares right).
  const rows = await Product.find({ _id: { $in: [sizedProductId, plainProductId] } })
    .select("name variations")
    .lean();
  const sources: VariationSource[] = rows.map((p) => ({
    _id: String(p._id),
    name: p.name,
    variations: p.variations,
  }));

  check(
    "a plain item on the real no-variations Tea row is coherent",
    checkItemVariations(sources, [{ productId: plainProductId, name: "Tea" }]) === null,
  );
  check(
    "a matching variation on the real sized Coco row is coherent",
    checkItemVariations(sources, [{ productId: sizedProductId, name: "Coco", variation: "Small" }]) === null,
  );
  check(
    "the real sized Coco row rejects an order with NO variation picked",
    checkItemVariations(sources, [{ productId: sizedProductId, name: "Coco" }]) ===
      `Pick a variation for "Coco"`,
  );
  check(
    "the real sized Coco row rejects an unknown variation name",
    checkItemVariations(sources, [
      { productId: sizedProductId, name: "Coco", variation: "Medium" },
    ]) === `"Medium" is not a variation of "Coco"`,
  );
  check(
    "the real no-variations Tea row rejects a variation sent for it anyway",
    checkItemVariations(sources, [
      { productId: plainProductId, name: "Tea", variation: "Large" },
    ]) === `"Large" is not a variation of "Tea"`,
  );
}

// ── 4. the CSV re-import guard: variations survive a re-import ─────────────

async function csvReimportGuardLeg(): Promise<void> {
  console.log("\n── CSV re-import must not touch variations ─────────────────────");

  const named = await Product.create({
    name: "Cold Coffee",
    category: "Beverages",
    price: 100,
    discount: 5,
    variations: [
      { name: "Regular", price: 100 },
      { name: "Chocolate", price: 130 },
    ],
  });

  // The import route's ACTUAL update document (app/api/products/import/route.ts,
  // the `productOps` builder) — reproduced field-for-field. `variations` is
  // absent from this $set because coerceProductRow has no column for it
  // (packages/shared/src/schemas/product.schema.test.ts pins that at the Zod
  // layer); this leg proves the DB HALF of the claim — that omitting a field
  // from a $set genuinely leaves it alone, unlike the full-document overwrite
  // CR1.6 found once for a different column.
  const reimportRow = {
    category: "Beverages",
    price: 110, // the CSV re-import bumped the price
    discount: 5,
    image: "",
    modifiers: [] as string[],
    isActive: true,
  };
  await Product.updateOne(
    { name: "Cold Coffee" },
    { $set: reimportRow },
    { upsert: true },
  );

  const after = await Product.findById(named._id).lean();
  check(
    "a re-import updates the columns it CAN express (price moved to 110) and leaves variations completely alone",
    after?.price === 110 &&
      Array.isArray(after?.variations) &&
      after.variations.length === 2 &&
      after.variations[0]?.name === "Regular" &&
      after.variations[1]?.name === "Chocolate" &&
      after.variations[1]?.price === 130,
  );
}

// ── turning "Has variations" OFF must actually clear them (review blocker) ──
// This shipped broken: JSON.stringify drops a key whose value is undefined, so
// the PUT body never mentioned variations, the partial schema parsed it as absent,
// and Mongoose only $sets keys that are present. The save "succeeded", the stored
// sizes survived, and the item kept billing by size. Replays the REAL wire path:
// client payload -> JSON round trip -> updateProductSchema -> buildUpdate -> Mongo.
async function toggleOffLegs(): Promise<void> {
  console.log("");
  console.log("-- turning variations OFF --");

  const product = await Product.create({
    name: "Toggle Coco",
    category: "Coco",
    price: 100,
    variations: [
      { name: "Regular", price: 100 },
      { name: "Chocolate", price: 130 },
    ],
  });

  // What the browser sends with the switch OFF, through a real JSON round trip.
  const wire = JSON.parse(
    JSON.stringify({ name: "Toggle Coco", category: "Coco", price: 120, variations: null }),
  );
  const parsed = updateProductSchema.safeParse(wire);
  check(
    "the PUT schema accepts variations: null as the explicit \"no longer sold by size\" signal",
    parsed.success,
  );
  if (!parsed.success) return;

  await Product.findByIdAndUpdate(product._id, buildUpdate(parsed.data, ["variations"]), {
    new: true,
    runValidators: true,
  });
  const cleared = await Product.findById(product._id).lean();
  check(
    "the sizes are GONE from the document — not stored as null, the key is absent (omit-empty)",
    cleared !== null && !Object.hasOwn(cleared, "variations"),
  );
  check("and the rest of the edit still landed (price 120)", cleared?.price === 120);

  // The other half of the contract: an ABSENT key must still leave sizes alone,
  // which is what stops a CSV re-import (no variations column) from wiping them.
  const sized = await Product.create({
    name: "Keep Coco",
    category: "Coco",
    price: 100,
    variations: [{ name: "Small", price: 109 }],
  });
  const partialWire = JSON.parse(JSON.stringify({ price: 111 }));
  const partial = updateProductSchema.safeParse(partialWire);
  if (partial.success) {
    await Product.findByIdAndUpdate(sized._id, buildUpdate(partial.data, ["variations"]), {
      new: true,
      runValidators: true,
    });
  }
  const kept = await Product.findById(sized._id).lean();
  check(
    "a PUT that never mentions variations leaves them untouched (the CSV-re-import guarantee)",
    kept?.variations?.length === 1 && kept?.variations?.[0]?.name === "Small" && kept?.price === 111,
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run

  console.log(`\nVariations write/read shapes — live against ${dbName}`);

  const { sized, plain } = await productOmitEmptyLegs();
  await orderAndVoidLegs(sized);
  await checkItemVariationsLegs(sized, plain);
  await csvReimportGuardLeg();
  await toggleOffLegs();

  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
