// Why a new file: the rule for WHEN a printed slip number is taken used to be
// restated inline in the settle and create routes, and both took the bill
// number BEFORE their write had won — a settle that then lost its CAS, or a
// Pay Now twin that lost its insert, burned a number and left a gap in the
// day's bill series. This is now the one place that decides it.
//
// The rule: the BILL number is taken only by the request whose write already
// landed (the settle CAS hit, the Pay Now insert won), in a second guarded
// update that sets it only if the bill has none. The opening KOT number is
// still taken just before the insert — losing one there to a refused insert is
// an accepted burn (kitchen tickets, like the add-round's pre-CAS ticket).
import type { Types } from "mongoose";
import { Order } from "@/models/Order";
import { nextSlipSequence, type SlipSeries } from "@/models/Counter";
import { printedSlipNumber, type PrintConfig } from "@/lib/print";

/**
 * Tries of the guarded set, all with the SAME number. The `$or` arm lets a
 * retry after a set that committed and then threw adopt its own number instead
 * of drawing a second one.
 */
export const BILL_NUMBER_SET_ATTEMPTS = 2;

/** Neutral copy for a landed write whose bill number could not be confirmed. */
export const BILL_NUMBER_UNCONFIRMED = "Saved, but the bill number could not be confirmed.";

type OrderRef = string | Types.ObjectId;

/** Sets `billNumber` on an order that holds none (or already holds this one). */
function setBillNumberIfAbsent(id: OrderRef, billNumber: number) {
  return Order.findOneAndUpdate(
    { _id: id, $or: [{ billNumber: { $exists: false } }, { billNumber }] },
    { $set: { billNumber } },
    { new: true, runValidators: true },
  ).lean();
}

/** The lean order doc the numbering returns (what the bill prints from). */
export type NumberedOrder = Awaited<ReturnType<typeof setBillNumberIfAbsent>>;

export interface SlipNumberDeps<T> {
  nextSequence(series: SlipSeries): Promise<number>;
  setIfAbsent(id: OrderRef, billNumber: number): Promise<T | null>;
  readOrder(id: OrderRef): Promise<T | null>;
}

export const SLIP_NUMBER_DEPS: SlipNumberDeps<NonNullable<NumberedOrder>> = {
  nextSequence: (series) => nextSlipSequence(series),
  setIfAbsent: setBillNumberIfAbsent,
  readOrder: (id) => Order.findById(id).lean(),
};

/**
 * Number the bill of an order whose write has ALREADY landed: one bill
 * sequence, then the guarded set (retried with the same number). A guard miss
 * means the bill already holds another number — the stored doc is returned, so
 * the paper matches what the customer holds. Rejects when the sequence throws
 * or every set attempt throws; the caller answers BILL_NUMBER_UNCONFIRMED.
 */
export function issueBillNumber(id: OrderRef, start: number): Promise<NumberedOrder>;
export function issueBillNumber<T>(id: OrderRef, start: number, deps: SlipNumberDeps<T>): Promise<T | null>;
export async function issueBillNumber(
  id: OrderRef,
  start: number,
  deps: SlipNumberDeps<unknown> = SLIP_NUMBER_DEPS,
): Promise<unknown> {
  const billNumber = printedSlipNumber(await deps.nextSequence("bill"), start);
  let lastError: unknown;
  for (let attempt = 0; attempt < BILL_NUMBER_SET_ATTEMPTS; attempt += 1) {
    try {
      return (await deps.setIfAbsent(id, billNumber)) ?? (await deps.readOrder(id));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * The opening round's KOT number for a new order, omit-empty: `{}` when the
 * cafe does not number its tickets. Never a bill number — that is the insert
 * winner's job (issueBillNumber), so a refused twin cannot burn one.
 */
export async function allocateOpeningKot<T>(
  cfg: PrintConfig,
  deps: Pick<SlipNumberDeps<T>, "nextSequence"> = SLIP_NUMBER_DEPS,
): Promise<{ kotNumbers?: number[] }> {
  if (!cfg.kot.showNumber) return {};
  return { kotNumbers: [printedSlipNumber(await deps.nextSequence("kot"), cfg.kot.numberStart)] };
}
