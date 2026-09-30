import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Area } from "@/models/Area";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { renameAreaSchema } from "@/schemas";
import { AREA_LIST } from "@/lib/masters";
import { AREA_DUPLICATE_ERROR, AREA_NOT_FOUND_ERROR } from "@/lib/area-admin";
import { areaInUseMessage } from "@/lib/table-areas";

export const dynamic = "force-dynamic";

const CACHE_KEY = AREA_LIST.cacheKey;

type Params = { params: Promise<{ id: string }> };

// PUT /api/areas/[id] — rename (admin). Tables link by areaId only, so a rename
// touches nothing on the table side - no cascade. Reordering is PATCH /api/areas.
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(AREA_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, renameAreaSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    // A second writer of `name`: same reason as the POST - never rename before
    // the unique collation index is guaranteed to exist (memoized per process).
    await Area.init();
    // One atomic write (not read, set, save): a rename racing a delete finds
    // nothing to update and answers 404 instead of failing the save with a 500.
    const updated = await Area.findOneAndUpdate({ _id: id }, { $set: parsed.data }, { new: true, runValidators: true });
    if (!updated) return notFound(AREA_NOT_FOUND_ERROR);

    cache.del(CACHE_KEY);
    return success(updated.toObject());
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(AREA_DUPLICATE_ERROR, 400);
    return serverError("Failed to rename area", error);
  }
}

// DELETE /api/areas/[id] — delete only while no table uses the area (admin).
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(AREA_NOT_FOUND_ERROR);

  try {
    await connectDB();
    const area = await Area.findById(id);
    if (!area) return notFound(AREA_NOT_FOUND_ERROR);

    // Refuse to delete an area still in use: tables link by areaId only, so a
    // delete would leave every such table pointing at nothing. Accepted residual
    // (the categories one): a table saved into the area between this count and
    // the delete below reads as "no area" until the operator re-picks one.
    const count = await Table.countDocuments({ areaId: id });
    if (count > 0) return failure(areaInUseMessage(count), 409);

    await area.deleteOne();

    cache.del(CACHE_KEY);
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete area", error);
  }
}
