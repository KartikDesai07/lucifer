// Expense management (Step EXP, 2026-10-10) — what /api/expenses,
// /api/expense-categories and /api/reports/expenses send back. Money is
// integer PAISE everywhere; render it with inrPaise, never inr().
import type { ExpensePaymentMode } from "@pos/shared/expense";
import type { DashboardRange } from "@/types/dashboard";

export interface ExpenseCategoryDto {
  id: string;
  name: string;
  /** Hidden categories are not offered when adding, but old expenses keep showing their name. */
  hidden: boolean;
  displayOrder: number;
}

export interface ExpenseDto {
  id: string;
  name: string;
  categoryId: string;
  /** IST business day, "YYYY-MM-DD". */
  date: string;
  amountPaise: number;
  paymentMode: ExpensePaymentMode;
  note?: string;
  /** Staff name at the time it was added. */
  createdBy: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO — sent back as expectedUpdatedAt on an edit
  /** True once an admin has changed it (the before-values stay in the row's edit trail). */
  edited: boolean;
}

/**
 * GET /api/expenses. `scope` says which list this is: an admin's filtered
 * date range, or (staff, always) the entries this account added today.
 * `count` and `totalPaise` cover EVERY matching row, even when `rows` was cut
 * at the requested limit (`truncated`).
 */
export interface ExpenseListDto {
  scope: "range" | "mine-today";
  rows: ExpenseDto[];
  count: number;
  totalPaise: number;
  truncated: boolean;
}

export interface ExpenseCategoryTotal {
  categoryId: string;
  name: string;
  hidden: boolean;
  totalPaise: number;
  count: number;
}

export interface ExpenseDayTotal {
  date: string; // "YYYY-MM-DD", oldest first
  totalPaise: number;
  count: number;
}

export interface ExpenseModeTotal {
  mode: ExpensePaymentMode;
  totalPaise: number;
  count: number;
}

/** GET /api/reports/expenses — deleted expenses never count. */
export interface ExpenseReport {
  range: DashboardRange;
  totalPaise: number;
  count: number;
  byCategory: ExpenseCategoryTotal[]; // largest first; categories with nothing spent omitted
  byDay: ExpenseDayTotal[]; // only days with an expense
  byMode: ExpenseModeTotal[]; // EXPENSE_PAYMENT_MODES order; modes with nothing omitted
}
