import mongoose from "mongoose";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { toExpenseDto } from "@/lib/expenses/entries";
import { EXPENSE_NOT_FOUND_ERROR, softDeleteExpense, updateExpense } from "@/lib/expenses/entries-write";
import { updateExpenseSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Shown when an account has no display name (the edit trail's `by` is required).
const UNNAMED_STAFF = "Staff";

// PATCH /api/expenses/[id] — edit (admin only; staff can add but never change).
// Optimistic: `expectedUpdatedAt` is the row as the editor saw it, a miss is a
// 409 (or a 404 when the row was deleted meanwhile). The row's before-values go
// onto its edit trail; the date / category re-validation lives in updateExpense.
export async function PATCH(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(EXPENSE_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, updateExpenseSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await updateExpense({
      id,
      input: parsed.data,
      editedBy: authed.session.user.name?.trim() || UNNAMED_STAFF,
      now: new Date(),
    });
    if (!result.ok) return failure(result.error, result.status);
    return success(toExpenseDto(result.row));
  } catch (error) {
    return serverError("Failed to update the expense", error);
  }
}

// DELETE /api/expenses/[id] — soft delete (admin only): the row stays with who
// deleted it and when, and stops counting in lists and reports.
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(EXPENSE_NOT_FOUND_ERROR);

  try {
    const result = await softDeleteExpense(id, authed.session.user.name?.trim() || UNNAMED_STAFF, new Date());
    if (!result.ok) return failure(result.error, result.status);
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete the expense", error);
  }
}
