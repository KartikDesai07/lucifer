/**
 * CR2.3 §20 live leg — proves the D9 auto-print marker (acceptedKotRound /
 * kotPrintedAt on OrderRequest) and readPosPulse's own two-query shape
 * against a REAL MongoDB. Mirrors scripts/verify-order-request-live.ts's own
 * conventions (env/URI handling, the scratch-DB-prefix guard, numbered
 * PASS/FAIL, full drop at the end) — read that file's header first.
 *
 * SCOPE — drives acceptOrderRequest (lib/order-request-accept.ts) plus
 * readPosPulse / claimKotPrint (lib/pos-pulse.ts) directly. It does NOT stand
 * up the HTTP routes (no auth, no BotID) — those stay in the route/unit-test
 * layer (self-order-alert-paths.test.ts).
 *
 *   npm run verify:alert:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_alert npm run verify:alert:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { OrderRequest, type IOrderRequest, type OrderRequestStatus } from "@/models/OrderRequest";
import { Product } from "@/models/Product";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { Counter } from "@/models/Counter";
import { acceptOrderRequest, type AcceptContext } from "@/lib/order-request-accept";
import { readPosPulse, claimKotPrint } from "@/lib/pos-pulse";
import { buildRequestDoc, type IntakeTable } from "@/lib/order-request-intake";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import { mintUniquePublicCode } from "@/lib/public-token";
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import { PULSE_SELF_ORDER_WINDOW_MS, PULSE_OPEN_SCAN_LIMIT, PULSE_SELF_ORDER_LIMIT } from "@pos/shared/self-order-alert";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}alert`;

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

let teaId: string;

async function seedProducts(): Promise<void> {
  const tea = await Product.create({
    name: "Tea",
    category: "Beverages",
    price: 100,
    discount: 0,
    available: true,
    modifiers: [],
    isActive: true,
  });
  teaId = String(tea._id);
}

const STAFF_CTX = (actor: string): AcceptContext => ({ actor, settings: null, createCustomer: true });
const AUTO_CTX: AcceptContext = { actor: SELF_ORDER_RECEIVER, settings: null, createCustomer: false };

// Thin subset of the sibling script's stageRequest — no promo/variation
// support, this leg set never needs either.
async function stageRequest(
  targetKind: "table" | "parcel",
  tableNo: string | undefined,
  mobile: string,
  name: string,
): Promise<IOrderRequest> {
  const products = (await Product.find({ _id: teaId })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const priced = priceRequestItems(products, [{ productId: teaId, modifiers: [], qty: 1 }]);
  if ("error" in priced) throw new Error(`stageRequest: pricing failed — ${priced.error}`);

  let table: IntakeTable | null = null;
  if (targetKind === "table") {
    if (!tableNo) throw new Error("stageRequest: table target needs a tableNo");
    const found = await Table.findOne({ tableNo }).select("tableNo chargeAmount chargeLabel").lean();
    if (!found) throw new Error(`stageRequest: table ${tableNo} not found`);
    table = found;
  }

  const input: CreatePublicOrderRequestInput = {
    target: targetKind === "table" ? { kind: "table", token: "STAGE-TOKEN-UNUSED" } : { kind: "parcel" },
    items: [{ productId: teaId, modifiers: [], qty: 1 }],
    name,
    mobile,
  };
  const doc = buildRequestDoc(input, priced.lines, table, null, true);
  const shortCode = await mintUniquePublicCode((code) => OrderRequest.exists({ shortCode: code }).then(Boolean));
  return OrderRequest.create({ ...doc, shortCode });
}

// A raw, unpriced OrderRequest fixture — used only by leg7/leg8, which prove
// readPosPulse's own query shape and never touch acceptOrderRequest's money
// math. Mirrors verify-order-request-live.ts's own rawOrderRequest() helper.
function rawOrderRequest(overrides: Partial<IOrderRequest> & { shortCode: string }) {
  return {
    targetKind: "parcel" as const,
    items: [{ productId: "p-x", name: "Item", price: 100, qty: 1, modifiers: [], instructions: "" }],
    quotedSubtotal: 100,
    quotedCharge: 0,
    quotedTotal: 100,
    mobile: "9990000000",
    name: "Fixture",
    status: "pending" as OrderRequestStatus,
    ...overrides,
  };
}

// Backdates createdAt/updatedAt via a RAW collection write — Mongoose's own
// timestamps plugin re-stamps both on any save/update, so this is the only
// way to simulate an "old" or "recently edited" row (same technique as the
// sibling script's leg13 pruning fixtures).
async function stampTimestamps(id: mongoose.Types.ObjectId, createdAt: Date, updatedAt: Date): Promise<void> {
  await OrderRequest.collection.updateOne({ _id: id }, { $set: { createdAt, updatedAt } });
}

// ── legs ─────────────────────────────────────────────────────────────────────

async function leg1(): Promise<{ requestId: string; tableNo: string }> {
  console.log("\nLeg 1 — auto-accept a self-order request ⇒ acceptedKotRound === 1\n");
  await Table.create({ tableNo: "A-1", capacity: 4, status: "Available" });
  const request = await stageRequest("table", "A-1", "9990000001", "Leg1 Diner");
  const result = await acceptOrderRequest(String(request._id), AUTO_CTX);
  check("auto-accept succeeds", !("error" in result));
  if ("error" in result) throw new Error(`leg1: accept unexpectedly failed — ${result.error}`);
  check("kotRounds is 1 on the opening round", result.order.kotRounds === 1);
  const stored = await OrderRequest.findById(request._id).lean();
  check("the request's acceptedKotRound is 1", stored?.acceptedKotRound === 1);
  return { requestId: String(request._id), tableNo: "A-1" };
}

async function leg2(tableNo: string): Promise<void> {
  console.log("\nLeg 2 — a second self-order onto the SAME open table (add-round) ⇒ acceptedKotRound === 2\n");
  const request = await stageRequest("table", tableNo, "9990000002", "Leg2 Diner");
  const result = await acceptOrderRequest(String(request._id), AUTO_CTX);
  check("add-round auto-accept succeeds", !("error" in result));
  if ("error" in result) throw new Error(`leg2: accept unexpectedly failed — ${result.error}`);
  check("kotRounds is now 2", result.order.kotRounds === 2);
  const stored = await OrderRequest.findById(request._id).lean();
  check("the second request's acceptedKotRound is 2", stored?.acceptedKotRound === 2);
}

async function leg3(): Promise<void> {
  console.log("\nLeg 3 — replayed accept after the order advanced a round ⇒ the FIRST request's marker is unchanged\n");
  await Table.create({ tableNo: "A-3", capacity: 4, status: "Available" });
  const requestA = await stageRequest("table", "A-3", "9990000003", "Leg3 Round1");
  const resultA = await acceptOrderRequest(String(requestA._id), AUTO_CTX);
  if ("error" in resultA) throw new Error("leg3: round 1 accept unexpectedly failed");
  check("round 1's acceptedKotRound is 1", resultA.order.kotRounds === 1);

  const requestB = await stageRequest("table", "A-3", "9990000004", "Leg3 Round2");
  const resultB = await acceptOrderRequest(String(requestB._id), AUTO_CTX);
  if ("error" in resultB) throw new Error("leg3: round 2 accept unexpectedly failed");
  check("round 2 advanced the order to kotRounds 2", resultB.order.kotRounds === 2);

  const replay = await acceptOrderRequest(String(requestA._id), AUTO_CTX);
  check("replaying request A succeeds", !("error" in replay));
  if ("error" in replay) throw new Error("leg3: replay unexpectedly failed");
  check("the replay reports replayed:true", replay.replayed === true);

  const storedA = await OrderRequest.findById(requestA._id).lean();
  check(
    "request A's acceptedKotRound STAYS 1 — the replay never re-stamped it to the order's now-later round",
    storedA?.acceptedKotRound === 1,
  );
}

async function leg4(): Promise<{ requestId: string }> {
  console.log("\nLeg 4 — two concurrent claimKotPrint calls on ONE request ⇒ exactly one claimed:true\n");
  await Table.create({ tableNo: "A-4", capacity: 4, status: "Available" });
  const request = await stageRequest("table", "A-4", "9990000005", "Leg4 Diner");
  const result = await acceptOrderRequest(String(request._id), AUTO_CTX);
  if ("error" in result) throw new Error("leg4: accept unexpectedly failed");
  const requestId = String(request._id);

  const [claimA, claimB] = await Promise.all([claimKotPrint(requestId), claimKotPrint(requestId)]);
  const claims = [claimA, claimB];
  const claimedCount = claims.filter((c) => c.claimed).length;
  check("exactly ONE of the two concurrent claims reports claimed:true", claimedCount === 1);
  const raced = claims.find((c) => !c.claimed);
  check('the loser reports reason:"raced"', raced !== undefined && !raced.claimed && raced.reason === "raced");

  const stored = await OrderRequest.findById(requestId).select("kotPrintedAt").lean();
  check("exactly one kotPrintedAt landed in the DB", stored?.kotPrintedAt instanceof Date);
  return { requestId };
}

async function leg5(): Promise<void> {
  console.log('\nLeg 5 — a STAFF-accepted request (actor !== SELF_ORDER_RECEIVER) ⇒ claimed:false, reason:"not-eligible", nothing written\n');
  await Table.create({ tableNo: "A-5", capacity: 4, status: "Available" });
  const request = await stageRequest("table", "A-5", "9990000006", "Leg5 Diner");
  const result = await acceptOrderRequest(String(request._id), STAFF_CTX("Staff Q"));
  if ("error" in result) throw new Error("leg5: staff accept unexpectedly failed");

  const claim = await claimKotPrint(String(request._id));
  check(
    'a staff-accepted request is not eligible',
    !claim.claimed && claim.reason === "not-eligible",
  );
  const stored = await OrderRequest.findById(request._id).select("kotPrintedAt").lean();
  check("kotPrintedAt was never written", stored?.kotPrintedAt === undefined);
}

async function leg6(): Promise<void> {
  console.log('\nLeg 6 — a still-PENDING request ⇒ claimed:false, reason:"not-eligible"\n');
  const request = await stageRequest("parcel", undefined, "9990000007", "Leg6 Diner");
  check("the staged request is pending (never accepted)", request.status === "pending");
  const claim = await claimKotPrint(String(request._id));
  check("a pending request is not eligible for a KOT claim", !claim.claimed && claim.reason === "not-eligible");
  // Cleanup — this fixture is deliberately never resolved, so it would
  // otherwise sit OPEN forever and contaminate leg7's exact open-count pins.
  await OrderRequest.deleteOne({ _id: request._id });
}

async function leg7(protectedRequestId: string): Promise<{ openIds: string[] }> {
  console.log("\nLeg 7 — readPosPulse shape: open rows, the window exclusion, printed flags, and newest-first ordering\n");
  const now = Date.now();

  // Isolation: legs 1-4 legitimately minted their own auto-accepted
  // self-orders (all within the last hour), which would otherwise leak into
  // this leg's exact-shape assertions below. Delete every one of them EXCEPT
  // leg4's own request, which leg10 (run after this leg) still needs to
  // exist — instead, push ITS createdAt outside the pulse window so it drops
  // out of query B naturally, without touching the kotPrintedAt leg10 checks.
  await OrderRequest.deleteMany({
    status: "accepted",
    actor: SELF_ORDER_RECEIVER,
    _id: { $ne: new mongoose.Types.ObjectId(protectedRequestId) },
  });
  await stampTimestamps(
    new mongoose.Types.ObjectId(protectedRequestId),
    new Date(now - 2 * PULSE_SELF_ORDER_WINDOW_MS),
    new Date(now - 2 * PULSE_SELF_ORDER_WINDOW_MS),
  );

  const openDocs = await Promise.all([
    OrderRequest.create(rawOrderRequest({ shortCode: "LEG7OPEN01", status: "pending" })),
    OrderRequest.create(rawOrderRequest({ shortCode: "LEG7OPEN02", status: "pending" })),
    OrderRequest.create(rawOrderRequest({ shortCode: "LEG7OPEN03", status: "accepting" })),
    OrderRequest.create(rawOrderRequest({ shortCode: "LEG7OPEN04", status: "pending" })),
  ]);
  // openDocs[0] is the OLDEST-created row but the MOST RECENTLY edited one —
  // proves openRev is the true max(updatedAt), not just the newest row's.
  await stampTimestamps(openDocs[0]._id, new Date(now - 4000), new Date(now - 500));
  await stampTimestamps(openDocs[1]._id, new Date(now - 3000), new Date(now - 3000));
  await stampTimestamps(openDocs[2]._id, new Date(now - 2000), new Date(now - 2000));
  await stampTimestamps(openDocs[3]._id, new Date(now - 1000), new Date(now - 1000));

  const selfOld = await OrderRequest.create(
    rawOrderRequest({ shortCode: "LEG7SELF01", status: "accepted", actor: SELF_ORDER_RECEIVER, acceptedOrderId: "ORD-FAKE-7A", acceptedKotRound: 1 }),
  );
  await stampTimestamps(selfOld._id, new Date(now - 2 * PULSE_SELF_ORDER_WINDOW_MS), new Date(now - 2 * PULSE_SELF_ORDER_WINDOW_MS));

  const selfFreshA = await OrderRequest.create(
    rawOrderRequest({ shortCode: "LEG7SELF02", status: "accepted", actor: SELF_ORDER_RECEIVER, acceptedOrderId: "ORD-FAKE-7B", acceptedKotRound: 1, kotPrintedAt: new Date(now - 40000) }),
  );
  await stampTimestamps(selfFreshA._id, new Date(now - 60000), new Date(now - 60000));
  await OrderRequest.collection.updateOne({ _id: selfFreshA._id }, { $set: { acceptedAt: new Date(now - 50000) } });

  const selfFreshB = await OrderRequest.create(
    rawOrderRequest({ shortCode: "LEG7SELF03", status: "accepted", actor: SELF_ORDER_RECEIVER, acceptedOrderId: "ORD-FAKE-7C", acceptedKotRound: 2 }),
  );
  await stampTimestamps(selfFreshB._id, new Date(now - 30000), new Date(now - 30000));
  await OrderRequest.collection.updateOne({ _id: selfFreshB._id }, { $set: { acceptedAt: new Date(now - 10000) } });

  const pulse = await readPosPulse();
  check("openCount is 4", pulse.openCount === 4);
  check("openTruncated is false (4 < the scan limit)", pulse.openTruncated === false && PULSE_OPEN_SCAN_LIMIT > 4);
  check("newestOpenId is the most RECENTLY CREATED open row (openDocs[3])", pulse.newestOpenId === String(openDocs[3]._id));
  check("openRev is the MAX updatedAt over open rows — openDocs[0]'s edit, not the newest-created row's", pulse.openRev === new Date(now - 500).toISOString());

  check("the 2h-old auto-accepted row is EXCLUDED by the window", !pulse.selfOrders.some((r) => r.requestId === String(selfOld._id)));
  // Review C4: the pulse serves UNPRINTED rows only — a printed row must not
  // occupy one of the limited slots.
  check("the PRINTED fresh row is EXCLUDED (unprinted-only payload)", !pulse.selfOrders.some((r) => r.requestId === String(selfFreshA._id)));
  check("exactly the one fresh UNPRINTED self-order is included", pulse.selfOrders.length === 1 && pulse.selfOrders[0]?.requestId === String(selfFreshB._id));
  check("its printed flag is false", pulse.selfOrders[0]?.printed === false);
  check("selfOrdersTruncated is false below the limit", pulse.selfOrdersTruncated === false);

  // Leg 7b — a backlog DEEPER than the limit: the payload caps at the newest
  // PULSE_SELF_ORDER_LIMIT unprinted rows and says so; the oldest waits its
  // turn (slots free as shown rows print, so a deep backlog drains across
  // ticks instead of hiding its tail forever — review C4's failure mode).
  const extras = [];
  for (let i = 0; i < PULSE_SELF_ORDER_LIMIT; i++) {
    const doc = await OrderRequest.create(
      rawOrderRequest({ shortCode: `LEG7EXTRA0${i}`, status: "accepted", actor: SELF_ORDER_RECEIVER, acceptedOrderId: `ORD-FAKE-7X${i}`, acceptedKotRound: 1 }),
    );
    await stampTimestamps(doc._id, new Date(now - 5000 + i), new Date(now - 5000 + i));
    await OrderRequest.collection.updateOne({ _id: doc._id }, { $set: { acceptedAt: new Date(now - 5000 + i) } });
    extras.push(doc);
  }
  const deep = await readPosPulse();
  check("a backlog one past the limit caps at PULSE_SELF_ORDER_LIMIT rows", deep.selfOrders.length === PULSE_SELF_ORDER_LIMIT);
  check("and reports selfOrdersTruncated", deep.selfOrdersTruncated === true);
  check("selfOrders is sorted newest-first (acceptedAt DESC)", deep.selfOrders[0]?.requestId === String(extras[PULSE_SELF_ORDER_LIMIT - 1]._id));
  check("the OLDEST unprinted (freshB) is the one waiting outside the cap", !deep.selfOrders.some((r) => r.requestId === String(selfFreshB._id)));
  await OrderRequest.deleteMany({ _id: { $in: extras.map((d) => d._id) } });

  return { openIds: openDocs.map((d) => String(d._id)) };
}

async function leg8(openIds: string[]): Promise<void> {
  console.log("\nLeg 8 — rejecting the open row holding the max updatedAt ⇒ openCount decreases AND openRev moves\n");
  const before = await readPosPulse();
  const rejected = await OrderRequest.findOneAndUpdate(
    { _id: openIds[0], status: { $in: ["pending", "accepting"] } },
    { $set: { status: "rejected", rejectedReason: "leg8" } },
  );
  check("the reject CAS landed", rejected !== null);

  const after = await readPosPulse();
  check("openCount decreased by exactly one", after.openCount === before.openCount - 1);
  check("openRev moved away from the rejected row's own value", after.openRev !== before.openRev);
}

async function leg9(): Promise<void> {
  console.log("\nLeg 9 — an EMPTY OrderRequest collection ⇒ zeros/nulls/[], no throw\n");
  await OrderRequest.deleteMany({});
  const pulse = await readPosPulse();
  check("openCount is 0", pulse.openCount === 0);
  check("openTruncated is false", pulse.openTruncated === false);
  check("newestOpenId is null", pulse.newestOpenId === null);
  check("newestOpenAt is null", pulse.newestOpenAt === null);
  check("openRev is null", pulse.openRev === null);
  check("selfOrders is []", Array.isArray(pulse.selfOrders) && pulse.selfOrders.length === 0);
  check("selfOrdersTruncated is false", pulse.selfOrdersTruncated === false);
}

async function leg10(requestId: string): Promise<void> {
  console.log("\nLeg 10 — a replayed accept AFTER a successful claim ⇒ kotPrintedAt stays set (the replay path cannot clear it)\n");
  const before = await OrderRequest.findById(requestId).select("kotPrintedAt").lean();
  check("the request carries kotPrintedAt before the replay (leg4's claim)", before?.kotPrintedAt instanceof Date);

  const replay = await acceptOrderRequest(requestId, AUTO_CTX);
  check("the replay itself succeeds", !("error" in replay));
  if ("error" in replay) throw new Error("leg10: replay unexpectedly failed");
  check("the replay reports replayed:true", replay.replayed === true);

  const after = await OrderRequest.findById(requestId).select("kotPrintedAt").lean();
  check("kotPrintedAt is STILL set after the replay — unchanged, never cleared", after?.kotPrintedAt instanceof Date);
  check("kotPrintedAt's own value did not change", before?.kotPrintedAt?.getTime() === after?.kotPrintedAt?.getTime());
}

async function leg11(): Promise<void> {
  console.log("\nLeg 11 — a CANCELLED order's KOT never prints: the claim resolves the row instead (review C14)\n");
  const req = await stageRequest("parcel", undefined, "9000000011", "LegEleven");
  const accepted = await acceptOrderRequest(String(req._id), AUTO_CTX);
  check("the auto-accept succeeded", !("error" in accepted));
  if ("error" in accepted) throw new Error("leg11: accept unexpectedly failed");
  await Order.updateOne({ orderId: accepted.order.orderId }, { $set: { status: "Cancelled" } });

  const result = await claimKotPrint(String(req._id));
  check("claim refuses: not-eligible", result.claimed === false && result.reason === "not-eligible");
  const row = await OrderRequest.findById(req._id).select("kotPrintedAt").lean();
  check("the row is RESOLVED (kotPrintedAt stamped) so it stops occupying a pulse slot", row?.kotPrintedAt instanceof Date);
  const pulse = await readPosPulse();
  check("the cancelled order's row no longer appears in the pulse", !pulse.selfOrders.some((r) => r.requestId === String(req._id)));
}

async function leg12(): Promise<void> {
  console.log("\nLeg 12 — a round whose EVERY line was voided never prints: the claim resolves the row (review C14)\n");
  const req = await stageRequest("parcel", undefined, "9000000012", "LegTwelve");
  const accepted = await acceptOrderRequest(String(req._id), AUTO_CTX);
  check("the auto-accept succeeded", !("error" in accepted));
  if ("error" in accepted) throw new Error("leg12: accept unexpectedly failed");
  // A full-line void REMOVES the line from order.items (lib/order-void.ts
  // filters it out) — an emptied items array IS the every-line-voided state.
  await Order.updateOne({ orderId: accepted.order.orderId }, { $set: { items: [] } });

  const result = await claimKotPrint(String(req._id));
  check("claim refuses: not-eligible", result.claimed === false && result.reason === "not-eligible");
  const row = await OrderRequest.findById(req._id).select("kotPrintedAt").lean();
  check("the row is resolved (kotPrintedAt stamped)", row?.kotPrintedAt instanceof Date);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([
    Order.createIndexes(),
    OrderRequest.createIndexes(),
    Table.createIndexes(),
    Product.createIndexes(),
    Customer.createIndexes(),
    Counter.createIndexes(),
  ]);

  console.log(`\nCR2.3 §20 self-order alert / D9 auto-print claim — live against ${dbName}\n`);

  try {
    await seedProducts();
    const { requestId: requestId1, tableNo: tableNo1 } = await leg1();
    await leg2(tableNo1);
    await leg3();
    const { requestId: requestId4 } = await leg4();
    await leg5();
    await leg6();
    const { openIds } = await leg7(requestId4);
    await leg8(openIds);
    // leg10 (replay-after-claim) must run BEFORE leg9's deleteMany({}) —
    // leg9 wipes every OrderRequest, including leg4's claimed fixture.
    await leg10(requestId4);
    await leg11();
    await leg12();
    await leg9();
    void requestId1;
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
