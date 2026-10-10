import mongoose, { type UpdateQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { ExpenseCategory, type IExpenseCategory } from "@/models/ExpenseCategory";
import {
  failure,
  isDuplicateKeyError,
  notFound,
  requireAdmin,
  serverError,
  success,
  validateBody,
} from "@/lib/api-helpers";
import {
  EXPENSE_CATEGORY_DUPLICATE_ERROR,
  EXPENSE_CATEGORY_NOT_FOUND_ERROR,
  toExpenseCategoryDto,
} from "@/lib/expenses/categories";
import { updateExpenseCategorySchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/expense-categories/[id] — rename and/or hide / show (admin). There
// is no DELETE: expenses link by categoryId only, and an old expense must keep
// its category's name. Showing is an $unset (omit-empty — never hidden:false).
export async function PATCH(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(EXPENSE_CATEGORY_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, updateExpenseCategorySchema);
  if ("error" in parsed) return parsed.error;

  const set: Partial<Pick<IExpenseCategory, "name" | "hidden">> = {};
  if (parsed.data.name !== undefined) set.name = parsed.data.name;
  if (parsed.data.hidden === true) set.hidden = true;
  const update: UpdateQuery<IExpenseCategory> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (parsed.data.hidden === false) update.$unset = { hidden: "" };

  try {
    await connectDB();
    // A second writer of `name`: never rename before the unique collation index
    // is guaranteed to exist (memoized per process — the Area precedent).
    await ExpenseCategory.init();
    // One atomic write (not read, set, save): an unknown id answers 404, not a 500.
    const updated = await ExpenseCategory.findOneAndUpdate({ _id: id }, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) return notFound(EXPENSE_CATEGORY_NOT_FOUND_ERROR);
    return success(toExpenseCategoryDto(updated));
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(EXPENSE_CATEGORY_DUPLICATE_ERROR, 400);
    return serverError("Failed to update the category", error);
  }
}
