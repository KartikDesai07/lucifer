import { connectDB } from "@/lib/db";
import { ExpenseCategory } from "@/models/ExpenseCategory";
import {
  created,
  failure,
  isDuplicateKeyError,
  requireAdmin,
  requireAuth,
  serverError,
  success,
  validateBody,
} from "@/lib/api-helpers";
import {
  EXPENSE_CATEGORY_DUPLICATE_ERROR,
  EXPENSE_CATEGORY_LIMIT_ERROR,
  ensureExpenseCategories,
  listExpenseCategories,
  toExpenseCategoryDto,
} from "@/lib/expenses/categories";
import { createExpenseCategorySchema } from "@/schemas";
import { EXPENSE_CATEGORIES_MAX } from "@pos/shared/expense";

export const dynamic = "force-dynamic";

// GET /api/expense-categories — any signed-in account (the add sheet needs the
// list). ALL categories, hidden ones flagged, in the owner's order; the 8
// defaults are seeded here the first time the list is empty (D4).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await ensureExpenseCategories();
    return success(await listExpenseCategories());
  } catch (error) {
    return serverError("Failed to fetch expense categories", error);
  }
}

// POST /api/expense-categories — add a category (admin). It always lands at the
// END of the list (the Area idiom), never at a position the client chose.
export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createExpenseCategorySchema);
  if ("error" in parsed) return parsed.error;

  try {
    // Seed first: adding a custom category to a never-opened (empty) list would
    // otherwise stop the defaults from ever being seeded. This also awaits the
    // unique collation index (init() is memoized per process) before the cap
    // check and the insert — connectDB()'s autoIndex build is not awaited.
    await ensureExpenseCategories();
    await connectDB();
    await ExpenseCategory.init();
    // Accepted residual (the Area one): two admins adding in the same instant can
    // both pass this count and land one over the cap; the next add is refused.
    if ((await ExpenseCategory.countDocuments()) >= EXPENSE_CATEGORIES_MAX) {
      return failure(EXPENSE_CATEGORY_LIMIT_ERROR, 400);
    }

    const last = await ExpenseCategory.findOne().sort({ displayOrder: -1 }).select("displayOrder").lean();
    // +1 past the last (a count would collide with the numbering after hides).
    const displayOrder = (last?.displayOrder ?? -1) + 1;
    const category = await ExpenseCategory.create({ name: parsed.data.name, displayOrder });
    return created(toExpenseCategoryDto(category.toObject()));
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(EXPENSE_CATEGORY_DUPLICATE_ERROR, 400);
    return serverError("Failed to create the category", error);
  }
}
