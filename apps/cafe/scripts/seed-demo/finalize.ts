/**
 * Post-write finalization: fold the reconcile route's rollup formula over the
 * planned orders/dues to set Customer visit/spend/due totals, then read
 * everything back from the DB and assert the invariants a real cafe's data
 * would satisfy. (console output is intentional — ops CLI script, not app code.)
 */
import { Types } from "mongoose";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import { Table } from "@/models/Table";
import { Counter } from "@/models/Counter";
import { Settings } from "@/models/Settings";
import { Staff } from "@/models/Staff";
import { OrderRequest } from "@/models/OrderRequest";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import { cafeDateString, dayRange, cafeHourOf } from "@/lib/utils";
import type { CustomerRollup, ExtrasPlan, OrdersPlan, PlannedDuePayment, PlannedOrder } from "./types";
import { objectIdCensus } from "./finalize-census";

// Mirrors orders-plan-draft.ts's HOUR_WEIGHTS (cafe hours 11:00-22:59 IST) —
// the earliest hour the planner ever drafts an order into.
const CAFE_OPEN_HOUR = 11;

// ── rollupsOf — the reconcile route's formula (app/api/customers/[id]/reconcile),
// applied in memory over the planned orders instead of an aggregate pipeline,
// so the CLI can verify write-time totals BEFORE the first DB read. ─────────
export function rollupsOf(
  orders: readonly PlannedOrder[],
  duePayments: readonly PlannedDuePayment[],
): Map<string, CustomerRollup> {
  const rollups = new Map<string, CustomerRollup>();
  const get = (id: string): CustomerRollup => {
    const existing = rollups.get(id);
    if (existing) return existing;
    const created: CustomerRollup = { visits: 0, totalSpend: 0, totalDue: 0 };
    rollups.set(id, created);
    return created;
  };

  for (const order of orders) {
    if (!order.customerId) continue;
    // Mirrors the reconcile route's unlessZeroRated: a Cancelled order or an
    // Unpaid held tab contributes nothing to visits/spend/due.
    if (order.status === "Cancelled" || order.payment === "Unpaid") continue;
    const id = order.customerId.toString();
    const row = get(id);
    row.visits += 1;
    row.totalSpend += order.total;
    row.totalDue += Math.max(0, order.total - order.paidAmount);
  }

  const paidByCustomer = new Map<string, number>();
  for (const payment of duePayments) {
    const id = payment.customerId.toString();
    paidByCustomer.set(id, (paidByCustomer.get(id) ?? 0) + payment.amount);
  }

  for (const [id, row] of rollups) {
    const paid = paidByCustomer.get(id) ?? 0;
    row.totalDue = Math.max(0, row.totalDue - paid);
  }

  return rollups;
}

/** $set every customer's visits/totalSpend/totalDue from the plan. Customers
 *  with no rollup entry (no non-zero-rated orders) are left at their seeded
 *  zero defaults — nothing to $set. */
export async function applyCustomerRollups(
  orders: readonly PlannedOrder[],
  duePayments: readonly PlannedDuePayment[],
): Promise<void> {
  const rollups = rollupsOf(orders, duePayments);
  if (rollups.size === 0) return;
  await Customer.bulkWrite(
    Array.from(rollups.entries()).map(([id, rollup]) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id) },
        update: { $set: { visits: rollup.visits, totalSpend: rollup.totalSpend, totalDue: rollup.totalDue } },
      },
    })),
  );
}

// ── verifySeed — reads BACK from the DB and checks the invariants ──────────
interface VerifyLine {
  pass: boolean;
  message: string;
}

function check(pass: boolean, message: string, out: VerifyLine[]): void {
  out.push({ pass, message });
}

