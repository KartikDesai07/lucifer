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
import { resolveTableCharge } from "@/lib/table-admin";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
import { nextSlipSequence } from "@/models/Counter";

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
  // No table-charge fixture option on these seeded orders — charge-free tabs.
  const totals = computeOrderTotals({ items: opts.items, discount, charge: 0, cfg: gstCfg });
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
  | "chargeAmount"
  | "kotRounds"
  | "kotNumbers"
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
    // The tab's snapshotted table charge rides through a void unchanged.
    charge: old.chargeAmount ?? 0,
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

// Defect 1 fix, mirrored exactly: app/api/orders/[id]/items/route.ts builds
// kotNumbers POSITIONALLY at index round-1, never by appending. Every round
// below the one just numbered that was never itself numbered — either because
// numbering was off when it fired, or the tab predates the field entirely —
// is padded with 0 (a safe sentinel: printedSlipNumber floors at
// PRINT_NUMBER_START_MIN, so 0 is never a printable number). Appending instead
// files THIS round's ticket under an earlier round's array index the moment
// any tab carries a SHORT kotNumbers array — the confirmed bug leg17 exists to
// catch, and this is the ONE place both the route and this script build the
// array, so they cannot drift apart again.
function buildKotNumbers(
  oldKotNumbers: number[] | undefined,
  round: number,
  ticket: number | undefined,
): number[] | undefined {
  if (ticket === undefined) return undefined;
  return Array.from({ length: round }, (_, i) => (i === round - 1 ? ticket : (oldKotNumbers?.[i] ?? 0)));
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
  // Defect 2 fix: omitted means "unchanged" (carry the tab's snapshotted
  // charge forward), exactly like `discountOverride` above — pass an explicit
  // number (0 = waived) to mirror what a round-fire payload now carries.
  chargeOverride?: number,
  // Defect 1 fix: the kot ticket THIS round issues, if numbering is on
  // (mirrors the route's `printCfg.kot.showNumber ? printedSlipNumber(...) :
  // undefined`) — omitted means numbering is off, so kotNumbers is untouched.
  kotTicket?: number,
) {
  const round = (old.kotRounds ?? 0) + 1;
  const stamped = newItems.map((it) => ({ ...it, kotRound: round }));
  const fullItems = [...old.items, ...stamped];
  const discount = discountOverride ?? old.discount;
  const gstCfg = gstConfigFromOrder(old, liveGst);
  const charge = chargeOverride ?? old.chargeAmount ?? 0;
  const totals = computeOrderTotals({ items: fullItems, discount, charge, cfg: gstCfg });
  const kotNumbers = buildKotNumbers(old.kotNumbers, round, kotTicket);

  const filter = {
    _id: old._id,
    status: "Pending",
    payment: "Unpaid",
    kotRounds: old.kotRounds ?? 0,
    ...voidGuardFilter(old.voids?.length ?? 0),
  };
  // Mirrors app/api/orders/[id]/items/route.ts exactly: a waived charge (0) is
  // UNSET, never left stored as a 0 sitting beside its old label — the receipt
  // keys its charge line off the amount being PRESENT.
  const update: Record<string, unknown> = {
    $set: {
      items: fullItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      gstAmount: totals.gstAmount,
      total: totals.total,
      kotRounds: round,
      ...(totals.charge > 0 ? { chargeAmount: totals.charge } : {}),
      ...(kotNumbers ? { kotNumbers } : {}),
    },
  };
  if (totals.charge <= 0) {
    update.$unset = { chargeAmount: "", chargeLabel: "" };
  }
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
    // Settle-time waiver/adjustment of the table charge — mirrors resolveSettleMoney's
    // own option: undefined leaves the tab's stored charge alone.
    chargeAmount?: number;
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
    chargeAmount: settleInput.chargeAmount,
    paidAmount: settleInput.paidAmount,
    splitCash: settleInput.splitCash,
    splitOnline: settleInput.splitOnline,
    liveGst,
  });
  if ("error" in money) return { ok: false as const, money };

  const set: Record<string, unknown> = {
    payment: settleInput.payment,
    paidAmount: money.paidAmount,
    status: "Completed",
  };
  const unset: Record<string, ""> = {};
  if (money.totals) {
    set.subtotal = money.totals.subtotal;
    set.discount = money.totals.discount;
    set.gstAmount = money.totals.gstAmount;
    set.total = money.totals.total;
    // Mirrors app/api/orders/[id]/settle/route.ts exactly: a waived charge (0)
    // must be UNSET, never stored as a 0 sitting beside its old label.
    if (money.totals.charge > 0) {
      set.chargeAmount = money.totals.charge;
    } else {
      unset.chargeAmount = "";
      unset.chargeLabel = "";
    }
  }
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;
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
  const oracle = computeOrderTotals({
    items: result.items,
    discount: old.discount,
    charge: old.chargeAmount ?? 0,
    cfg: gstCfg,
  });
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
  const oracle = computeOrderTotals({
    items: result.items,
    discount: old.discount,
    charge: old.chargeAmount ?? 0,
    cfg: gstCfg,
  });
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
    // The tab's snapshotted table charge rides through a void unchanged.
    charge: before!.chargeAmount ?? 0,
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

