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
// The GST invoice serial (S10) is the exception: one series per financial
// year, drawn on the same terms as the bill number (after the win, guarded).
import mongoose, { type Types } from "mongoose";
import { Order } from "@/models/Order";
import { nextInvoiceSequence, nextSlipSequence, type SlipSeries } from "@/models/Counter";
import { printedSlipNumber, type PrintConfig } from "@/lib/print";
import type { BillNumberingPlan } from "@/lib/gst-invoice";
import { invoiceFyOf } from "@pos/shared/invoice-number";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";

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
 * `round.kitchen` is false when every line of the opening round skips the
 * kitchen (skip-KOT): no ticket is printed, so neither a KOT number NOR a
 * token is taken ({} and zero draws) — a drinks-only order has no token.
 */
export async function allocateOpeningSlips<T>(
  cfg: PrintConfig,
  round: { kitchen: boolean },
  deps: Pick<SlipNumberDeps<T>, "nextSequence"> = SLIP_NUMBER_DEPS,
): Promise<{ kotNumbers?: number[]; tokenNumber?: number }> {
  if (!round.kitchen) return {};
  const [kotNumber, tokenNumber] = await Promise.all([
    cfg.kot.showNumber ? nextPrintedNumber("kot", cfg.kot, deps) : undefined,
    cfg.token.enabled ? nextPrintedNumber("token", cfg.token, deps) : undefined,
  ]);
  return {
    ...(kotNumber !== undefined ? { kotNumbers: [kotNumber] } : {}),
    ...(tokenNumber !== undefined ? { tokenNumber } : {}),
  };
}

// ── GST invoice serial (print customization S10) ─────────────────────────────

/** Sets the invoice serial on an order that holds none (or already holds this one). */
function setInvoiceIfAbsent(id: OrderRef, invoiceFy: number, invoiceNumber: number) {
  return Order.findOneAndUpdate(
    { _id: id, $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber, invoiceFy }] },
    { $set: { invoiceNumber, invoiceFy } },
    { new: true, runValidators: true },
  ).lean();
}

export interface InvoiceNumberDeps<T> {
  nextInvoice(fy: number): Promise<number>;
  setInvoiceIfAbsent(id: OrderRef, fy: number, invoiceNumber: number): Promise<T | null>;
  readOrder(id: OrderRef): Promise<T | null>;
}

export const BILL_NUMBERS_DEPS: SlipNumberDeps<NonNullable<NumberedOrder>> & InvoiceNumberDeps<NonNullable<NumberedOrder>> = {
  ...SLIP_NUMBER_DEPS,
  nextInvoice: nextInvoiceSequence,
  setInvoiceIfAbsent,
};

/**
 * The invoice serial of a paid GST bill, in the financial year of `at`: one
 * draw, then the guarded set retried with the SAME number; a guard miss returns
 * the stored doc (the bill already holds its serial). Rejects like issueBillNumber.
 */
export async function issueInvoiceNumber<T>(id: OrderRef, at: Date, deps: InvoiceNumberDeps<T>): Promise<T | null> {
  const fy = invoiceFyOf(at);
  const invoiceNumber = await deps.nextInvoice(fy);
  let lastError: unknown;
  for (let attempt = 0; attempt < BILL_NUMBER_SET_ATTEMPTS; attempt += 1) {
    try {
      return (await deps.setInvoiceIfAbsent(id, fy, invoiceNumber)) ?? (await deps.readOrder(id));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Every number a landed bill still needs (lib/gst-invoice billNumberingPlan):
 * the invoice serial first, then the daily bill number, one after the other so
 * the doc returned carries both. Each is tried even when the other failed (a
 * number drawn is never left unset for a sibling's sake); any failure rejects,
 * and the caller answers BILL_NUMBER_UNCONFIRMED exactly as before.
 */
export function issueBillNumbers(id: OrderRef, plan: BillNumberingPlan): Promise<NumberedOrder>;
export function issueBillNumbers<T>(
  id: OrderRef,
  plan: BillNumberingPlan,
  deps: SlipNumberDeps<T> & InvoiceNumberDeps<T>,
): Promise<T | null>;
export async function issueBillNumbers(
  id: OrderRef,
  plan: BillNumberingPlan,
  deps: SlipNumberDeps<unknown> & InvoiceNumberDeps<unknown> = BILL_NUMBERS_DEPS,
): Promise<unknown> {
  let doc: unknown = null;
  let failure: { error: unknown } | null = null;
  if (plan.invoiceAt !== undefined) {
    try {
      doc = await issueInvoiceNumber(id, plan.invoiceAt, deps);
    } catch (error) {
      failure = { error };
    }
  }
  if (plan.bill !== undefined) {
    try {
      doc = await issueBillNumber(id, plan.bill, deps);
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure !== null) throw failure.error;
  return doc;
}

/** The stored invoice serial of an order (null: missing order or a failed read is handled by the caller). */
export interface InvoiceReadDeps {
  readInvoice(id: string): Promise<{ invoiceNumber?: number; invoiceFy?: number } | null>;
}

const INVOICE_READ_DEPS: InvoiceReadDeps = {
  readInvoice: (id) =>
    Order.findById(id, { invoiceNumber: 1, invoiceFy: 1 }).lean<{ invoiceNumber?: number; invoiceFy?: number } | null>(),
};

/**
 * The payload a bill job is STORED with carries the invoice serial the ORDER
 * holds: the server is the only source of it, so a client-sent value is always
 * dropped and replaced by the stored one (an old tab that never sends the keys
 * gets them too). A cancelled-after-payment bill keeps its serial. Every other
 * kind is returned unchanged. Never mutates the input; never throws.
 */
export async function billPayloadWithInvoice(
  payload: PrintJobPayload,
  deps: InvoiceReadDeps = INVOICE_READ_DEPS,
): Promise<PrintJobPayload> {
  if (payload.kind !== "bill") return payload;
  const snapshot = { ...payload.snapshot };
  delete snapshot.invoiceNumber;
  delete snapshot.invoiceFy;
  if (mongoose.isValidObjectId(snapshot._id)) {
    try {
      const stored = await deps.readInvoice(snapshot._id);
      if (typeof stored?.invoiceNumber === "number" && typeof stored.invoiceFy === "number") {
        snapshot.invoiceNumber = stored.invoiceNumber;
        snapshot.invoiceFy = stored.invoiceFy;
      }
    } catch {
      // No serial on this print rather than a failed print (the stamp's rule, lib/bill-first-print.ts).
    }
  }
  return { ...payload, snapshot };
}
