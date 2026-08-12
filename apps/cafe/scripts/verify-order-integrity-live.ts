/**
 * CR1.3 live leg — proves the cancel/void write shapes against a REAL MongoDB,
 * which the DB-free unit tests cannot: that a status-guarded filter really
 * matches nothing once it no longer applies, that `$push` really creates an
 * absent `voids` array, and that concurrent conditional updates on the same
 * document leave exactly one winner (the `voidGuardFilter` CAS race) — across
 * every route that races a void: /items (round-fire), /settle, PUT, and DELETE.
 *
 * SCOPE — this script reproduces the exact filter/update documents the cancel
 * (POST /api/orders/[id]/cancel — implemented, see app/api/orders/[id]/cancel/
 * route.ts), item-void (POST /api/orders/[id]/items/void), /items (POST
 * /api/orders/[id]/items) and /settle (POST /api/orders/[id]/settle) routes
 * issue, using the REAL `resolveItemVoid`, `voidGuardFilter`, `resolveSettleMoney`,
 * `ledgerContribution`/`reconcileLedger`, `computeOrderTotals` and
 * `gstConfigFromOrder` helpers plus the REAL `Order`/`Customer`/`Table` models.
 * It deliberately does NOT stand up the HTTP routes themselves — no auth, no
 * session, no Zod body parsing — those are pinned in the node:test suite
 * instead (order-integrity.test.ts's SOURCE PINS section reads the routes'
 * actual source to keep this script's write shapes from drifting off them).
 *
 *   npm run verify:orders:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_order_integrity npm run verify:orders:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end) rather
 * than leaving prior-run leftovers to collide with this run's fixed orderIds.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { orderLineKey } from "@pos/shared/utils";
import { connectDB } from "@/lib/db";
import { Order, type IOrder, type IOrderItem } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { type OrderStatus, type PaymentMode, type GstMode } from "@/lib/constants";
import { computeOrderTotals, gstConfigFromOrder, type GstConfig } from "@/lib/receipt";
import { ledgerContribution, reconcileLedger, resolveSettleMoney } from "@/lib/order";
import { resolveItemVoid, voidGuardFilter, type ItemVoidRequest } from "@/lib/order-void";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}order_integrity`;

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

// ── fixture builders ─────────────────────────────────────────────────────────

function line(
  productId: string,
  name: string,
  price: number,
  qty: number,
  kotRound: number,
): IOrderItem {
  return { productId, name, price, qty, modifiers: [], instructions: "", kotRound };
}

interface BuildOrderOptions {
  orderId: string;
  items: IOrderItem[];
  payment: PaymentMode;
  status?: OrderStatus;
  paidAmount?: number;
  discount?: number;
  gstRate?: number;
  gstMode?: GstMode;
  customerId?: string;
  customerName?: string;
  tableNo?: string;
  kotRounds?: number;
}

// Builds a seedable order document, computing subtotal/gstAmount/total via the
// REAL computeOrderTotals rather than hand-typed numbers, so a fixture is never
// silently wrong about its own bill.
function buildOrder(opts: BuildOrderOptions) {
  const discount = opts.discount ?? 0;
  const gstMode: GstMode = opts.gstMode ?? "exclusive";
  const gstRate = opts.gstRate ?? 0;
  const gstCfg: GstConfig = { gstEnabled: gstRate > 0, gstRate, gstMode };
  const totals = computeOrderTotals(opts.items, discount, gstCfg);
  return {
    orderId: opts.orderId,
    customerId: opts.customerId,
    customerName: opts.customerName ?? "Walk-in",
    items: opts.items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    gstAmount: totals.gstAmount,
    gstRate,
    gstMode,
    total: totals.total,
    paidAmount: opts.paidAmount ?? 0,
    payment: opts.payment,
    status: opts.status ?? "Pending",
    receiver: "Verifier",
    tableNo: opts.tableNo,
    kotRounds: opts.kotRounds ?? 0,
  };
}

type LeanOrder = Pick<
  IOrder,
  | "items"
  | "discount"
  | "gstRate"
  | "gstMode"
  | "kotRounds"
  | "voids"
  | "total"
  | "status"
  | "payment"
  | "customerId"
  | "paidAmount"
> & { _id: mongoose.Types.ObjectId };

// Pure: resolves a void against a snapshot and, if it succeeds, builds the
// exact filter/update the route would send. Split from execution so leg 7 can
// build TWO writes off the SAME read (the concurrency scenario) without a
// second DB round trip re-reading a state one of them already changed.
//
// `expectedVoids` defaults to the snapshot's OWN trail length (a server-read
// equivalent, fine for every leg that does a single fresh read per write), but
// takes an explicit override so leg11 can model the void route's REAL,
// CLIENT-anchored CAS term: the same `expectedVoids` value replayed across two
// attempts even though the server's actual trail length changed in between
// (see order-integrity.test.ts's PIN on voidGuardFilter(parsed.data.expectedVoids)).
function buildVoidWrite(
  old: LeanOrder,
  request: ItemVoidRequest,
  liveGst: GstConfig,
  expectedVoids: number = old.voids?.length ?? 0,
) {
  const gstCfg = gstConfigFromOrder(old, liveGst);
  const resolution = resolveItemVoid({
    items: old.items,
    request,
    discount: old.discount,
    gstCfg,
  });
  if ("error" in resolution) return { ok: false as const, resolution };

  const filter = {
    _id: old._id,
    status: "Pending",
    payment: "Unpaid",
    kotRounds: old.kotRounds,
    ...voidGuardFilter(expectedVoids),
  };
  const update = {
    $set: {
      items: resolution.nextItems,
      subtotal: resolution.totals.subtotal,
      discount: resolution.totals.discount,
      gstAmount: resolution.totals.gstAmount,
      total: resolution.totals.total,
    },
    $push: { voids: resolution.entry },
  };
  return { ok: true as const, resolution, filter, update };
}

// Pure: builds the exact filter/update app/api/orders/[id]/items/route.ts sends
// when firing a new KOT round, so leg9 and the route cannot drift apart. Mirrors
// the route's own read-modify-write: stamp the new items with the next round,
// append to the FULL item set, recompute from the tab's GST snapshot, and guard
// on {status, payment, kotRounds} PLUS the void trail's length — a void changes
// neither status nor kotRounds, so without that last term this write would
// silently resurrect a line a concurrent void just removed.
function buildItemsWrite(
  old: LeanOrder,
  newItems: readonly IOrderItem[],
  discountOverride: number | undefined,
  liveGst: GstConfig,
) {
  const round = (old.kotRounds ?? 0) + 1;
  const stamped = newItems.map((it) => ({ ...it, kotRound: round }));
  const fullItems = [...old.items, ...stamped];
  const discount = discountOverride ?? old.discount;
  const gstCfg = gstConfigFromOrder(old, liveGst);
  const totals = computeOrderTotals(fullItems, discount, gstCfg);

  const filter = {
    _id: old._id,
    status: "Pending",
    payment: "Unpaid",
    kotRounds: old.kotRounds ?? 0,
    ...voidGuardFilter(old.voids?.length ?? 0),
  };
  const update = {
    $set: {
      items: fullItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      gstAmount: totals.gstAmount,
      total: totals.total,
      kotRounds: round,
    },
  };
  return { filter, update, totals, fullItems };
}

// Pure: builds the exact filter/update app/api/orders/[id]/settle/route.ts sends
// (minus the customer-attach bookkeeping, irrelevant to legs that never leave a
// due), so leg10 and the route cannot drift apart. The filter's `total: old.total`
// term is powerless on an already-fully-comped tab (total is 0 both before and
// after a void) — voidGuardFilter is what actually catches that race.
function buildSettleWrite(
  old: LeanOrder,
  settleInput: {
    payment: PaymentMode;
    discount?: number;
    paidAmount?: number;
    splitCash?: number;
    splitOnline?: number;
  },
  liveGst: GstConfig,
) {
  const money = resolveSettleMoney({
    order: old,
    payment: settleInput.payment,
    discount: settleInput.discount,
    paidAmount: settleInput.paidAmount,
    splitCash: settleInput.splitCash,
    splitOnline: settleInput.splitOnline,
    liveGst,
  });
  if ("error" in money) return { ok: false as const, money };

  const update: Record<string, unknown> = {
    payment: settleInput.payment,
    paidAmount: money.paidAmount,
    status: "Completed",
  };
  if (money.totals) {
    update.subtotal = money.totals.subtotal;
    update.discount = money.totals.discount;
    update.gstAmount = money.totals.gstAmount;
    update.total = money.totals.total;
  }
  const filter = {
    _id: old._id,
    status: "Pending",
    total: old.total,
    ...voidGuardFilter(old.voids?.length ?? 0),
  };
  return { ok: true as const, money, filter, update };
}

async function attemptVoid(
  orderId: mongoose.Types.ObjectId,
  request: ItemVoidRequest,
  liveGst: GstConfig,
) {
  const old = await Order.findById(orderId).lean<LeanOrder>();
  if (!old) throw new Error("attemptVoid: seed order is missing");
  const built = buildVoidWrite(old, request, liveGst);
  if (!built.ok) return { old, resolution: built.resolution, result: null };
  const result = await Order.findOneAndUpdate(built.filter, built.update, {
    new: true,
    runValidators: true,
  }).lean();
  return { old, resolution: built.resolution, result };
}

// Deliberately NOT the tab's own snapshot config, to prove gstConfigFromOrder
// prices a void off the order's stored gstRate/gstMode, never live settings.
const LIVE_GST_FALLBACK: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };

// ── legs ──────────────────────────────────────────────────────────────────────

async function leg1(): Promise<void> {
  console.log("\nLeg 1 — cancel an OPEN tab: table frees, ledger untouched\n");

  await Table.create({
    tableNo: "T-1",
    capacity: 4,
    status: "Occupied",
    currentOrderId: "ORD-LEG1-001",
  });
  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG1-001",
      items: [line("p-tea", "Tea", 100, 2, 1)],
      payment: "Unpaid",
      status: "Pending",
      tableNo: "T-1",
    }),
  );

  const reason = "Guest left before ordering";
  const cancelledBy = "Admin";
  const cancelledAt = new Date();
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: "Pending" },
    { $set: { status: "Cancelled", cancelReason: reason, cancelledBy, cancelledAt } },
    { new: true },
  ).lean();
  check(
    "cancel write matches the Pending tab and sets the full trail",
    updated?.status === "Cancelled" &&
      updated?.cancelReason === reason &&
      updated?.cancelledBy === cancelledBy &&
      updated?.cancelledAt?.getTime() === cancelledAt.getTime(),
  );

  const freedTable = await Table.findOneAndUpdate(
    { tableNo: order.tableNo, currentOrderId: order.orderId },
    { $set: { status: "Available", currentOrderId: "" } },
    { new: true },
  ).lean();
  check(
    "the guarded {tableNo, currentOrderId} write matches and frees the table",
    freedTable?.status === "Available" && freedTable?.currentOrderId === "",
  );

  const oldShape = {
    customerId: order.customerId,
    payment: order.payment,
    total: order.total,
    paidAmount: order.paidAmount,
    status: "Pending" as OrderStatus,
  };
  const newShape = { ...oldShape, status: "Cancelled" as OrderStatus };
  check(
    "ledgerContribution is zero both before and after — a held tab never contributed",
    JSON.stringify(ledgerContribution(oldShape)) === JSON.stringify({ visits: 0, spend: 0, due: 0 }) &&
      JSON.stringify(ledgerContribution(newShape)) === JSON.stringify({ visits: 0, spend: 0, due: 0 }),
  );

  const touched = await reconcileLedger(oldShape, newShape);
  check("reconcileLedger touches no customer for a held tab (nothing to reverse)", touched.size === 0);
}

async function leg2(): Promise<void> {
  console.log("\nLeg 2 — cancelling a SETTLED order reverses exactly its own contribution\n");

  const customer = await Customer.create({
    name: "Leg2 Customer",
    mobile: "9990000020",
    visits: 5,
    totalSpend: 5000,
    totalDue: 200,
  });
  const customerId = customer._id.toString();

  const openShape = {
    customerId,
    payment: "Unpaid" as PaymentMode,
    total: 1000,
    paidAmount: 0,
    status: "Pending" as OrderStatus,
  };
  const settledShape = {
    customerId,
    payment: "Cash" as PaymentMode,
    total: 1000,
    paidAmount: 700,
    status: "Completed" as OrderStatus,
  };

  const settleTouched = await reconcileLedger(openShape, settledShape);
  check("settling touches exactly this customer", settleTouched.size === 1 && settleTouched.has(customerId));

  const afterSettle = await Customer.findById(customerId).lean();
  check(
    "customer carries its pre-existing baseline PLUS the settle's real contribution",
    afterSettle?.visits === 6 && afterSettle?.totalSpend === 6000 && afterSettle?.totalDue === 500,
  );

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG2-001",
      items: [line("p-thali", "Thali", 1000, 1, 1)],
      payment: "Cash",
      paidAmount: 700,
      status: "Completed",
      customerId,
      customerName: "Leg2 Customer",
    }),
  );
  check("seeded settled order carries the same total the ledger math used", order.total === 1000);

  // Mirrors the cancel route's actual CAS: keyed on the status we READ, so the
  // filter is "Completed" here and "Pending" in leg 1 — one filter shape that
  // covers both, and a cancel racing a settle resolves to exactly one winner.
  const cancelFilter = { _id: order._id, status: order.status };
  const cancelUpdate = {
    $set: {
      status: "Cancelled",
      cancelReason: "Kitchen error — refunded in cash",
      cancelledBy: "Admin",
      cancelledAt: new Date(),
    },
  };
  const cancelled = await Order.findOneAndUpdate(cancelFilter, cancelUpdate, { new: true }).lean();
  check("a settled (Completed) order can still be cancelled — admin break-glass", cancelled?.status === "Cancelled");

  const cancelledShape = { ...settledShape, status: "Cancelled" as OrderStatus };
  await reconcileLedger(settledShape, cancelledShape);

  const afterCancel = await Customer.findById(customerId).lean();
  check(
    "cancelling reverses visits/spend/due back to EXACTLY the pre-settle baseline",
    afterCancel?.visits === 5 && afterCancel?.totalSpend === 5000 && afterCancel?.totalDue === 200,
  );
  check(
    "nothing went negative along the way",
    (afterCancel?.visits ?? -1) >= 0 && (afterCancel?.totalSpend ?? -1) >= 0 && (afterCancel?.totalDue ?? -1) >= 0,
  );
}

async function leg3(): Promise<void> {
  console.log("\nLeg 3 — double cancel matches nothing the second time; the ledger is never reversed twice\n");

  const customer = await Customer.create({
    name: "Leg3 Customer",
    mobile: "9990000030",
    visits: 5,
    totalSpend: 5000,
    totalDue: 200,
  });
  const customerId = customer._id.toString();

  // Model "already settled" the same way leg 2 does — this leg is about the
  // CANCEL guard specifically, not the settle path (leg 2 already covers that).
  const openShape = {
    customerId,
    payment: "Unpaid" as PaymentMode,
    total: 1000,
    paidAmount: 0,
    status: "Pending" as OrderStatus,
  };
  const settledShape = {
    customerId,
    payment: "Cash" as PaymentMode,
    total: 1000,
    paidAmount: 700,
    status: "Completed" as OrderStatus,
  };
  await reconcileLedger(openShape, settledShape);

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG3-001",
      items: [line("p-item", "Item", 1000, 1, 1)],
      payment: "Cash",
      paidAmount: 700,
      status: "Completed",
      customerId,
      customerName: "Leg3 Customer",
    }),
  );

  // Built ONCE from the pre-cancel read and reused, exactly as a second device
  // holding a stale view of the order would: the route's CAS is keyed on the status
  // it read, so the replay must match nothing rather than reverse the ledger twice.
  const cancelFilter = { _id: order._id, status: order.status };
  const cancelUpdate = {
    $set: { status: "Cancelled", cancelReason: "Refund requested", cancelledBy: "Admin", cancelledAt: new Date() },
  };

  const first = await Order.updateOne(cancelFilter, cancelUpdate);
  check(
    "first cancel matches and modifies the settled order",
    first.matchedCount === 1 && first.modifiedCount === 1,
  );
  await reconcileLedger(settledShape, { ...settledShape, status: "Cancelled" });

  const afterFirst = await Customer.findById(customerId).lean();
  check(
    "ledger returns exactly to baseline after the first cancel",
    afterFirst?.visits === 5 && afterFirst?.totalSpend === 5000 && afterFirst?.totalDue === 200,
  );

  const second = await Order.updateOne(cancelFilter, cancelUpdate);
  check(
    "double cancel matches nothing (matchedCount and modifiedCount both 0)",
    second.matchedCount === 0 && second.modifiedCount === 0,
  );

  // Because the write above never matched, a route that only calls
  // reconcileLedger after a successful conditional update structurally never
  // re-enters it — so the correct proof here is that the ledger is STILL
  // sitting at baseline, not doubly-reversed into negative or overshoot.
  const afterSecond = await Customer.findById(customerId).lean();
  check(
    "the ledger is untouched by the no-op second cancel — reversed exactly once",
    afterSecond?.visits === 5 && afterSecond?.totalSpend === 5000 && afterSecond?.totalDue === 200,
  );
}

async function leg4(): Promise<void> {
  console.log("\nLeg 4 — qty-reduce void on a tab with two KOT rounds\n");

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG4-001",
      items: [line("p-tea", "Tea", 100, 3, 1), line("p-coffee", "Coffee", 150, 2, 2)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 2,
      gstRate: 10,
      gstMode: "exclusive",
    }),
  );

  const request: ItemVoidRequest = {
    index: 0,
    lineKey: orderLineKey(order.items[0]),
    qty: 1,
    reason: "Guest changed mind",
    voidedBy: "Staff B",
    at: new Date(),
  };
  const { old, resolution, result } = await attemptVoid(order._id, request, LIVE_GST_FALLBACK);
  check("resolveItemVoid accepts a valid qty-reduce", !("error" in resolution));
  check("the guarded write matches and applies", result !== null);
  if (!result || "error" in resolution) return;

  const teaLine = result.items.find((it) => it.productId === "p-tea");
  check("the voided line's qty dropped by exactly the voided amount (3 → 2)", teaLine?.qty === 2);

  const gstCfg = gstConfigFromOrder(old, LIVE_GST_FALLBACK);
  const oracle = computeOrderTotals(result.items, old.discount, gstCfg);
  check(
    "persisted subtotal/gstAmount/total match computeOrderTotals over what remains, using the TAB's GST snapshot",
    result.subtotal === oracle.subtotal && result.gstAmount === oracle.gstAmount && result.total === oracle.total,
  );

  check(
    "voids has exactly one entry recording the VOIDED qty (1), not the remaining qty",
    (result.voids?.length ?? 0) === 1 &&
      result.voids?.[0]?.qty === 1 &&
      result.voids?.[0]?.productId === "p-tea",
  );
  check("kotRounds is unchanged by a void", result.kotRounds === 2);
}

async function leg5(): Promise<void> {
  console.log("\nLeg 5 — voiding a WHOLE line on a multi-line tab; $push creates voids from absent\n");

  const seeded = buildOrder({
    orderId: "ORD-LEG5-001",
    items: [line("p-tea", "Tea", 100, 3, 1), line("p-coffee", "Coffee", 150, 2, 1)],
    payment: "Unpaid",
    status: "Pending",
    kotRounds: 1,
    gstRate: 10,
    gstMode: "exclusive",
  });
  const order = await Order.create(seeded);

  const beforeRaw = await Order.findById(order._id).lean();
  check(
    "the seeded tab has NO voids field at all (absent, not [])",
    !!beforeRaw && !("voids" in beforeRaw),
  );

  const request: ItemVoidRequest = {
    index: 1,
    lineKey: orderLineKey(order.items[1]),
    qty: 2,
    reason: "Wrong item fired",
    voidedBy: "Staff C",
    at: new Date(),
  };
  const { old, resolution, result } = await attemptVoid(order._id, request, LIVE_GST_FALLBACK);
  check("resolveItemVoid accepts voiding the whole line", !("error" in resolution));
  if (!result || "error" in resolution) return;

  check("the voided line is gone from items", result.items.every((it) => it.productId !== "p-coffee"));
  check(
    "the other line survives, untouched",
    result.items.length === 1 && result.items[0].productId === "p-tea" && result.items[0].qty === 3,
  );

  const gstCfg = gstConfigFromOrder(old, LIVE_GST_FALLBACK);
  const oracle = computeOrderTotals(result.items, old.discount, gstCfg);
  check(
    "money is recomputed over what remains",
    result.subtotal === oracle.subtotal && result.gstAmount === oracle.gstAmount && result.total === oracle.total,
  );

  check("$push created voids from ABSENT with exactly one entry", (result.voids?.length ?? 0) === 1);
}

async function leg6(): Promise<void> {
  console.log("\nLeg 6 — voiding the LAST remaining line is refused (400), no write happens\n");

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG6-001",
      items: [line("p-solo", "Solo Item", 100, 1, 1)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 1,
    }),
  );

  const before = await Order.findById(order._id).lean();
  const request: ItemVoidRequest = {
    index: 0,
    lineKey: orderLineKey(before!.items[0]),
    qty: 1,
    reason: "Test",
    voidedBy: "Staff D",
    at: new Date(),
  };
  const gstCfg = gstConfigFromOrder(before!, LIVE_GST_FALLBACK);
  const resolution = resolveItemVoid({
    items: before!.items,
    request,
    discount: before!.discount,
    gstCfg,
  });
  check(
    "resolveItemVoid refuses to empty a tab — 400, not 409 (nothing about the request itself is wrong)",
    "error" in resolution && resolution.status === 400,
  );

  // The route only issues the conditional write when resolveItemVoid succeeds;
  // since it errored, no write is attempted here either — prove the document
  // is byte-for-byte unchanged rather than merely asserting "we skipped a call".
  const after = await Order.findById(order._id).lean();
  check(
    "the order is untouched byte-wise since no write was ever attempted",
    JSON.stringify(before) === JSON.stringify(after),
  );
}

async function leg7(): Promise<void> {
  console.log("\nLeg 7 — two CONCURRENT voids of the same line: exactly one wins the CAS guard\n");

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG7-001",
      items: [line("p-x", "Item X", 50, 5, 1)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 1,
    }),
  );

  const old = await Order.findById(order._id).lean<LeanOrder>();
  if (!old) throw new Error("leg7: seed order is missing");

  // Both requests are built off the SAME read — the actual race a real UI
  // would produce if two devices void the same line before either refreshes.
  const requestA: ItemVoidRequest = {
    index: 0,
    lineKey: orderLineKey(old.items[0]),
    qty: 1,
    reason: "Device A",
    voidedBy: "Staff A",
    at: new Date(),
  };
  const requestB: ItemVoidRequest = {
    index: 0,
    lineKey: orderLineKey(old.items[0]),
    qty: 1,
    reason: "Device B",
    voidedBy: "Staff B",
    at: new Date(),
  };
  const builtA = buildVoidWrite(old, requestA, LIVE_GST_FALLBACK);
  const builtB = buildVoidWrite(old, requestB, LIVE_GST_FALLBACK);
  if (!builtA.ok || !builtB.ok) {
    throw new Error("leg7: both requests should resolve cleanly against the same read");
  }

  const [resultA, resultB] = await Promise.all([
    Order.findOneAndUpdate(builtA.filter, builtA.update, { new: true, runValidators: true }).lean(),
    Order.findOneAndUpdate(builtB.filter, builtB.update, { new: true, runValidators: true }).lean(),
  ]);

  const winners = [resultA, resultB].filter((r) => r !== null);
  check("exactly one of the two concurrent voids wins the CAS guard", winners.length === 1);

  const final = await Order.findById(order._id).lean();
  check("the trail has exactly one entry, not two", (final?.voids?.length ?? 0) === 1);
  check("the line was reduced exactly once (5 → 4), not twice (5 → 3)", final?.items[0]?.qty === 4);
}

async function leg8(): Promise<void> {
  console.log("\nLeg 8 — post-cancel immutability: neither the /items nor the /settle write shape matches\n");

  // Seeded directly as Cancelled — this leg is about the GUARD on the OTHER
  // routes, not the cancel write itself (legs 1-3 already cover that).
  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG8-001",
      items: [line("p-y", "Item Y", 200, 1, 1)],
      payment: "Unpaid",
      status: "Cancelled",
      kotRounds: 1,
    }),
  );

  const itemsGuard = await Order.updateOne(
    { _id: order._id, status: "Pending", payment: "Unpaid", kotRounds: order.kotRounds },
    { $set: { kotRounds: order.kotRounds + 1 } },
  );
  check(
    "the /items write shape ({_id, status:'Pending', payment:'Unpaid', kotRounds}) matches nothing",
    itemsGuard.matchedCount === 0 && itemsGuard.modifiedCount === 0,
  );

  const settleGuard = await Order.updateOne(
    { _id: order._id, status: "Pending", total: order.total },
    { $set: { status: "Completed" } },
  );
  check(
    "the /settle write shape ({_id, status:'Pending', total}) matches nothing",
    settleGuard.matchedCount === 0 && settleGuard.modifiedCount === 0,
  );
}

async function leg9(): Promise<void> {
  console.log(
    "\nLeg 9 — /items round-fire vs a concurrent void (THE confirmed bug): a stale-read round-fire must not resurrect the voided line\n",
  );

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG9-001",
      items: [line("p-tea", "Tea", 100, 3, 1), line("p-coffee", "Coffee", 150, 1, 1)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 1,
    }),
  );

  // Snapshot S — the /items read, BEFORE the concurrent void commits.
  const staleSnapshot = await Order.findById(order._id).lean<LeanOrder>();
  if (!staleSnapshot) throw new Error("leg9: seed order missing");

  // A concurrent void commits off a FRESH read: void the whole Coffee line.
  const voidRequest: ItemVoidRequest = {
    index: 1,
    lineKey: orderLineKey(staleSnapshot.items[1]),
    qty: 1,
    reason: "Wrong item fired",
    voidedBy: "Staff F",
    at: new Date(),
  };
  const { result: voidResult } = await attemptVoid(order._id, voidRequest, LIVE_GST_FALLBACK);
  check("the concurrent void lands", voidResult !== null);

  // The round-fire write built from the STALE snapshot (taken before the void),
  // using the SAME filter shape the route now issues (kotRounds + voidGuardFilter).
  const newItem = line("p-water", "Water", 20, 1, 0); // kotRound is stamped by buildItemsWrite
  const staleWrite = buildItemsWrite(staleSnapshot, [newItem], undefined, LIVE_GST_FALLBACK);
  const staleAttempt = await Order.findOneAndUpdate(staleWrite.filter, staleWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check(
    "the round-fire write built from the stale (pre-void) read MATCHES NOTHING — the void changed voids[] length under it",
    staleAttempt === null,
  );

  const afterStaleAttempt = await Order.findById(order._id).lean();
  check(
    "the stored doc still shows the void's own result: Coffee gone, one entry in voids[], Water never added",
    (afterStaleAttempt?.items.length ?? -1) === 1 &&
      // `=== true` because the optional chain yields boolean | undefined, and
      // check() takes a strict boolean — a bare `&&` chain would type as
      // possibly-undefined and (worse) read as a pass-by-accident.
      afterStaleAttempt?.items.every((it) => it.productId !== "p-coffee") === true &&
      (afterStaleAttempt?.voids?.length ?? 0) === 1,
  );
  check(
    "the reduced total from the void survives untouched by the failed round-fire attempt",
    afterStaleAttempt?.total === 300, // 3 Tea @ 100, Coffee voided out
  );
  check("kotRounds is unchanged by the failed round-fire attempt", afterStaleAttempt?.kotRounds === 1);

  // Control: the SAME round-fire, built from a FRESH read (post-void), succeeds —
  // proving the filter above is satisfiable and this isn't a typo'd dead filter.
  const freshSnapshot = await Order.findById(order._id).lean<LeanOrder>();
  if (!freshSnapshot) throw new Error("leg9: post-void read missing");
  const freshWrite = buildItemsWrite(freshSnapshot, [newItem], undefined, LIVE_GST_FALLBACK);
  const freshAttempt = await Order.findOneAndUpdate(freshWrite.filter, freshWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check(
    "the SAME write shape built from a FRESH read succeeds (the filter is satisfiable, not a dead end)",
    freshAttempt !== null,
  );
  check("kotRounds advances to 2 on the successful fresh write", freshAttempt?.kotRounds === 2);
}

async function leg10(): Promise<void> {
  console.log(
    "\nLeg 10 — /settle vs a concurrent void on a FULLY COMPED tab: the total-CAS alone can't see it\n",
  );

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG10-001",
      items: [line("p-a", "Item A", 300, 1, 1), line("p-b", "Item B", 200, 1, 1)],
      payment: "Unpaid",
      status: "Pending",
      discount: 500, // subtotal 500, discount 500 -> total 0, fully comped
      kotRounds: 1,
    }),
  );
  check("seed order is fully comped (total 0) before anything races", order.total === 0);

  // Snapshot S — the /settle read, BEFORE the concurrent void commits.
  const staleSnapshot = await Order.findById(order._id).lean<LeanOrder>();
  if (!staleSnapshot) throw new Error("leg10: seed order missing");

  // A concurrent void commits off a FRESH read: void the whole Item B line. The
  // surviving Item A (300) re-clamps the stale 500 discount down to 300, so the
  // total STAYS 0 — exactly the case a bare `total: old.total` CAS cannot see.
  const voidRequest: ItemVoidRequest = {
    index: 1,
    lineKey: orderLineKey(staleSnapshot.items[1]),
    qty: 1,
    reason: "Comped item removed",
    voidedBy: "Staff G",
    at: new Date(),
  };
  const { result: voidResult } = await attemptVoid(order._id, voidRequest, LIVE_GST_FALLBACK);
  check(
    "the concurrent void lands, and the total is STILL 0 after it (the re-clamp, not a coincidence)",
    voidResult !== null && voidResult.total === 0,
  );

  // The settle write built from the STALE snapshot, mirroring the real route's
  // filter/update exactly (see buildSettleWrite).
  const staleSettle = buildSettleWrite(staleSnapshot, { payment: "Cash" }, LIVE_GST_FALLBACK);
  if (!staleSettle.ok) throw new Error("leg10: stale settle should resolve cleanly (no error path)");
  const staleAttempt = await Order.findOneAndUpdate(staleSettle.filter, staleSettle.update, {
    new: true,
    runValidators: true,
  }).lean();
  check(
    "the stale settle write matches NOTHING even though total:0 == total:0 — voidGuardFilter is what catches it",
    staleAttempt === null,
  );

  const final = await Order.findById(order._id).lean();
  check(
    "no bill was ever settled — status is still Pending, so the voided line was never charged",
    final?.status === "Pending",
  );
}

async function leg11(): Promise<void> {
  console.log(
    "\nLeg 11 — void retry idempotency: replaying the SAME expectedVoids after the first attempt already landed matches nothing\n",
  );

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG11-001",
      items: [line("p-z", "Item Z", 100, 5, 1)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 1,
    }),
  );
  const old = await Order.findById(order._id).lean<LeanOrder>();
  if (!old) throw new Error("leg11: seed order missing");

  const request: ItemVoidRequest = {
    index: 0,
    lineKey: orderLineKey(old.items[0]),
    qty: 1,
    reason: "Retry test",
    voidedBy: "Staff E",
    at: new Date(),
  };
  // What the CLIENT's view says — fixed across both attempts, exactly like a
  // resend of an unacknowledged request would carry the SAME expectedVoids.
  const EXPECTED_VOIDS = old.voids?.length ?? 0;

  const first = buildVoidWrite(old, request, LIVE_GST_FALLBACK, EXPECTED_VOIDS);
  if (!first.ok) throw new Error("leg11: first void should resolve cleanly");
  const firstResult = await Order.findOneAndUpdate(first.filter, first.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("first void attempt matches and applies", firstResult !== null);

  // The retry rebuilds the SAME write from the SAME stale `old` + SAME
  // expectedVoids — exactly what a client resend of an unacknowledged request
  // looks like, regardless of what actually happened server-side in between.
  const retry = buildVoidWrite(old, request, LIVE_GST_FALLBACK, EXPECTED_VOIDS);
  if (!retry.ok) throw new Error("leg11: retry should resolve the same way structurally");
  const retryResult = await Order.findOneAndUpdate(retry.filter, retry.update, {
    new: true,
    runValidators: true,
  }).lean();
  check(
    "the retried write matches nothing — voidGuardFilter(expectedVoids) now disagrees with the real trail length",
    retryResult === null,
  );

  const final = await Order.findById(order._id).lean();
  check("voids stays length 1 (not doubled)", (final?.voids?.length ?? 0) === 1);
  check("the line's qty was reduced exactly once (5 -> 4)", final?.items[0]?.qty === 4);
}

async function leg12(): Promise<void> {
  console.log("\nLeg 12 — PUT vs a concurrent cancel: the stale-read PUT write matches nothing\n");

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG12-001",
      items: [line("p-put", "Put Item", 100, 1, 1)],
      payment: "Unpaid",
      status: "Pending",
      customerName: "Original Name",
    }),
  );

  // The PUT handler's own stale read — what a second device saw before the
  // cancel committed.
  const staleRead = await Order.findById(order._id).lean();
  if (!staleRead) throw new Error("leg12: seed order missing");

  // A FRESH read commits the cancel first (mirrors the real cancel route's CAS
  // — see leg2/leg3's identical filter shape).
  const freshRead = await Order.findById(order._id).lean();
  if (!freshRead) throw new Error("leg12: seed order missing (fresh)");
  const cancelled = await Order.findOneAndUpdate(
    { _id: order._id, status: freshRead.status },
    {
      $set: {
        status: "Cancelled",
        cancelReason: "Refund",
        cancelledBy: "Admin",
        cancelledAt: new Date(),
      },
    },
    { new: true },
  ).lean();
  check("the concurrent cancel lands first", cancelled?.status === "Cancelled");

  // The PUT write built from the STALE (pre-cancel) read, exactly as
  // app/api/orders/[id]/route.ts's PUT handler builds it: keyed on the status
  // it read.
  const putFilter = { _id: order._id, status: staleRead.status };
  const putUpdate = { customerName: "Renamed By Stale PUT" };
  const putResult = await Order.findOneAndUpdate(putFilter, putUpdate, { new: true }).lean();
  check("the stale PUT write matches nothing — status moved under it", putResult === null);

  const final = await Order.findById(order._id).lean();
  check(
    "the cancelled order is untouched by the stale PUT (name still the pre-cancel original, status still Cancelled)",
    final?.customerName === "Original Name" && final?.status === "Cancelled",
  );
}

async function leg13(): Promise<void> {
  console.log(
    "\nLeg 13 — DELETE racing DELETE: only the caller whose delete actually matched may reverse the ledger\n",
  );

  const customer = await Customer.create({
    name: "Leg13 Customer",
    mobile: "9990000130",
    visits: 5,
    totalSpend: 5000,
    totalDue: 200,
  });
  const customerId = customer._id.toString();

  const order = await Order.create(
    buildOrder({
      orderId: "ORD-LEG13-001",
      items: [line("p-del", "Delete Item", 1000, 1, 1)],
      payment: "Cash",
      paidAmount: 700,
      status: "Completed",
      customerId,
      customerName: "Leg13 Customer",
    }),
  );

  // Model the settle's own ledger application so the baseline matches what a
  // real settled order would already have applied (mirrors leg2/leg3's setup).
  await reconcileLedger(
    { customerId, payment: "Unpaid", total: 1000, paidAmount: 0, status: "Pending" },
    { customerId, payment: "Cash", total: 1000, paidAmount: 700, status: "Completed" },
  );
  const beforeDelete = await Customer.findById(customerId).lean();
  check(
    "customer carries its pre-existing baseline PLUS the settle's contribution before either delete races",
    beforeDelete?.visits === 6 && beforeDelete?.totalSpend === 6000 && beforeDelete?.totalDue === 500,
  );

  // Two concurrent DELETE calls on the SAME order — findByIdAndDelete is
  // atomic, so only ONE of these actually matches and removes the row; the
  // loser gets null and (per the route) must never call reconcileLedger.
  const [deleteA, deleteB] = await Promise.all([
    Order.findByIdAndDelete(order._id).lean(),
    Order.findByIdAndDelete(order._id).lean(),
  ]);
  const winners = [deleteA, deleteB].filter((d): d is NonNullable<typeof d> => d !== null);
  check("exactly one of the two concurrent deletes actually matched the row", winners.length === 1);

  // Only the winner's route invocation would ever reach reconcileLedger —
  // reproduce that exactly: reverse the ledger ONCE, from the winner's own
  // pre-delete snapshot.
  const winner = winners[0]!;
  await reconcileLedger(
    {
      customerId: winner.customerId,
      payment: winner.payment,
      total: winner.total,
      paidAmount: winner.paidAmount,
      status: winner.status,
    },
    null,
  );

  const afterDelete = await Customer.findById(customerId).lean();
  check(
    "visits/spend/due land at the single-reversal baseline — not doubly reversed",
    afterDelete?.visits === 5 && afterDelete?.totalSpend === 5000 && afterDelete?.totalDue === 200,
  );
  check(
    "nothing went negative along the way",
    (afterDelete?.visits ?? -1) >= 0 && (afterDelete?.totalSpend ?? -1) >= 0 && (afterDelete?.totalDue ?? -1) >= 0,
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
  await Promise.all([Order.createIndexes(), Customer.createIndexes(), Table.createIndexes()]);

  console.log(`\nCR1.3 order integrity — live against ${dbName}\n`);

  try {
    await leg1();
    await leg2();
    await leg3();
    await leg4();
    await leg5();
    await leg6();
    await leg7();
    await leg8();
    await leg9();
    await leg10();
    await leg11();
    await leg12();
    await leg13();
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
