import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  notFound,
  failure,
  validateBody,
  requireAuth,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { updateTableSchema, patchTableSchema } from "@/schemas";
import {
  FREE_TABLE_FILTER,
  TABLE_BUSY_ERROR,
  TABLE_CLAIMED_ERROR,
  TABLE_DUPLICATE_ERROR,
  TABLE_NOT_FOUND_ERROR,
  freeTableFilter,
} from "@/lib/table-admin";

export const dynamic = "force-dynamic";

const CACHE_KEY = "tables";

type Params = { params: Promise<{ tableNo: string }> };

// PUT /api/tables/[tableNo] — update status + order pointer (clears cache)
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { tableNo } = await params;

  const parsed = await validateBody(req, updateTableSchema);
  if ("error" in parsed) return parsed.error;

  const { expectedCurrentOrderId } = parsed.data;

  try {
    await connectDB();
    const update: Record<string, unknown> = { status: parsed.data.status };
    // Freeing a table clears its order pointer; otherwise honor the new one.
    // expectedCurrentOrderId is a FILTER directive only (below) — it must
    // never land in $set as a stored field.
    if (parsed.data.status === "Available") {
      update.currentOrderId = "";
    } else if (parsed.data.currentOrderId !== undefined) {
      update.currentOrderId = parsed.data.currentOrderId;
    }

    // A caller that echoes expectedCurrentOrderId (the POS free-table prompt)
    // is asserting which order it believes still holds the table — the write
    // only lands if that's still true (reciprocal-CAS, CR1.5 Slice 2).
    const filter = freeTableFilter(tableNo, expectedCurrentOrderId);
    const table = await Table.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean();

    if (!table) {
      // No echo supplied → the filter was plain {tableNo}, so a miss can only
      // mean the table doesn't exist. An echo supplied → disambiguate exactly
      // like PATCH's rename-busy-guard: query again without the CAS clause to
      // tell "table gone" apart from "another order already claimed it".
      if (expectedCurrentOrderId === undefined) return notFound(TABLE_NOT_FOUND_ERROR);
      const stillThere = await Table.exists({ tableNo });
      return stillThere
        ? failure(TABLE_CLAIMED_ERROR, 409)
        : notFound(TABLE_NOT_FOUND_ERROR);
    }

    cache.del(CACHE_KEY);
    return success(table);
  } catch (error) {
    return serverError("Failed to update table", error);
  }
}

// PATCH /api/tables/[tableNo] — rename and/or re-seat a table (admin config
// seam; PUT above stays the staff-accessible live-status seam).
export async function PATCH(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { tableNo } = await params;

  const parsed = await validateBody(req, patchTableSchema);
  if ("error" in parsed) return parsed.error;

  const renaming =
    parsed.data.tableNo !== undefined && parsed.data.tableNo !== tableNo;

  try {
    await connectDB();
    // The busy-guard lives IN the write filter (not a read-then-write check),
    // so a rename can never race a table being seated.
    const filter = renaming ? { tableNo, ...FREE_TABLE_FILTER } : { tableNo };
    const table = await Table.findOneAndUpdate(filter, { $set: parsed.data }, {
      new: true,
      runValidators: true,
    }).lean();

    if (!table) {
      if (!renaming) return notFound(TABLE_NOT_FOUND_ERROR);
      const stillThere = await Table.exists({ tableNo });
      return stillThere
        ? failure(TABLE_BUSY_ERROR, 400)
        : notFound(TABLE_NOT_FOUND_ERROR);
    }

    cache.del(CACHE_KEY);
    return success(table);
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(TABLE_DUPLICATE_ERROR, 400);
    return serverError("Failed to update table", error);
  }
}

// DELETE /api/tables/[tableNo] — remove a table from the floor plan. Only
// while free — a rename never rewrites historical orders (they live on the
// immutable LEDGER cluster), so a busy table can't be deleted out from under
// its open tab.
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { tableNo } = await params;

  try {
    await connectDB();
    const removed = await Table.findOneAndDelete({
      tableNo,
      ...FREE_TABLE_FILTER,
    }).lean();

    if (!removed) {
      const stillThere = await Table.exists({ tableNo });
      return stillThere
        ? failure(TABLE_BUSY_ERROR, 400)
        : notFound(TABLE_NOT_FOUND_ERROR);
    }

    cache.del(CACHE_KEY);
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete table", error);
  }
}
