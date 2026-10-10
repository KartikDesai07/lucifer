// CSV rows for the Expenses report (Step EXP) — plain objects for lib/export.ts
// exportToCSV (headers = the first row's keys). Pure: no React, no fetch.
// Money arrives as integer PAISE and leaves as a plain "450.00" rupee figure a
// spreadsheet reads as a number.
import { EXPENSE_PAYMENT_MODE_LABELS } from "@pos/shared/expense";
import type { ExpenseDto } from "@/types/expenses";

type CsvRow = Record<string, string>;

const PAISE_PER_RUPEE = 100;
const PAISE_DIGITS = 2;
// A cell starting with one of these is read as a formula by a spreadsheet; a
// typed expense name or note must never run as one.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** 45000 → "450.00", 45050 → "450.50" (integer math, no float rounding). */
export function paiseToCsvRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / PAISE_PER_RUPEE)}.${String(abs % PAISE_PER_RUPEE).padStart(PAISE_DIGITS, "0")}`;
}

/** Typed text is prefixed with an apostrophe when a spreadsheet could read it as a formula. */
export function csvSafeText(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

/** One row per expense, in the order given (the report reads them newest first). */
export function expensesCsvRows(rows: readonly ExpenseDto[], categoryNames: ReadonlyMap<string, string>): CsvRow[] {
  return rows.map((row) => ({
    Date: row.date,
    What: csvSafeText(row.name),
    Category: csvSafeText(categoryNames.get(row.categoryId) ?? ""),
    "Paid by": EXPENSE_PAYMENT_MODE_LABELS[row.paymentMode],
    // ASCII header: lib/export.ts writes no BOM, and Excel would mangle a ₹ here.
    "Amount (INR)": paiseToCsvRupees(row.amountPaise),
    Note: csvSafeText(row.note ?? ""),
    "Added by": csvSafeText(row.createdBy),
  }));
}
