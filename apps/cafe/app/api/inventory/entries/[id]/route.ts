import mongoose from "mongoose";
import { failure, notFound, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { STOCK_ENTRY_NOT_FOUND_ERROR, deleteStockEntry } from "@/lib/inventory/entries-write";
import { SUPPLIER_ARCHIVED_ENTRY_ERROR, entryMovesArchivedDues } from "@/lib/inventory/suppliers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Shown when an account has no display name (deletedBy is stamped, never "").
const UNNAMED_STAFF = "Staff";
const CONFLICT_STATUS = 409;

// DELETE /api/inventory/entries/[id]: soft delete (admin only). The row stays with who deleted it and when, and its
// lines come back out of stock exactly once (a second delete of the same entry is a 404 and moves nothing). An entry
// that would change an ARCHIVED supplier's dues is refused (409): that due could never be seen or paid.
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(STOCK_ENTRY_NOT_FOUND_ERROR);

  try {
    if (await entryMovesArchivedDues(id)) return failure(SUPPLIER_ARCHIVED_ENTRY_ERROR, CONFLICT_STATUS);
    const result = await deleteStockEntry(id, authed.session.user.name?.trim() || UNNAMED_STAFF, new Date());
    if (!result.ok) return failure(result.error, result.status);
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete the stock entry", error);
  }
}
