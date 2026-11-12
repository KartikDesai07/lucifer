import mongoose from "mongoose";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { SUPPLIER_NOT_FOUND_ERROR, updateSupplier } from "@/lib/inventory/suppliers";
import { updateSupplierSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/inventory/suppliers/[id]: rename, set or clear the phone / note, or archive (admin). Archiving is refused
// while the supplier is still owed or owed to. There is no DELETE: an archived supplier keeps its name on old entries.
export async function PATCH(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(SUPPLIER_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, updateSupplierSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await updateSupplier(id, parsed.data);
    if (!result.ok) return failure(result.error, result.status);
    return success(result.dto);
  } catch (error) {
    return serverError("Failed to update the supplier", error);
  }
}
