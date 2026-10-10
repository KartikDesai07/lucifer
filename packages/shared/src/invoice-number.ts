// Print customization S10: the GST invoice serial a tax invoice carries (CGST Rule 46(b): a consecutive serial,
// unique for a financial year, at most 16 characters of digits and "/" or "-"). One series per Indian financial
// year (1 April to 31 March, IST), printed as "2627/000123": the FY's two short years, then the running number.
// Pure and client-safe. The cafe's daily restart time never applies here: the invoice series runs the whole year.
import { cafeDateString } from "./utils";

export const FY_START_MONTH = 4; // April
export const INVOICE_SERIAL_DIGITS = 6; // the running number is padded to this many digits
export const INVOICE_NUMBER_MAX_LENGTH = 16; // Rule 46(b)
const INVOICE_SEPARATOR = "/";
const SHORT_YEAR_DIGITS = 2;
const CENTURY = 100;
const FY_LABEL_LENGTH = SHORT_YEAR_DIGITS * 2;
const FY_MIN = 1000; // a four-digit start year
const FY_MAX = 9998; // so the FY's end year (fy + 1) is four digits too
/** The largest running number that still prints within INVOICE_NUMBER_MAX_LENGTH ("2627/" + 11 digits). */
export const INVOICE_SERIAL_MAX = 10 ** (INVOICE_NUMBER_MAX_LENGTH - FY_LABEL_LENGTH - INVOICE_SEPARATOR.length) - 1;

/** The financial year an instant belongs to, named by its START year: 31 Mar 2027 IST → 2026, 1 Apr 2027 IST → 2027. */
export function invoiceFyOf(date: Date): number {
  const [year, month] = cafeDateString(date).split("-").map(Number);
  return month >= FY_START_MONTH ? year : year - 1;
}

/** A stored running number: a whole number from 1 that still prints within the 16-character limit. */
export function isInvoiceSerial(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= INVOICE_SERIAL_MAX;
}

/** A stored financial year (its start year): any whole four-digit year. */
export function isInvoiceFy(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= FY_MIN && value <= FY_MAX;
}

function shortYear(year: number): string {
  return String(year % CENTURY).padStart(SHORT_YEAR_DIGITS, "0");
}

/** "2627" for the financial year that starts in 2026. */
export function invoiceFyLabel(fy: number): string {
  return `${shortYear(fy)}${shortYear(fy + 1)}`;
}

/** The printed invoice number: "2627/000123". */
export function invoiceLabel(fy: number, serial: number): string {
  return `${invoiceFyLabel(fy)}${INVOICE_SEPARATOR}${String(serial).padStart(INVOICE_SERIAL_DIGITS, "0")}`;
}

/** The invoice number an order carries, or null when it has none (both stored fields, or neither). */
export function invoiceLabelOf(order: { invoiceNumber?: number; invoiceFy?: number }): string | null {
  return typeof order.invoiceNumber === "number" && typeof order.invoiceFy === "number"
    ? invoiceLabel(order.invoiceFy, order.invoiceNumber)
    : null;
}
