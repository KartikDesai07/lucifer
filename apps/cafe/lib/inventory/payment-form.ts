// Inventory lite, Slice 6: the pay-a-supplier sheet's form, as pure functions (no React). The amount box holds TEXT; it becomes
// integer paise (rupeesTextToPaise) here, once. buildPaymentInput ALWAYS sends the typed amount, never "the due" or a pay-all
// flag, so what the person saw is what is saved. Overpaying is allowed (the supplier then shows "paid ahead").
import { paiseToRupeesText, rupeesTextToPaise } from "@pos/shared/expense";
import { STOCK_ENTRY_BACKDATE_MAX_DAYS, STOCK_ENTRY_MAX_TOTAL_PAISE, STOCK_ENTRY_NOTE_MAX_LEN } from "@pos/shared/inventory";
import { stockEntryDateBounds } from "@/lib/inventory/stock-adjust-form";
import { inrPaise } from "@/lib/utils";
import type { PaymentEntryInput } from "@/schemas";

export interface PaymentValues {
  /** The amount in rupees, as typed. */
  amountText: string;
  /** "YYYY-MM-DD". */
  date: string;
  note: string;
}

export interface PaymentErrors {
  amount?: string;
  date?: string;
  note?: string;
}

const PAISE_PER_RUPEE = 100;
const AMOUNT_EMPTY = "Enter how much you paid";
const AMOUNT_INVALID = "Enter an amount like 450 or 450.50";
const AMOUNT_ABOVE_ZERO = "Enter an amount above 0";
const AMOUNT_TOO_HIGH = `A payment can be at most ₹${(STOCK_ENTRY_MAX_TOTAL_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")}`;
const DATE_ERROR = `Pick a date from the last ${STOCK_ENTRY_BACKDATE_MAX_DAYS} days, up to today`;
const NOTE_ERROR = `Keep the note to ${STOCK_ENTRY_NOTE_MAX_LEN} characters or fewer`;

/**
 * A payment dated today; the amount starts as what is owed (editable), or empty when nothing is owed. Dues add up across
 * purchases, so a due over the one-payment cap starts at the cap (review s118: never a number Save would refuse).
 */
export function initialPaymentValues(today: string, duePaise: number): PaymentValues {
  return { amountText: duePaise > 0 ? paiseToRupeesText(Math.min(duePaise, STOCK_ENTRY_MAX_TOTAL_PAISE)) : "", date: today, note: "" };
}

/** The typed amount in paise, or null while the box is empty or unreadable. */
export function paymentAmountPaise(values: PaymentValues): number | null {
  const text = values.amountText.trim();
  return text === "" ? null : rupeesTextToPaise(text);
}

/** Field errors for the sheet; an empty object means it can be sent. */
export function validatePaymentForm(values: PaymentValues, today: string): PaymentErrors {
  const errors: PaymentErrors = {};
  if (values.amountText.trim() === "") errors.amount = AMOUNT_EMPTY;
  else {
    const paise = paymentAmountPaise(values);
    if (paise === null) errors.amount = AMOUNT_INVALID;
    else if (paise < 1) errors.amount = AMOUNT_ABOVE_ZERO;
    else if (paise > STOCK_ENTRY_MAX_TOTAL_PAISE) errors.amount = AMOUNT_TOO_HIGH;
  }
  const bounds = stockEntryDateBounds(today);
  if (values.date < bounds.min || values.date > bounds.max) errors.date = DATE_ERROR;
  if (values.note.trim().length > STOCK_ENTRY_NOTE_MAX_LEN) errors.note = NOTE_ERROR;
  return errors;
}

/** The POST body; call only after validatePaymentForm found no errors. The amount is ALWAYS the typed one; the note is trimmed and left out when empty. */
export function buildPaymentInput(values: PaymentValues, supplierId: string, clientRef: string): PaymentEntryInput {
  const amountPaise = paymentAmountPaise(values);
  if (amountPaise === null) throw new Error("buildPaymentInput needs a valid amount");
  const note = values.note.trim();
  return { kind: "payment", supplierId, amountPaise, date: values.date, ...(note === "" ? {} : { note }), clientRef };
}

/** The line under the amount box: what this payment does to the dues. null while there is no readable amount. */
export function paymentAfterText(duePaise: number, amountPaise: number | null): string | null {
  if (amountPaise === null || amountPaise < 1) return null;
  const owed = Math.max(duePaise, 0);
  if (amountPaise > owed) return `${inrPaise(amountPaise - owed)} more than you owe. It shows as paid ahead.`;
  if (amountPaise === owed) return "This settles what you owe.";
  return `Still to pay after this: ${inrPaise(owed - amountPaise)}`;
}
