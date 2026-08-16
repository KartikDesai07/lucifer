import {
  success,
  failure,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { receiveDuePayment, listDuePayments } from "@/lib/due-payment";
import { duePaymentSchema } from "@/schemas";
import { maskCustomer } from "@/lib/customer-privacy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/customers/[id]/payments — this customer's dues-payment history,
// newest first, INCLUDING soft-deleted rows (the UI shows them struck
// through). Staff-accessible like the POST below — the owner's decision: the
// cashier who can record a payment can also see what was recorded.
export async function GET(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;

  try {
    const payments = await listDuePayments(id);
    return success(payments);
  } catch (error) {
    return serverError("Failed to fetch payment history", error);
  }
}

// POST /api/customers/[id]/payments — staff: record money actually taken
// against a customer's outstanding balance (CR1.4). Staff-accessible, not
// admin-only: the cashier who takes the cash is the one who must be able to
// record it — `/customers` is not in ADMIN_ROUTES, so the page is already
// staff-reachable. All the actual logic (idempotency, the CAS decrement, the
// append-only record) lives in the shared server core, which the admin-only
// settle route below also delegates to — this route owns only auth + the
// envelope.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const role = authed.session.user.role;

  const { id } = await params;

  const parsed = await validateBody(req, duePaymentSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await receiveDuePayment({
      customerId: id,
      amount: parsed.data.amount,
      mode: parsed.data.mode,
      note: parsed.data.note,
      clientRef: parsed.data.clientRef,
      receivedBy: authed.session.user?.name ?? "",
    });
    if (!result.ok) return failure(result.error, result.status);
    // receiveDuePayment's customer is already a lean plain object (see
    // lib/due-payment.ts) — no .toObject() needed before masking.
    return success(maskCustomer(result.customer, role));
  } catch (error) {
    return serverError("Failed to record the payment", error);
  }
}