async function leg14(): Promise<void> {
  console.log(
    "\nLeg 14 — a table's extra charge rides an order end-to-end: create snapshots it, a KOT round and a void both carry it forward, and a chargeAmount:0 settle UNSETS both fields\n",
  );

  await Table.create({
    tableNo: "T-CHARGE",
    capacity: 4,
    status: "Available",
    chargeAmount: 50,
    chargeLabel: "Rooftop charge",
  });

  const resolved = await resolveTableCharge("T-CHARGE");
  if ("error" in resolved) throw new Error("leg14: resolveTableCharge failed against the seeded table");
  check(
    "resolveTableCharge reads the table's configured amount + label",
    resolved.charge.amount === 50 && resolved.charge.label === "Rooftop charge",
  );

  const gstCfg: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };
  const openingItems = [line("p-main", "Main Course", 300, 1, 1)];
  // Mirrors app/api/orders/route.ts's own create doc: chargeAmount/chargeLabel
  // are snapshotted from the table ONLY when the resolved charge is > 0, and the
  // label always comes from the table, never the request.
  const openingTotals = computeOrderTotals({
    items: openingItems,
    discount: 0,
    charge: resolved.charge.amount,
    cfg: gstCfg,
  });
  const order = await Order.create({
    orderId: "ORD-LEG14-001",
    customerName: "Walk-in",
    items: openingItems,
    subtotal: openingTotals.subtotal,
    discount: openingTotals.discount,
    gstAmount: openingTotals.gstAmount,
    gstRate: 0,
    gstMode: "exclusive",
    chargeAmount: openingTotals.charge > 0 ? openingTotals.charge : undefined,
    chargeLabel: openingTotals.charge > 0 ? resolved.charge.label : undefined,
    total: openingTotals.total,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Verifier",
    tableNo: "T-CHARGE",
    kotRounds: 1,
  });
  check("an order created on a charged table stores chargeAmount", order.chargeAmount === 50);
  check("an order created on a charged table stores chargeLabel", order.chargeLabel === "Rooftop charge");
  check("the opening total includes the charge on top of the items (300 + 50 = 350)", order.total === 350);

  // Add a KOT round — the charge must ride forward untouched (buildItemsWrite
  // carries `old.chargeAmount ?? 0` through unchanged, mirroring the real route),
  // and the total must grow by EXACTLY the new item's price.
  const afterCreate = await Order.findById(order._id).lean<LeanOrder>();
  if (!afterCreate) throw new Error("leg14: seed order missing after create");
  const newItem = line("p-side", "Side Dish", 80, 1, 0); // kotRound stamped by buildItemsWrite
  const roundWrite = buildItemsWrite(afterCreate, [newItem], undefined, gstCfg);
  const afterRound = await Order.findOneAndUpdate(roundWrite.filter, roundWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("adding a KOT round succeeds", afterRound !== null);
  check(
    "the charge survives a new KOT round unchanged",
    afterRound?.chargeAmount === 50 && afterRound?.chargeLabel === "Rooftop charge",
  );
  check("the total grows by exactly the new item's price (350 + 80 = 430)", afterRound?.total === 430);

  // Void the ORIGINAL line entirely — the charge must still ride forward
  // (buildVoidWrite carries `old.chargeAmount ?? 0` through too).
  const beforeVoid = await Order.findById(order._id).lean<LeanOrder>();
  if (!beforeVoid) throw new Error("leg14: seed order missing before void");
  const voidRequest: ItemVoidRequest = {
    index: 0,
    lineKey: orderLineKey(beforeVoid.items[0]),
    qty: 1,
    reason: "Guest changed mind",
    voidedBy: "Verifier",
    at: new Date(),
  };
  const { result: afterVoid } = await attemptVoid(order._id, voidRequest, gstCfg);
  check("the void of the Main Course line lands", afterVoid !== null);
  check(
    "the charge survives voiding an unrelated line",
    afterVoid?.chargeAmount === 50 && afterVoid?.chargeLabel === "Rooftop charge",
  );
  check(
    "the total after voiding Main Course (300) is just Side Dish (80) plus the charge (50) = 130",
    afterVoid?.total === 130,
  );

  // Settle with chargeAmount: 0 — must UNSET both fields (never store 0/"") and
  // drop the total by exactly the waived charge.
  const beforeSettle = await Order.findById(order._id).lean<LeanOrder>();
  if (!beforeSettle) throw new Error("leg14: seed order missing before settle");
  const chargeBeforeSettle = beforeSettle.chargeAmount ?? 0;
  const settleWrite = buildSettleWrite(beforeSettle, { payment: "Cash", chargeAmount: 0 }, gstCfg);
  if (!settleWrite.ok) throw new Error("leg14: settle should resolve cleanly (no error path)");
  const settled = await Order.findOneAndUpdate(settleWrite.filter, settleWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("the chargeAmount:0 settle lands", settled !== null);
  check(
    "chargeAmount is ABSENT from the settled document ($unset), not stored as 0",
    !!settled && !("chargeAmount" in settled),
  );
  check(
    'chargeLabel is ABSENT from the settled document ($unset), not stored as ""',
    !!settled && !("chargeLabel" in settled),
  );
  check(
    `the total drops by exactly the waived charge (${beforeSettle.total} - ${chargeBeforeSettle} = ${beforeSettle.total - chargeBeforeSettle})`,
    settled?.total === beforeSettle.total - chargeBeforeSettle,
  );
  check("settling still freezes the tab to Completed", settled?.status === "Completed");
}

async function leg15(): Promise<void> {
  console.log(
    "\nLeg 15 — Defect 2: a chargeAmount:0 round-fire on a resumed tab UNSETS the charge end-to-end (not carried forward), and an omitted chargeAmount round-fire leaves it fully intact\n",
  );

  const gstCfg: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };

  // ── a) open a tab on a charged table — both fields stored ──────────────────
  await Table.create({
    tableNo: "T-CHARGE-WAIVE",
    capacity: 4,
    status: "Available",
    chargeAmount: 50,
    chargeLabel: "Rooftop charge",
  });
  const resolvedWaive = await resolveTableCharge("T-CHARGE-WAIVE");
  if ("error" in resolvedWaive) {
    throw new Error("leg15: resolveTableCharge failed against the seeded waive table");
  }

  const openingItems = [line("p-main", "Main Course", 300, 1, 1)];
  const openingTotals = computeOrderTotals({
    items: openingItems,
    discount: 0,
    charge: resolvedWaive.charge.amount,
    cfg: gstCfg,
  });
  const orderWaive = await Order.create({
    orderId: "ORD-LEG15-WAIVE-001",
    customerName: "Walk-in",
    items: openingItems,
    subtotal: openingTotals.subtotal,
    discount: openingTotals.discount,
    gstAmount: openingTotals.gstAmount,
    gstRate: 0,
    gstMode: "exclusive",
    chargeAmount: openingTotals.charge > 0 ? openingTotals.charge : undefined,
    chargeLabel: openingTotals.charge > 0 ? resolvedWaive.charge.label : undefined,
    total: openingTotals.total,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Verifier",
    tableNo: "T-CHARGE-WAIVE",
    kotRounds: 1,
  });
  check(
    "a) the tab opens on the charged table with BOTH chargeAmount and chargeLabel stored",
    orderWaive.chargeAmount === 50 && orderWaive.chargeLabel === "Rooftop charge",
  );

  // ── b) a KOT round is fired WITH chargeAmount: 0 (the waiver) ──────────────
  const beforeWaiveRound = await Order.findById(orderWaive._id).lean<LeanOrder>();
  if (!beforeWaiveRound) throw new Error("leg15: waive-scenario order missing before round-fire");
  const waiveNewItem = line("p-side", "Side Dish", 80, 1, 0); // kotRound stamped by buildItemsWrite
  // THE CONFIRMED BUG: before the fix, addItemsSchema had no field to carry a
  // waiver at all, so this round-fire could only ever carry old.chargeAmount
  // forward. buildItemsWrite's chargeOverride param mirrors the route's now-
  // accepted `parsed.data.chargeAmount` exactly.
  const waiveRoundWrite = buildItemsWrite(beforeWaiveRound, [waiveNewItem], undefined, gstCfg, 0);
  const afterWaiveRound = await Order.findOneAndUpdate(waiveRoundWrite.filter, waiveRoundWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("b) the chargeAmount:0 round-fire lands", afterWaiveRound !== null);

  // ── c) chargeAmount and chargeLabel are ABSENT afterward ($unset fired) ────
  check(
    "c) chargeAmount is ABSENT from the document after the waiver round-fire — not stored as 0",
    !!afterWaiveRound && !("chargeAmount" in afterWaiveRound),
  );
  check(
    'c) chargeLabel is ABSENT from the document after the waiver round-fire — not stored as ""',
    !!afterWaiveRound && !("chargeLabel" in afterWaiveRound),
  );

  // ── d) the new total is subtotal+gst of the FULL item set with NO charge ───
  const oracleWaive = computeOrderTotals({
    items: waiveRoundWrite.fullItems,
    discount: beforeWaiveRound.discount,
    charge: 0,
    cfg: gstCfg,
  });
  check(
    "d) oracle charge is 0 and the persisted total matches subtotal+gst of the full item set with no charge added (300 + 80 = 380)",
    oracleWaive.charge === 0 && afterWaiveRound?.total === oracleWaive.total && oracleWaive.total === 380,
  );

  // ── e) control: chargeAmount OMITTED leaves the original charge intact ─────
  await Table.create({
    tableNo: "T-CHARGE-KEEP",
    capacity: 4,
    status: "Available",
    chargeAmount: 50,
    chargeLabel: "Rooftop charge",
  });
  const resolvedKeep = await resolveTableCharge("T-CHARGE-KEEP");
  if ("error" in resolvedKeep) {
    throw new Error("leg15: resolveTableCharge failed against the seeded keep table");
  }
  const openingItemsKeep = [line("p-main2", "Main Course", 300, 1, 1)];
  const openingTotalsKeep = computeOrderTotals({
    items: openingItemsKeep,
    discount: 0,
    charge: resolvedKeep.charge.amount,
    cfg: gstCfg,
  });
  const orderKeep = await Order.create({
    orderId: "ORD-LEG15-KEEP-001",
    customerName: "Walk-in",
    items: openingItemsKeep,
    subtotal: openingTotalsKeep.subtotal,
    discount: openingTotalsKeep.discount,
    gstAmount: openingTotalsKeep.gstAmount,
    gstRate: 0,
    gstMode: "exclusive",
    chargeAmount: openingTotalsKeep.charge > 0 ? openingTotalsKeep.charge : undefined,
    chargeLabel: openingTotalsKeep.charge > 0 ? resolvedKeep.charge.label : undefined,
    total: openingTotalsKeep.total,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Verifier",
    tableNo: "T-CHARGE-KEEP",
    kotRounds: 1,
  });
  check(
    "e) the control tab opens on the charged table with the charge stored",
    orderKeep.chargeAmount === 50 && orderKeep.chargeLabel === "Rooftop charge",
  );

  const beforeKeepRound = await Order.findById(orderKeep._id).lean<LeanOrder>();
  if (!beforeKeepRound) throw new Error("leg15: control order missing before round-fire");
  const keepNewItem = line("p-side2", "Side Dish", 80, 1, 0);
  // No chargeOverride passed — omit-means-unchanged, the control for (b)-(d).
  const keepRoundWrite = buildItemsWrite(beforeKeepRound, [keepNewItem], undefined, gstCfg);
  const afterKeepRound = await Order.findOneAndUpdate(keepRoundWrite.filter, keepRoundWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("e) the omitted-chargeAmount round-fire lands", afterKeepRound !== null);
  check(
    "e) omitting chargeAmount on the round-fire leaves the original charge FULLY intact (still present, unchanged)",
    afterKeepRound?.chargeAmount === 50 && afterKeepRound?.chargeLabel === "Rooftop charge",
  );
  check(
    "e) the control's total includes items PLUS the untouched charge (300 + 80 + 50 = 430)",
    afterKeepRound?.total === 430,
  );
}

async function leg16(): Promise<void> {
  console.log(
    "\nLeg 16 — CR1.7 slip numbering end-to-end: no bill number on an open tab, kot series advances per round, settle assigns the day's bill number, kot/bill series are independent, and re-settling never renumbers\n",
  );

  // No Settings document exists for this leg — exactly the "cafe with a
  // pre-feature Settings document" case CR1.7 has to survive. printConfigOf's
  // own default resolution (documented defaults) is what the routes fall back
  // to via getSettings()'s .lean() read, so resolving against `undefined`
  // here is the faithful equivalent without needing a seeded Settings doc.
  const printCfg = printConfigOf(undefined);
  check(
    "sanity: the resolved defaults issue both kot and bill numbers, starting at 1",
    printCfg.kot.showNumber === true &&
      printCfg.bill.showNumber === true &&
      printCfg.kot.numberStart === 1 &&
      printCfg.bill.numberStart === 1,
  );

  // a) create an order as an OPEN TAB ("Pending") — mirrors POST /api/orders:
  // kotNumbers gets the round-1 ticket number; billNumber is never allocated
  // for a Pending create (issuesBill is false), so it must be genuinely ABSENT
  // from the stored document, not merely falsy.
  const kotNumber1 = printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart);
  const order = await Order.create({
    orderId: "ORD-LEG16-001",
    customerName: "Walk-in",
    items: [line("p-tea", "Tea", 100, 2, 1)],
    subtotal: 200,
    discount: 0,
    gstAmount: 0,
    gstRate: 0,
    gstMode: "exclusive",
    total: 200,
    kotNumbers: [kotNumber1],
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Verifier",
    kotRounds: 1,
  });

  const afterCreate = await Order.findById(order._id).lean();
  check(
    "a) the open tab stores kotNumbers: [N] for its opening round",
    JSON.stringify(afterCreate?.kotNumbers) === JSON.stringify([kotNumber1]),
  );
  check(
    "a) the open tab has NO billNumber at all (absent, not 0/undefined-as-a-value) — an unpaid tab must never burn a bill number",
    !!afterCreate && !("billNumber" in afterCreate),
  );

  // b) fire round 2 — a SECOND kot number, the next in the series, written
  // POSITIONALLY via buildKotNumbers (mirrors app/api/orders/[id]/items/
  // route.ts exactly — see that function's own comment for why this is NOT a
  // plain array append).
  const kotNumber2 = printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart);
  const afterRound2 = await Order.findOneAndUpdate(
    { _id: order._id, status: "Pending", payment: "Unpaid", kotRounds: 1 },
    { $set: { kotRounds: 2, kotNumbers: buildKotNumbers(afterCreate?.kotNumbers, 2, kotNumber2) } },
    { new: true },
  ).lean();
  check("b) the round-2 write matches and applies", afterRound2 !== null);
  check(
    "b) kotNumbers[1] is the NEXT number in the series (kotNumbers[0] + 1)",
    afterRound2?.kotNumbers?.[1] === (afterRound2?.kotNumbers?.[0] ?? -1) + 1,
  );
  check("b) kotNumbers.length is now 2 — one entry per fired round", afterRound2?.kotNumbers?.length === 2);

  // c) settle — assigns a billNumber, and it is the day's configured START:
  // this is the day's first bill, so no other order has consumed the bill
  // series before it (mirrors settle/route.ts's own condition:
  // printCfg.bill.showNumber && old.billNumber === undefined).
  const billNumber1 = printedSlipNumber(await nextSlipSequence("bill"), printCfg.bill.numberStart);
  check(
    "c) the day's FIRST bill gets exactly the configured start number",
    billNumber1 === printCfg.bill.numberStart,
  );
  const settled = await Order.findOneAndUpdate(
    { _id: order._id, status: "Pending" },
    { $set: { status: "Completed", payment: "Cash", paidAmount: 200, billNumber: billNumber1 } },
    { new: true },
  ).lean();
  check("c) settling assigns billNumber and completes the tab", settled?.billNumber === billNumber1 && settled?.status === "Completed");

  // d) the kot and bill series are INDEPENDENT — this tab issued TWO kitchen
  // tickets but exactly one bill; the bill number reflects only the bill
  // series's own count, unaffected by how many kot tickets were fired.
  check(
    "d) the bill number is unaffected by how many kitchen tickets this tab issued (2 kot tickets, still bill #1)",
    settled?.billNumber === printCfg.bill.numberStart && settled?.kotNumbers?.length === 2,
  );

  // e) re-settling (a second settle attempt) must NOT renumber an order that
  // already has a billNumber — mirrors settle/route.ts's exact guard
  // condition, computed against the ALREADY-SETTLED document.
  const reSettleBillNumber =
    printCfg.bill.showNumber && settled?.billNumber === undefined
      ? printedSlipNumber(await nextSlipSequence("bill"), printCfg.bill.numberStart)
      : undefined;
  check(
    "e) the re-settle guard computes NO new bill number for an order that already carries one",
    reSettleBillNumber === undefined,
  );
  const reSettled = await Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: {
        paidAmount: 200,
        ...(reSettleBillNumber !== undefined ? { billNumber: reSettleBillNumber } : {}),
      },
    },
    { new: true },
  ).lean();
  check(
    "e) the order's billNumber is byte-identical after the re-settle attempt — never renumbered",
    reSettled?.billNumber === billNumber1,
  );

  // Control: a SECOND order settled the same cafe-day gets the NEXT bill
  // number — proves (c)'s "day's first bill" claim is the series actually
  // advancing, not a coincidence of an empty scratch database.
  const billNumber2 = printedSlipNumber(await nextSlipSequence("bill"), printCfg.bill.numberStart);
  const order2 = await Order.create({
    orderId: "ORD-LEG16-002",
    customerName: "Walk-in",
    items: [line("p-coffee", "Coffee", 150, 1, 1)],
    subtotal: 150,
    discount: 0,
    gstAmount: 0,
    gstRate: 0,
    gstMode: "exclusive",
    total: 150,
    paidAmount: 150,
    payment: "Cash",
    status: "Completed",
    receiver: "Verifier",
    kotRounds: 1,
    billNumber: billNumber2,
  });
  check(
    "control: the same day's SECOND settled order gets the NEXT bill number, not a repeat of the first (series genuinely advances)",
    order2.billNumber === billNumber1 + 1,
  );
}

