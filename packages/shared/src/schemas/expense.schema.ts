import { z } from "zod";
import {
  EXPENSE_AMOUNT_MAX_PAISE,
  EXPENSE_AMOUNT_MAX_RUPEES,
  EXPENSE_CATEGORY_NAME_MAX_LEN,
  EXPENSE_LIST_MAX,
  EXPENSE_NAME_MAX_LEN,
  EXPENSE_NOTE_MAX_LEN,
  EXPENSE_PAYMENT_MODES,
} from "../expense";
import { objectIdString } from "./object-id.schema";

// Expense management (Step EXP, 2026-10-10). The write surfaces of
// /api/expenses and /api/expense-categories. Whether a date is in the allowed
// window (not in the future, at most EXPENSE_BACKDATE_MAX_DAYS back) needs
// "today", so the ROUTE checks that — this schema only checks the shape.

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YMD_LENGTH = 10;

/** A real calendar day "YYYY-MM-DD" (2026-02-30 is refused, not rolled over). */
function isRealYmd(value: string): boolean {
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, YMD_LENGTH) === value;
}

export const expenseDateSchema = z
  .string()
  .regex(YMD_PATTERN, "Pick a date")
  .refine(isRealYmd, "Pick a real date");

// Integer PAISE — the client converts the typed ₹ text with
// rupeesTextToPaise (../expense.ts), so no float ever reaches the server.
export const expenseAmountPaiseSchema = z
  .number()
  .int("Enter the amount in rupees and paise only")
  .min(1, "Enter an amount above ₹0")
  .max(EXPENSE_AMOUNT_MAX_PAISE, `An expense can be at most ₹${EXPENSE_AMOUNT_MAX_RUPEES.toLocaleString("en-IN")}`);

const expenseNameSchema = z
  .string()
  .trim()
  .min(1, "Say what the money was spent on")
  .max(EXPENSE_NAME_MAX_LEN, `Keep it to ${EXPENSE_NAME_MAX_LEN} characters or fewer`);

// "" is allowed and means "no note" (on an edit it REMOVES the note — JSON
// cannot carry undefined, so an absent key means "leave it alone").
const expenseNoteSchema = z
  .string()
  .trim()
  .max(EXPENSE_NOTE_MAX_LEN, `Keep the note to ${EXPENSE_NOTE_MAX_LEN} characters or fewer`);

// POST /api/expenses — any signed-in account (staff may add).
export const createExpenseSchema = z
  .object({
    name: expenseNameSchema,
    categoryId: objectIdString,
    date: expenseDateSchema,
    amountPaise: expenseAmountPaiseSchema,
    paymentMode: z.enum(EXPENSE_PAYMENT_MODES),
    note: expenseNoteSchema.optional(),
    // Client-anchored idempotency (the DuePayment precedent): one ref per
    // opened sheet, so a retried or double-tapped Save returns the FIRST row
    // instead of recording the same expense twice.
    clientRef: z.string().uuid(),
  })
  .strict();

// PATCH /api/expenses/[id] — admin. Every field optional; `expectedUpdatedAt`
// is the row's updatedAt as the editor SAW it (a stale view must send what it
// saw): the route refuses with 409 when someone changed the row since.
export const updateExpenseSchema = z
  .object({
    name: expenseNameSchema.optional(),
    categoryId: objectIdString.optional(),
    date: expenseDateSchema.optional(),
    amountPaise: expenseAmountPaiseSchema.optional(),
    paymentMode: z.enum(EXPENSE_PAYMENT_MODES).optional(),
    note: expenseNoteSchema.optional(),
    expectedUpdatedAt: z.string().datetime({ message: "Reload and try again" }),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.categoryId !== undefined ||
      v.date !== undefined ||
      v.amountPaise !== undefined ||
      v.paymentMode !== undefined ||
      v.note !== undefined,
    "Nothing to change",
  );

// GET /api/expenses query (admin; staff always get their own entries from
// today, whatever they send). from/to are parsed by the shared report range
// parser in the route, not here.
export const expenseListQuerySchema = z.object({
  categoryId: objectIdString.optional(),
  mode: z.enum(EXPENSE_PAYMENT_MODES).optional(),
  limit: z.coerce.number().int().min(1).max(EXPENSE_LIST_MAX).optional(),
});

const expenseCategoryNameSchema = z
  .string()
  .trim()
  .min(1, "Category name is required")
  .max(EXPENSE_CATEGORY_NAME_MAX_LEN, `Keep it to ${EXPENSE_CATEGORY_NAME_MAX_LEN} characters or fewer`);

// POST /api/expense-categories — admin. A new category lands at the end.
export const createExpenseCategorySchema = z.object({ name: expenseCategoryNameSchema }).strict();

// PATCH /api/expense-categories/[id] — admin: rename and/or hide / show.
// There is no delete: a category old expenses point at must keep its name.
export const updateExpenseCategorySchema = z
  .object({
    name: expenseCategoryNameSchema.optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.hidden !== undefined, "Nothing to change");

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;
