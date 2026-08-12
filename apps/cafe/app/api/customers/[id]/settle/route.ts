import { success, failure, validateBody, requireAdmin, serverError } from "@/lib/api-helpers";
import { receiveDuePayment } from "@/lib/due-payment";
import { duePaymentSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/customers/[id]/settle — admin: clear a customer's outstanding
// dues in full. Delegates wholly to the same server core the staff-facing
// POST /api/customers/[id]/payments route uses (CR1.4) — `amount` is always
// omitted here, which resolves to "pay the full balance" (resolveDueAmount's
// omitted-means-full rule) and reproduces this route's old `totalDue: 0`
// semantics exactly, but now as an honest, recorded DuePayment instead of a
// silent overwrite. The mode is NOT fabricated: the caller (the confirm
// dialog) supplies it, same as the staff route.
export async function POST(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;

  const parsed = await validateBody(req, duePaymentSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await receiveDuePayment({
      customerId: id,
      // amount always omitted — this route only ever pays the full balance.
      mode: parsed.data.mode,
      note: parsed.data.note,
      clientRef: parsed.data.clientRef,
      receivedBy: admin.session.user?.name ?? "",
    });
    if (!result.ok) return failure(result.error, result.status);
    return success(result.customer);
  } catch (error) {
    return serverError("Failed to settle dues", error);
  }
}