export async function verifySeed(
  plan: OrdersPlan,
  extras: ExtrasPlan,
  gst: GstConfig,
  log: (line: string) => void,
): Promise<{ passed: number; failed: number }> {
  const lines: VerifyLine[] = [];

  const dbOrders = await Order.find().sort({ createdAt: 1 }).lean();
  check(dbOrders.length === plan.orders.length, `order count = plan (${dbOrders.length} === ${plan.orders.length})`, lines);

  const orderIds = new Set<string>();
  let duplicateOrderId = false;
  const perDaySeq = new Map<string, number[]>();
  const perDayKot = new Map<string, number[]>();
  const perDayBill = new Map<string, number[]>();

  for (const order of dbOrders) {
    if (orderIds.has(order.orderId)) duplicateOrderId = true;
    orderIds.add(order.orderId);

    const recomputed = computeOrderTotals({
      items: order.items,
      discount: order.discount,
      discountKind: order.discountKind,
      charge: order.chargeAmount ?? 0,
      cfg: { gstEnabled: (order.gstRate ?? 0) > 0, gstRate: order.gstRate ?? 0, gstMode: order.gstMode ?? gst.gstMode },
    });
    if (recomputed.total !== order.total) {
      check(false, `order ${order.orderId}: stored total ${order.total} !== recomputed ${recomputed.total}`, lines);
    }

    const dayKey = cafeDateString(order.createdAt);
    const orderIdDay = order.orderId.slice(4, 12);
    if (orderIdDay !== dayKey.replace(/-/g, "")) {
      check(false, `order ${order.orderId}: orderId day ${orderIdDay} !== cafeDateString ${dayKey}`, lines);
    }
    const seqMatch = /-(\d{3})$/.exec(order.orderId);
    if (seqMatch) {
      const arr = perDaySeq.get(dayKey) ?? [];
      arr.push(Number(seqMatch[1]));
      perDaySeq.set(dayKey, arr);
    }
    if (order.kotNumbers) {
      const arr = perDayKot.get(dayKey) ?? [];
      arr.push(...order.kotNumbers);
      perDayKot.set(dayKey, arr);
    }
    if (order.billNumber !== undefined && order.billNumber !== null) {
      const arr = perDayBill.get(dayKey) ?? [];
      arr.push(order.billNumber);
      perDayBill.set(dayKey, arr);
    }

    if (order.sourceRequestIds && order.sourceRequestIds.length === 0) {
      check(false, `order ${order.orderId}: sourceRequestIds is [] (must be absent, not empty)`, lines);
    }
  }
  check(!duplicateOrderId, "orderIds are unique", lines);

  for (const [dayKey, seqs] of perDaySeq) {
    const sorted = [...seqs].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => n === i + 1);
    check(contiguous, `day ${dayKey}: NNN sequence contiguous (${sorted.length} orders)`, lines);
  }
  for (const [dayKey, kots] of perDayKot) {
    const sorted = [...kots].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => n === i + 1);
    check(contiguous, `day ${dayKey}: kot numbers contiguous (${sorted.length})`, lines);
  }
  for (const [dayKey, bills] of perDayBill) {
    const sorted = [...bills].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => n === i + 1);
    check(contiguous, `day ${dayKey}: bill numbers contiguous (${sorted.length})`, lines);
  }

  const counters = await Counter.find().lean();
  const counterByKey = new Map(counters.map((c) => [c._id, c.seq]));
  for (const [dayKey, seqs] of perDaySeq) {
    const key = `order-${dayKey.replace(/-/g, "")}`;
    const maxIssued = Math.max(...seqs);
    const stored = counterByKey.get(key) ?? 0;
    check(stored >= maxIssued, `counter ${key} (${stored}) >= max issued (${maxIssued})`, lines);
  }

  const productIds = new Set((await Product.find().select("_id").lean()).map((p) => p._id.toString()));
  const customerIds = new Set((await Customer.find().select("_id").lean()).map((c) => c._id.toString()));
  let badProductRef = false;
  let badCustomerRef = false;
  for (const order of dbOrders) {
    for (const item of order.items) {
      if (!productIds.has(item.productId.toString())) badProductRef = true;
    }
    if (order.customerId && !customerIds.has(order.customerId.toString())) badCustomerRef = true;
  }
  check(!badProductRef, "every items[].productId exists in Product", lines);
  check(!badCustomerRef, "every customerId exists in Customer", lines);

  const occupiedTables = await Table.find({ status: "Occupied" }).lean();
  const pendingOrders = dbOrders.filter((o) => o.status === "Pending");
  const occupiedTableNos = new Set(occupiedTables.map((t) => t.tableNo));
  const pendingTableNos = new Set(pendingOrders.map((o) => o.tableNo).filter((t): t is string => !!t));
  check(
    occupiedTableNos.size === pendingTableNos.size && [...occupiedTableNos].every((t) => pendingTableNos.has(t)),
    `Occupied tables (${occupiedTableNos.size}) === Pending orders' tables (${pendingTableNos.size})`,
    lines,
  );

  if (extras.reservedTable) {
    const reserved = await Table.findOne({ tableNo: extras.reservedTable.tableNo }).lean();
    check(!!reserved && reserved.status === "Reserved" && !reserved.currentOrderId, "Reserved table has no currentOrderId", lines);
  }

  const dbCustomers = await Customer.find().lean();
  const expectedRollups = rollupsOf(plan.orders, extras.duePayments);
  let rollupMismatch = false;
  for (const customer of dbCustomers) {
    const expected = expectedRollups.get(customer._id.toString()) ?? { visits: 0, totalSpend: 0, totalDue: 0 };
    if (
      customer.visits !== expected.visits ||
      customer.totalSpend !== expected.totalSpend ||
      customer.totalDue !== expected.totalDue
    ) {
      rollupMismatch = true;
    }
  }
  check(!rollupMismatch, "every Customer's stored rollup === the reconcile aggregate", lines);

  let dueExceedsBalance = false;
  const runningDue = new Map<string, number>();
  const sortedOrders = [...plan.orders].filter((o) => o.customerId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sortedDues = [...extras.duePayments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const events: { at: Date; customerId: string; delta: number }[] = [];
  for (const order of sortedOrders) {
    if (order.status === "Cancelled" || order.payment === "Unpaid") continue;
    events.push({ at: order.createdAt, customerId: order.customerId!.toString(), delta: Math.max(0, order.total - order.paidAmount) });
  }
  for (const due of sortedDues) {
    events.push({ at: due.createdAt, customerId: due.customerId.toString(), delta: -due.amount });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const event of events) {
    const before = runningDue.get(event.customerId) ?? 0;
    const after = before + event.delta;
    if (event.delta < 0 && after < 0) dueExceedsBalance = true;
    runningDue.set(event.customerId, Math.max(0, after));
  }
  check(!dueExceedsBalance, "no DuePayment exceeds its customer's cumulative due at its instant", lines);

  const dbRequests = await OrderRequest.find().lean();
  const acceptedRequestIds = new Set(dbRequests.filter((r) => r.status === "accepted").map((r) => r._id.toString()));
  const referencedIds = new Set<string>();
  for (const order of dbOrders) {
    for (const id of order.sourceRequestIds ?? []) referencedIds.add(id.toString());
  }
  const acceptedMatch = [...acceptedRequestIds].every((id) => referencedIds.has(id));
  check(acceptedMatch, "every accepted request's id appears in some order's sourceRequestIds", lines);

  const distinctDays = new Set(dbOrders.map((o) => cafeDateString(o.createdAt))).size;
  check(distinctDays >= 28, `distinct IST days with orders >= 28 (${distinctDays})`, lines);

  const now = new Date();
  const todayRange = dayRange(now);
  const todaysOrders = dbOrders.filter((o) => o.createdAt >= todayRange.start && o.createdAt <= todayRange.end);
  const todaysCompleted = todaysOrders.filter((o) => o.status === "Completed");
  // The planner never drafts a today-order whose instant is after ctx.now
  // (orders-plan-draft.ts), and cafe hours start at 11:00 IST — running the
  // seed before then legitimately produces zero Completed orders today (only
  // the 3 forced-Pending tabs, which are not clock-gated). Only a run AT OR
  // AFTER cafe opening is held to the >= 1 invariant.
  if (cafeHourOf(now) >= CAFE_OPEN_HOUR) {
    check(todaysCompleted.length >= 1, `today's Completed count >= 1 (${todaysCompleted.length})`, lines);
  } else {
    log(`SKIP: today's Completed count check — cafe opens at ${CAFE_OPEN_HOUR}:00 IST, it is earlier now`);
  }
  const summaryQuery = await Order.find({ createdAt: { $gte: todayRange.start, $lte: todayRange.end } }).lean();
  check(summaryQuery.length === todaysOrders.length, "summary-route dayRange query returns today's orders", lines);

  const settings = await Settings.findOne().lean();
  check(!!settings, "Settings singleton exists", lines);

  const admin = await Staff.findOne({ role: "admin" }).lean();
  const staffCount = await Staff.countDocuments({ role: "staff" });
  check(!!admin, "admin account exists", lines);
  check(staffCount === 3, `3 staff accounts (found ${staffCount})`, lines);

  const productCount = await Product.countDocuments();
  check(productCount > 0, `product count > 0 (${productCount})`, lines);

  for (const census of await objectIdCensus()) check(census.pass, census.message, lines);

  for (const line of lines) {
    log(`${line.pass ? "PASS" : "FAIL"}: ${line.message}`);
  }
  const failed = lines.filter((l) => !l.pass).length;
  return { passed: lines.length - failed, failed };
}
