import { created, failure, requireAdmin, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { listStockEntries, stockEntryDateError, toStockEntryDto } from "@/lib/inventory/entries-read";
import { createStockEntry } from "@/lib/inventory/entries-write";
import { createStockEntrySchema, stockEntryListQuerySchema } from "@/schemas";

export const dynamic = "force-dynamic";

// Shown when an account has no display name (createdBy is required, never "").
const UNNAMED_STAFF = "Staff";

// GET /api/inventory/entries: the wastage, count and purchase history (admin). Newest first, one page at a time: send the
// answer's `nextBefore` back as ?before= for the next one.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const query = stockEntryListQuerySchema.safeParse({
    before: sp.get("before") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!query.success) return failure("Invalid page", 400);

  try {
    return success(await listStockEntries(query.data));
  } catch (error) {
    return serverError("Failed to fetch stock entries", error);
  }
}

// POST /api/inventory/entries: log a wastage (any signed-in account: staff record what was thrown away), or a count
// or a purchase (admin only: a count sets the stock number, a purchase is money). Deny by default: any kind other than
// a wastage needs an admin. Who did it comes from the SESSION only. A repeated clientRef returns the FIRST entry with
// 200 instead of recording it, and moving stock, twice.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const { user } = authed.session;

  const parsed = await validateBody(req, createStockEntrySchema);
  if ("error" in parsed) return parsed.error;
  if (parsed.data.kind !== "waste" && user.role !== "admin") return failure("Admin access required", 403);

  const dateError = stockEntryDateError(parsed.data.date, new Date());
  if (dateError) return failure(dateError, 400);

  try {
    const result = await createStockEntry({
      ...parsed.data,
      createdBy: user.name?.trim() || UNNAMED_STAFF,
      createdById: user.id,
    });
    if (!result.ok) return failure(result.error, result.status);
    const dto = toStockEntryDto(result.row, result.items, result.suppliers);
    return result.replay ? success(dto) : created(dto);
  } catch (error) {
    return serverError("Failed to save the stock entry", error);
  }
}
