import { created, failure, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { createSupplier, listSuppliers } from "@/lib/inventory/suppliers";
import { createSupplierSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/inventory/suppliers: every active supplier, A to Z, with what each is owed (admin: dues are money).
export async function GET() {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  try {
    return success(await listSuppliers());
  } catch (error) {
    return serverError("Failed to fetch suppliers", error);
  }
}

// POST /api/inventory/suppliers: add a supplier (admin).
export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createSupplierSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await createSupplier(parsed.data);
    if (!result.ok) return failure(result.error, result.status);
    return created(result.dto);
  } catch (error) {
    return serverError("Failed to add the supplier", error);
  }
}
