import mongoose from "mongoose";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAdmin,
  serverError,
} from "@/lib/api-helpers";
import { editDuePayment, softDeleteDuePayment } from "@/lib/due-payment";
import { editDuePaymentSchema, deleteDuePaymentSchema } from "@/schemas";
import { maskCustomer } from "@/lib/customer-privacy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; paymentId: string }> };

// PATCH /api/customers/[id]/payments/[paymentId] — admin: correct a
// mis-keyed dues receipt (wrong amount/mode/typo'd note). Admin-only: unlike
// recording a payment (staff-reachable), rewriting money history needs a
// manager. `editedBy` is stamped from the session, never the request body.
export async function PATCH(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const role = admin.session.user.role;

  const { id, paymentId } = await params;
  if (!mongoose.isValidObjectId(paymentId)) return notFound("Payment not found");

  const parsed = await validateBody(req, editDuePaymentSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await editDuePayment({
      customerId: id,
      paymentId,
      amount: parsed.data.amount,
      mode: parsed.data.mode,
      note: parsed.data.note,
      editedBy: admin.session.user?.name ?? "",
    });
    if (!result.ok) return failure(result.error, result.status);
    // maskCustomer is required here (customer-privacy-paths.test.ts's
    // completeness sweep) — same discipline as every other customer-
    // returning route under app/api/customers/.
    return success({ payment: result.payment, customer: maskCustomer(result.customer, role) });
  } catch (error) {
    return serverError("Failed to update the payment", error);
  }
}

// DELETE /api/customers/[id]/payments/[paymentId] — admin: soft-delete a
// wrongly-recorded receipt (the row + why it stopped counting both stay).
// `note` is read from the request body — `apiSend` sends a body with DELETE.
// `deletedBy` is stamped from the session, never the request body.
export async function DELETE(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const role = admin.session.user.role;

  const { id, paymentId } = await params;
  if (!mongoose.isValidObjectId(paymentId)) return notFound("Payment not found");

  const parsed = await validateBody(req, deleteDuePaymentSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await softDeleteDuePayment({
      customerId: id,
      paymentId,
      note: parsed.data.note,
      deletedBy: admin.session.user?.name ?? "",
    });
    if (!result.ok) return failure(result.error, result.status);
    return success({ payment: result.payment, customer: maskCustomer(result.customer, role) });
  } catch (error) {
    return serverError("Failed to delete the payment", error);
  }
}
