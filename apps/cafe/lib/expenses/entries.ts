import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { ACTIVE_EXPENSE, ExpenseEntry } from "@/models/ExpenseEntry";
import { addDays } from "@/lib/dashboard/range";
import { cafeDateString, dayRange } from "@/lib/utils";
import { EXPENSE_BACKDATE_MAX_DAYS, type ExpensePaymentMode } from "@pos/shared/expense";
import type { DashboardRange } from "@/types/dashboard";
import type { ExpenseDto, ExpenseListDto } from "@/types/expenses";

// Read side of the expense ledger (Step EXP): the wire DTO, the date window, the
// list filter and the list read. The writes live in ./entries-write.ts (split
// for the file-size cap). The helpers above `listExpenses` are pure and DB-free
// so tests call them directly.

export const EXPENSE_FUTURE_DATE_ERROR = "The date can't be in the future";
export const EXPENSE_OLD_DATE_ERROR = "The date can't be more than a year ago";

/** A lean ExpenseEntry as the DTO reads it (ids may be ObjectIds or strings). */
export interface ExpenseRow {
  _id: { toString(): string };
  name: string;
  categoryId: { toString(): string };
  date: string;
  amountPaise: number;
  paymentMode: ExpensePaymentMode;
  note?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  edits?: readonly unknown[];
}

/**
 * Lean row → wire shape. Money stays integer PAISE; the internals (clientRef,
 * createdById, v, the delete stamp and the edit trail itself) never leave the
 * server — `edited` is the only trace of the trail.
 */
export function toExpenseDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row._id.toString(),
    name: row.name,
    categoryId: row.categoryId.toString(),
    date: row.date,
    amountPaise: row.amountPaise,
    paymentMode: row.paymentMode,
    ...(row.note !== undefined ? { note: row.note } : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    edited: (row.edits?.length ?? 0) > 0,
  };
}

/** The IST day keys an expense may be dated: today back to EXPENSE_BACKDATE_MAX_DAYS ago (D8). */
export function expenseDateWindow(now: Date): { min: string; max: string } {
  const max = cafeDateString(now);
  return { min: addDays(max, -EXPENSE_BACKDATE_MAX_DAYS), max };
}

/** Why `date` ("YYYY-MM-DD") is outside the window, or null when it is fine. */
export function expenseDateError(date: string, now: Date): string | null {
  const { min, max } = expenseDateWindow(now);
  if (date > max) return EXPENSE_FUTURE_DATE_ERROR;
  if (date < min) return EXPENSE_OLD_DATE_ERROR;
  return null;
}

export interface ExpenseListFilter {
  deletedAt: { $exists: false };
  date?: { $gte: string; $lte: string };
  categoryId?: Types.ObjectId;
  paymentMode?: ExpensePaymentMode;
  createdById?: string;
  createdAt?: { $gte: Date; $lte: Date };
}

export interface ExpenseListQueryInput {
  isAdmin: boolean;
  userId: string;
  now: Date;
  /** Admin only — the route parses it (parseDashboardRange); staff never need one. */
  range?: DashboardRange;
  categoryId?: string;
  mode?: ExpensePaymentMode;
}

/**
 * The Mongo filter + which list it is (D9). Staff are FORCED to the entries
 * they added today — whatever range / category / mode they send is ignored. The
 * categoryId is cast to an ObjectId here because the same filter also feeds a
 * raw `$match` (no auto-cast) in listExpenses.
 */
export function listQueryFilter(input: ExpenseListQueryInput): {
  scope: ExpenseListDto["scope"];
  filter: ExpenseListFilter;
} {
  if (!input.isAdmin || !input.range) {
    const { start, end } = dayRange(input.now);
    return {
      scope: "mine-today",
      filter: { ...ACTIVE_EXPENSE, createdById: input.userId, createdAt: { $gte: start, $lte: end } },
    };
  }
  return {
    scope: "range",
    filter: {
      ...ACTIVE_EXPENSE,
      date: { $gte: input.range.from, $lte: input.range.to },
      ...(input.categoryId ? { categoryId: new Types.ObjectId(input.categoryId) } : {}),
      ...(input.mode ? { paymentMode: input.mode } : {}),
    },
  };
}

interface ExpenseSumRow {
  _id: null;
  totalPaise: number;
  count: number;
}

/**
 * Newest first (date, then added-at). `count` and `totalPaise` cover EVERY
 * matching row from one `$group`; the page itself reads limit + 1 rows so
 * `truncated` is exact without a second count.
 */
export async function listExpenses(
  filter: ExpenseListFilter,
  limit: number,
  scope: ExpenseListDto["scope"],
): Promise<ExpenseListDto> {
  await connectDB();
  const [found, [sum]] = await Promise.all([
    ExpenseEntry.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit + 1)
      .lean(),
    ExpenseEntry.aggregate<ExpenseSumRow>([
      { $match: filter },
      { $group: { _id: null, totalPaise: { $sum: "$amountPaise" }, count: { $sum: 1 } } },
    ]),
  ]);
  return {
    scope,
    rows: found.slice(0, limit).map(toExpenseDto),
    count: sum?.count ?? 0,
    totalPaise: sum?.totalPaise ?? 0,
    truncated: found.length > limit,
  };
}
