// Server-only. The moment a bill FIRST prints is stored on the order
// (`billFirstPrintedAt`) so the UPI pay QR's "Valid till <time>" is the same on
// every reprint of that bill (counted from its first print, not each reprint).
// Owner rule (01-PLAN A5): a bill whose TOTAL changed after that print (a round
// added, a void, a discount) is a new bill, so its next print starts a new
// window — hence the stamp also records the total it was made for
// (`billFirstPrintedTotal`). Why a new file: nothing else owns this stamp; the
// three writers (create, settle, the print-jobs enqueue) share THIS freshness
// rule, THIS CAS filter and THIS convergence rule (reciprocal CAS, cafe.md).
//
// The stamp must NEVER block, delay into failure, or error a print: every
// function here swallows its own failure and falls back to "no stamp" (the
// renderer then counts the window from its own print time, payQrPlan in
// @pos/shared/print-qr, rather than losing the bill).
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";

/** The slice of an order doc these reads/writes touch (a lean Order satisfies it). */
export interface StampedOrder {
  total: number;
  billFirstPrintedAt?: Date;
  billFirstPrintedTotal?: number;
}

export interface BillFirstPrintDeps {
  /** The order's total and stamp, or null when it is cancelled or missing. */
  readBill(id: string): Promise<StampedOrder | null>;
  /** CAS on the exact state `seen` read: stamps `at` + seen.total; the stamped doc on a hit, null on a miss. */
  casStamp(id: string, seen: StampedOrder, at: Date): Promise<StampedOrder | null>;
}

const STAMP_PROJECTION = { total: 1, billFirstPrintedAt: 1, billFirstPrintedTotal: 1 } as const;

/** The stored stamp when it was made for a bill of `total`; null when there is none or it was made for another. */
function stampMadeFor(order: StampedOrder, total: number): Date | null {
  return order.billFirstPrintedAt instanceof Date && order.billFirstPrintedTotal === total ? order.billFirstPrintedAt : null;
}

/** True when the stored stamp belongs to the bill as it is now: stamped, and for this same total. */
export function billFirstPrintFresh(order: StampedOrder): boolean {
  return stampMadeFor(order, order.total) !== null;
}

/**
 * The ONE CAS filter: not cancelled, the total still the one read, and the stamp
 * still the one read (absent on a first print; the stale one on a changed total).
 * A miss therefore means another writer stamped, the total moved, or a cancel landed.
 */
export function firstBillPrintFilter(id: string, seen: StampedOrder) {
  return {
    _id: id,
    status: { $ne: "Cancelled" },
    total: seen.total,
    billFirstPrintedAt: seen.billFirstPrintedAt ?? { $exists: false },
  };
}

export const BILL_FIRST_PRINT_DEPS: BillFirstPrintDeps = {
  readBill: (id) =>
    Order.findOne({ _id: id, status: { $ne: "Cancelled" } }, STAMP_PROJECTION).lean<StampedOrder | null>(),
  // No upsert: a stamp never creates a document. `new: true` returns the value
  // THIS write stored, so the caller prints exactly what was persisted.
  casStamp: (id, seen, at) =>
    Order.findOneAndUpdate(
      firstBillPrintFilter(id, seen),
      { $set: { billFirstPrintedAt: at, billFirstPrintedTotal: seen.total } },
      { new: true, projection: STAMP_PROJECTION },
    ).lean<StampedOrder | null>(),
};

/**
 * The moment every print of this bill must count its pay QR window from.
 * `printedTotal` is the total on the slip being printed (a client-built slip may
 * show a view older than the order now); absent = the order's own total.
 * - A stamp made for that total is returned as is (a reprint: one read, no write).
 * - A slip whose total is not the order's total now (another device changed it)
 *   neither starts nor moves a window: no stamp of its own total → null.
 * - A first print, or a print after the total changed, stamps `nowMs`.
 * On a CAS miss the convergence rule is: adopt the stored stamp only if it was
 * made for this slip's total (another writer stamped this same bill first);
 * anything else (the total moved again, a cancel, a missing order) is null,
 * i.e. no stamp. Never throws.
 */
export async function stampFirstBillPrint(
  id: string,
  nowMs: number,
  deps: BillFirstPrintDeps = BILL_FIRST_PRINT_DEPS,
  printedTotal?: number,
): Promise<Date | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  try {
    const seen = await deps.readBill(id);
    if (seen === null) return null;
    const total = printedTotal ?? seen.total;
    const kept = stampMadeFor(seen, total);
    if (kept !== null) return kept;
    if (total !== seen.total) return null;
    const hit = await deps.casStamp(id, seen, new Date(nowMs));
    const won = hit !== null ? stampMadeFor(hit, total) : null;
    if (won !== null) return won;
    const again = await deps.readBill(id);
    return again !== null ? stampMadeFor(again, total) : null;
  } catch {
    return null;
  }
}

/** Insert-time stamp for the create route: the bill Pay Now prints is stamped in the insert itself (no extra write). */
export function firstBillPrintInsertFields(
  printsBill: boolean,
  nowMs: number,
  total: number,
): { billFirstPrintedAt?: Date; billFirstPrintedTotal?: number } {
  return printsBill ? { billFirstPrintedAt: new Date(nowMs), billFirstPrintedTotal: total } : {};
}

/**
 * `order` carrying the stamp this print must show. For a caller that tried to
 * stamp: null means "no stamp", so a STALE stored stamp (made for another total)
 * is dropped too — the slip then counts from its own print time instead of
 * leaving the QR off for a window that belonged to another bill.
 */
export function withFirstBillPrint<T extends { billFirstPrintedAt?: Date }>(order: T, at: Date | null): T {
  if (at) return { ...order, billFirstPrintedAt: at };
  if (order.billFirstPrintedAt === undefined) return order;
  const copy = { ...order };
  delete copy.billFirstPrintedAt;
  return copy;
}

/**
 * The payload a bill job is STORED with. Only the "bill" kind renders the bill
 * (OrderReceipt); every other kind (KOT-family, EOD) is returned unchanged. The
 * server is the only source of the stamp, so a client-sent value is ALWAYS
 * dropped (a tab could otherwise print a QR that never expires), then replaced
 * by the stored one when the order has it. Never mutates the input; never throws.
 */
export async function billPayloadWithFirstPrint(
  payload: PrintJobPayload,
  nowMs: number,
  deps: BillFirstPrintDeps = BILL_FIRST_PRINT_DEPS,
): Promise<PrintJobPayload> {
  if (payload.kind !== "bill") return payload;
  const snapshot = { ...payload.snapshot };
  delete snapshot.billFirstPrintedAt;
  // The slip's own total: a print from a stale view must not start or move the order's window.
  const stamp = await stampFirstBillPrint(snapshot._id, nowMs, deps, snapshot.total);
  if (stamp !== null) snapshot.billFirstPrintedAt = stamp.toISOString();
  return { ...payload, snapshot };
}