async function leg17(): Promise<void> {
  console.log(
    "\nLeg 17 — Defect 1 (THE confirmed bug): kotNumbers is built POSITIONALLY, not appended — a SHORT array (every tab already open when numbering shipped) must not misfile a round's ticket under an earlier round's index\n",
  );

  const gstCfg: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };
  const printCfg = printConfigOf(undefined);

  // a) SHIP-DAY SHAPE — a tab already open when numbering shipped: kotRounds:
  // 1, and NO kotNumbers array at all (never written, not even an empty one —
  // exactly what every tab open at ship time looks like).
  const shipDayOrder = await Order.create(
    buildOrder({
      orderId: "ORD-LEG17-SHIPDAY-001",
      items: [line("p-tea", "Tea", 100, 2, 1)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 1,
    }),
  );
  const beforeShipDay = await Order.findById(shipDayOrder._id).lean<LeanOrder>();
  check(
    "a) the ship-day tab genuinely has NO kotNumbers field at all (absent, not [])",
    !!beforeShipDay && !("kotNumbers" in beforeShipDay),
  );

  const shipDayTicket = printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart);
  const shipDayNewItem = line("p-toast", "Toast", 60, 1, 0); // kotRound stamped by buildItemsWrite
  const shipDayWrite = buildItemsWrite(
    beforeShipDay!,
    [shipDayNewItem],
    undefined,
    gstCfg,
    undefined,
    shipDayTicket,
  );
  const afterShipDay = await Order.findOneAndUpdate(shipDayWrite.filter, shipDayWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("a) the ship-day round-fire lands", afterShipDay !== null);
  check(
    "a) kotNumbers.length === kotRounds (2) — one entry per fired round, including the never-numbered round 1",
    afterShipDay?.kotNumbers?.length === afterShipDay?.kotRounds && afterShipDay?.kotRounds === 2,
  );
  check(
    "a) kotNumbers[kotRounds - 1] is the ticket just issued for THIS round",
    afterShipDay?.kotNumbers?.[(afterShipDay?.kotRounds ?? 0) - 1] === shipDayTicket,
  );
  check(
    "a) kotNumbers[0] is 0 — round 1 fired before numbering existed, correctly recorded as never numbered (an append would instead have filed shipDayTicket at index 0, the confirmed bug)",
    afterShipDay?.kotNumbers?.[0] === 0,
  );

  // b) ALIGNED case — a tab whose kotNumbers array already matches kotRounds
  // (the ordinary, already-numbered case) must keep working exactly as before.
  const alignedTicket1 = printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart);
  const alignedOrder = await Order.create({
    ...buildOrder({
      orderId: "ORD-LEG17-ALIGNED-001",
      items: [line("p-tea", "Tea", 100, 2, 1)],
      payment: "Unpaid",
      status: "Pending",
      kotRounds: 1,
    }),
    kotNumbers: [alignedTicket1],
  });
  const beforeAligned = await Order.findById(alignedOrder._id).lean<LeanOrder>();
  const alignedTicket2 = printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart);
  const alignedNewItem = line("p-water", "Water", 20, 1, 0);
  const alignedWrite = buildItemsWrite(
    beforeAligned!,
    [alignedNewItem],
    undefined,
    gstCfg,
    undefined,
    alignedTicket2,
  );
  const afterAligned = await Order.findOneAndUpdate(alignedWrite.filter, alignedWrite.update, {
    new: true,
    runValidators: true,
  }).lean();
  check("b) the aligned-tab round-fire lands", afterAligned !== null);
  check(
    "b) kotNumbers.length === kotRounds (2)",
    afterAligned?.kotNumbers?.length === afterAligned?.kotRounds && afterAligned?.kotRounds === 2,
  );
  check(
    "b) the last entry is the freshly issued ticket, and round 1's original ticket is preserved untouched",
    afterAligned?.kotNumbers?.[1] === alignedTicket2 && afterAligned?.kotNumbers?.[0] === alignedTicket1,
  );

  // c) INVARIANT — every numbered tab this leg touched carries EXACTLY one
  // kotNumbers entry per fired round, no more, no fewer.
  const numberedTabs = await Order.find({
    orderId: { $in: ["ORD-LEG17-SHIPDAY-001", "ORD-LEG17-ALIGNED-001"] },
    kotNumbers: { $exists: true },
  }).lean();
  check(
    "c) invariant: kotNumbers.length === kotRounds on every numbered tab in this leg",
    numberedTabs.length === 2 && numberedTabs.every((o) => (o.kotNumbers?.length ?? -1) === o.kotRounds),
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
    await leg14();
    await leg15();
    await leg16();
    await leg17();
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
