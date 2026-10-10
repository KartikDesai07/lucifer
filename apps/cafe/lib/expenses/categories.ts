import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { ExpenseCategory } from "@/models/ExpenseCategory";
import { isDuplicateKeyError } from "@pos/shared/api";
import { EXPENSE_CATEGORIES_MAX, EXPENSE_DEFAULT_CATEGORIES } from "@pos/shared/expense";
import type { ExpenseCategoryDto } from "@/types/expenses";

// Server core for the expense-category list (Step EXP, D4). The routes under
// app/api/expense-categories own auth + the envelope; this file owns the seed,
// the DTO and the shared "may this category be picked" rule.

export const EXPENSE_CATEGORY_DUPLICATE_ERROR = "A category with that name already exists";
export const EXPENSE_CATEGORY_LIMIT_ERROR = `You can have at most ${EXPENSE_CATEGORIES_MAX} categories`;
export const EXPENSE_CATEGORY_NOT_FOUND_ERROR = "Category not found";
export const EXPENSE_CATEGORY_HIDDEN_ERROR = "That category is hidden. Pick another one";
export const EXPENSE_CATEGORY_MISSING_ERROR = "Pick a category";

// MongoDB's duplicate-key code, as a bulk write reports it per row.
const DUPLICATE_KEY_CODE = 11000;

export interface ExpenseCategoryRow {
  _id: { toString(): string };
  name: string;
  displayOrder: number;
  hidden?: boolean;
}

/** Lean category → the wire shape (`hidden` is always a real boolean). */
export function toExpenseCategoryDto(row: ExpenseCategoryRow): ExpenseCategoryDto {
  return {
    id: row._id.toString(),
    name: row.name,
    hidden: row.hidden === true,
    displayOrder: row.displayOrder,
  };
}

// A bulk insert racing another seeder reports duplicate-key per row, not as one
// error with a top-level code — both spellings mean "someone else seeded".
function isSeedRace(error: unknown): boolean {
  if (isDuplicateKeyError(error)) return true;
  if (typeof error !== "object" || error === null || !("writeErrors" in error)) return false;
  const { writeErrors } = error as { writeErrors?: unknown };
  return (
    Array.isArray(writeErrors) &&
    writeErrors.length > 0 &&
    writeErrors.every((e: { code?: number }) => e?.code === DUPLICATE_KEY_CODE)
  );
}

/**
 * Seed the 8 defaults when the collection is EMPTY (idempotent, race-safe: the
 * unique name index swallows a concurrent seeder). `init()` first so the unique
 * collation index exists before the insert — connectDB()'s autoIndex build is
 * not awaited (the Area precedent).
 */
export async function ensureExpenseCategories(): Promise<void> {
  await connectDB();
  await ExpenseCategory.init();
  if ((await ExpenseCategory.countDocuments()) > 0) return;
  try {
    await ExpenseCategory.insertMany(
      EXPENSE_DEFAULT_CATEGORIES.map((name, displayOrder) => ({ name, displayOrder })),
      { ordered: false },
    );
  } catch (error) {
    if (!isSeedRace(error)) throw error;
  }
}

/** Every category, hidden ones included (flagged), in the owner's order. */
export async function listExpenseCategories(): Promise<ExpenseCategoryDto[]> {
  await connectDB();
  const rows = await ExpenseCategory.find().sort({ displayOrder: 1, name: 1 }).lean();
  return rows.map(toExpenseCategoryDto);
}

/**
 * Why `categoryId` may not be picked for an expense, or null when it may:
 * unknown id → "Pick a category", hidden → the hidden message.
 */
export async function categoryChoiceError(categoryId: string): Promise<string | null> {
  if (!mongoose.isValidObjectId(categoryId)) return EXPENSE_CATEGORY_MISSING_ERROR;
  await connectDB();
  const row = await ExpenseCategory.findById(categoryId).select("hidden").lean();
  if (!row) return EXPENSE_CATEGORY_MISSING_ERROR;
  return row.hidden === true ? EXPENSE_CATEGORY_HIDDEN_ERROR : null;
}
