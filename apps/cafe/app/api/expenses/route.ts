import { connectDB } from "@/lib/db";
import { created, failure, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { categoryChoiceError } from "@/lib/expenses/categories";
import { expenseDateError, listExpenses, listQueryFilter, toExpenseDto } from "@/lib/expenses/entries";
import { createExpense } from "@/lib/expenses/entries-write";
import { createExpenseSchema, expenseListQuerySchema } from "@/schemas";
import { EXPENSE_LIST_PAGE } from "@pos/shared/expense";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

// Shown when an account has no display name (createdBy is required, never "").
const UNNAMED_STAFF = "Staff";

// GET /api/expenses — any signed-in account (D9). An admin reads the filtered
// date range (?from&to&categoryId&mode&limit); STAFF always get only the
// entries THEY added today, whatever the query says. `count` / `totalPaise`
// cover every matching row even when `rows` was cut at the limit.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const { user } = authed.session;
  const isAdmin = user.role === "admin";

  const sp = new URL(req.url).searchParams;
  const query = expenseListQuerySchema.safeParse({
    categoryId: sp.get("categoryId") ?? undefined,
    mode: sp.get("mode") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!query.success) return failure("Invalid filters", 400);

  const now = new Date();
  let range;
  if (isAdmin) {
    const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
    if ("error" in parsed) return failure(parsed.error, 400);
    range = parsed.range;
  }

  try {
    const { scope, filter } = listQueryFilter({
      isAdmin,
      userId: user.id,
      now,
      range,
      categoryId: query.data.categoryId,
      mode: query.data.mode,
    });
    return success(await listExpenses(filter, query.data.limit ?? EXPENSE_LIST_PAGE, scope));
  } catch (error) {
    return serverError("Failed to fetch expenses", error);
  }
}

// POST /api/expenses — any signed-in account (staff may add, owner decision).
// Who added it comes from the SESSION only. A repeated clientRef returns the
// FIRST row with 200 instead of recording the expense twice (D7).
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const { user } = authed.session;

  const parsed = await validateBody(req, createExpenseSchema);
  if ("error" in parsed) return parsed.error;

  const dateError = expenseDateError(parsed.data.date, new Date());
  if (dateError) return failure(dateError, 400);

  try {
    await connectDB();
    const categoryError = await categoryChoiceError(parsed.data.categoryId);
    if (categoryError) return failure(categoryError, 400);

    const result = await createExpense({
      ...parsed.data,
      createdBy: user.name?.trim() || UNNAMED_STAFF,
      createdById: user.id,
    });
    if (!result.ok) return failure(result.error, result.status);
    const dto = toExpenseDto(result.row);
    return result.replay ? success(dto) : created(dto);
  } catch (error) {
    return serverError("Failed to save the expense", error);
  }
}
