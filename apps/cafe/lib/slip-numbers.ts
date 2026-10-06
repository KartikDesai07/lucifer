// Why a new file: the rule for WHEN a printed slip number is taken used to be
// restated inline in the settle and create routes, and both took the bill
// number BEFORE their write had won — a settle that then lost its CAS, or a
// Pay Now twin that lost its insert, burned a number and left a gap in the
// day's bill series. This is now the one place that decides it.
//
// The rule: the BILL number is taken only by the request whose write already
// landed (the settle CAS hit, the Pay Now insert won), in a second guarded
// update that sets it only if the bill has none. The opening KOT number and the
// order's TOKEN are still taken just before the insert — losing one there to a
// refused insert is an accepted burn (kitchen tickets, like the add-round's
// pre-CAS ticket). The duplicate-key retry reuses the same `doc`, so it reuses
// the token too; an add-round never takes one (a token belongs to the order).
//
// Every series restarts at the cafe's restart time, so each draw carries the
// series' { numberStart, resetMinutes } (PrintConfig.bill / .kot / .token).
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

/** What one series needs to number a slip: its start number and the daily restart time. */
export type SeriesNumbering = { numberStart: number; resetMinutes: number };

/** The lean order doc the numbering returns (what the bill prints from). */
export type NumberedOrder = Awaited<ReturnType<typeof setBillNumberIfAbsent>>;

export interface SlipNumberDeps<T> {
  nextSequence(series: SlipSeries, resetMinutes: number): Promise<number>;
  setIfAbsent(id: OrderRef, billNumber: number): Promise<T | null>;
  readOrder(id: OrderRef): Promise<T | null>;
}

export const SLIP_NUMBER_DEPS: SlipNumberDeps<NonNullable<NumberedOrder>> = {
  nextSequence: (series, resetMinutes) => nextSlipSequence(series, undefined, undefined, resetMinutes),
  setIfAbsent: setBillNumberIfAbsent,
  readOrder: (id) => Order.findById(id).lean(),
};

/** The next printed number of a series: one atomic draw, the start number applied once. */
export async function nextPrintedNumber(
  series: SlipSeries,
  numbering: SeriesNumbering,
  deps: Pick<SlipNumberDeps<unknown>, "nextSequence"> = SLIP_NUMBER_DEPS,
): Promise<number> {
  return printedSlipNumber(await deps.nextSequence(series, numbering.resetMinutes), numbering.numberStart);
}

/**
 * Number the bill of an order whose write has ALREADY landed: one bill
 * sequence, then the guarded set (retried with the same number). A guard miss
 * means the bill already holds another number — the stored doc is returned, so
 * the paper matches what the customer holds. Rejects when the sequence throws
 * or every set attempt throws; the caller answers BILL_NUMBER_UNCONFIRMED.
 */
export function issueBillNumber(id: OrderRef, bill: SeriesNumbering): Promise<NumberedOrder>;
export function issueBillNumber<T>(id: OrderRef, bill: SeriesNumbering, deps: SlipNumberDeps<T>): Promise<T | null>;
export async function issueBillNumber(
  id: OrderRef,
  bill: SeriesNumbering,
  deps: SlipNumberDeps<unknown> = SLIP_NUMBER_DEPS,
): Promise<unknown> {
  const billNumber = await nextPrintedNumber("bill", bill, deps);
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
 * The numbers a NEW order takes before its insert, omit-empty: the opening
 * round's KOT number when the cafe numbers its tickets, and the order's token
 * when tokens are on. `{}` (and no draw at all) when both are off. Never a bill
 * number — that is the insert winner's job (issueBillNumber), so a refused twin
 * cannot burn one. Both draws are independent counters, so they run together.
 */
export async function allocateOpeningSlips<T>(
  cfg: PrintConfig,
  deps: Pick<SlipNumberDeps<T>, "nextSequence"> = SLIP_NUMBER_DEPS,
): Promise<{ kotNumbers?: number[]; tokenNumber?: number }> {
  const [kotNumber, tokenNumber] = await Promise.all([
    cfg.kot.showNumber ? nextPrintedNumber("kot", cfg.kot, deps) : undefined,
    cfg.token.enabled ? nextPrintedNumber("token", cfg.token, deps) : undefined,
  ]);
  return {
    ...(kotNumber !== undefined ? { kotNumbers: [kotNumber] } : {}),
    ...(tokenNumber !== undefined ? { tokenNumber } : {}),
  };
}
