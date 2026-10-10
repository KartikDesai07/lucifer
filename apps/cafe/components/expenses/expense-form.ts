// The add/edit sheet's rules, kept out of the component so they can be tested
// without React: what a blank form holds, what is wrong with it, and the exact
// request it becomes. The typed ₹ text is turned into integer paise with
// rupeesTextToPaise (string math) — never a float multiply.
import {
  EXPENSE_AMOUNT_MAX_PAISE,
  EXPENSE_AMOUNT_MAX_RUPEES,
  EXPENSE_BACKDATE_MAX_DAYS,
  EXPENSE_DEFAULT_PAYMENT_MODE,
  paiseToRupeesText,
  rupeesTextToPaise,
  type ExpensePaymentMode,
} from "@pos/shared/expense";
import { addDays } from "@/lib/dashboard/range";
import type { CreateExpenseInput, UpdateExpenseInput } from "@/schemas";
import type { ExpenseDto } from "@/types/expenses";

export interface ExpenseFormValues {
  amountText: string;
  name: string;
  categoryId: string;
  date: string;
  paymentMode: ExpensePaymentMode;
  note: string;
}

// Keyed like the request fields (categoryId, never a bare "category" — lib/category-readers-pins.test.ts).
export type ExpenseFormField = "amount" | "name" | "categoryId" | "date";
export type ExpenseFormErrors = Partial<Record<ExpenseFormField, string>>;

export const AMOUNT_FORMAT_ERROR = "Enter an amount like 450 or 450.50";
export const AMOUNT_ZERO_ERROR = "Enter an amount above ₹0";
export const AMOUNT_TOO_BIG_ERROR = `An expense can be at most ₹${EXPENSE_AMOUNT_MAX_RUPEES.toLocaleString("en-IN")}`;
export const NAME_ERROR = "Say what the money was spent on";
export const CATEGORY_ERROR = "Pick a category";
export const DATE_ERROR = "Pick a date from the last year, up to today";

/** The dates the sheet may offer: a year back, never the future. */
export function expenseDateBounds(today: string): { min: string; max: string } {
  return { min: addDays(today, -EXPENSE_BACKDATE_MAX_DAYS), max: today };
}

export function initialExpenseValues(expense: ExpenseDto | null, today: string): ExpenseFormValues {
  if (!expense) {
    return { amountText: "", name: "", categoryId: "", date: today, paymentMode: EXPENSE_DEFAULT_PAYMENT_MODE, note: "" };
  }
  return {
    amountText: paiseToRupeesText(expense.amountPaise),
    name: expense.name,
    categoryId: expense.categoryId,
    date: expense.date,
    paymentMode: expense.paymentMode,
    note: expense.note ?? "",
  };
}

export interface ExpenseFormCheck {
  errors: ExpenseFormErrors;
  /** The typed amount in paise; null while the amount text is not a valid amount. */
  amountPaise: number | null;
}

/**
 * `originalDate` (edits): an UNCHANGED date may have aged out of the window since
 * the row was added — only a changed date is held to it, exactly like the server
 * (lib/expenses/entries-write.ts), so an old row can still be corrected.
 */
export function validateExpenseForm(values: ExpenseFormValues, today: string, originalDate?: string): ExpenseFormCheck {
  const errors: ExpenseFormErrors = {};
  const parsed = rupeesTextToPaise(values.amountText);
  let amountPaise: number | null = null;
  if (parsed === null) errors.amount = AMOUNT_FORMAT_ERROR;
  else if (parsed < 1) errors.amount = AMOUNT_ZERO_ERROR;
  else if (parsed > EXPENSE_AMOUNT_MAX_PAISE) errors.amount = AMOUNT_TOO_BIG_ERROR;
  else amountPaise = parsed;

  if (values.name.trim() === "") errors.name = NAME_ERROR;
  if (values.categoryId === "") errors.categoryId = CATEGORY_ERROR;
  const { min, max } = expenseDateBounds(today);
  const dateChanged = values.date !== originalDate;
  if (values.date === "" || (dateChanged && (values.date < min || values.date > max))) errors.date = DATE_ERROR;
  return { errors, amountPaise };
}

export function buildCreateInput(values: ExpenseFormValues, amountPaise: number, clientRef: string): CreateExpenseInput {
  const note = values.note.trim();
  return {
    name: values.name.trim(),
    categoryId: values.categoryId,
    date: values.date,
    amountPaise,
    paymentMode: values.paymentMode,
    ...(note ? { note } : {}),
    clientRef,
  };
}

/**
 * Only what the editor changed (an unchanged hidden category is never re-sent),
 * plus `expectedUpdatedAt` — the row as the editor SAW it. A cleared note goes
 * as "" (JSON cannot carry "remove"). null = nothing changed.
 */
export function buildUpdateInput(before: ExpenseDto, values: ExpenseFormValues, amountPaise: number): UpdateExpenseInput | null {
  const patch: Omit<UpdateExpenseInput, "expectedUpdatedAt"> = {};
  const name = values.name.trim();
  const note = values.note.trim();
  if (name !== before.name) patch.name = name;
  if (values.categoryId !== before.categoryId) patch.categoryId = values.categoryId;
  if (values.date !== before.date) patch.date = values.date;
  if (amountPaise !== before.amountPaise) patch.amountPaise = amountPaise;
  if (values.paymentMode !== before.paymentMode) patch.paymentMode = values.paymentMode;
  if (note !== (before.note ?? "")) patch.note = note;
  if (Object.keys(patch).length === 0) return null;
  return { ...patch, expectedUpdatedAt: before.updatedAt };
}

/**
 * The category the form may show and submit: the chosen id while it is still
 * offered, else "" (the placeholder, and "Pick a category" on save). A category
 * hidden by an admin while a "Save & add another" run keeps its id would
 * otherwise sit in a blank trigger and fail on the server. `null` options =
 * the list has not loaded (or failed): keep the id and let the server decide.
 */
export function offeredCategoryId(options: readonly { value: string }[] | null, categoryId: string): string {
  if (options === null) return categoryId;
  return options.some((option) => option.value === categoryId) ? categoryId : "";
}
