import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAuth,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { updateCustomerSchema } from "@/schemas";
import { maskCustomer, stripMobileForRole } from "@/lib/customer-privacy";

export const dynamic = "force-dynamic";

const CACHE_KEY = "customers";

type Params = { params: Promise<{ id: string }> };

// GET /api/customers/[id]
export async function GET(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const role = authed.session.user.role;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const customer = await Customer.findById(id).lean();
    if (!customer) return notFound("Customer not found");
    return success(maskCustomer(customer, role));
  } catch (error) {
    return serverError("Failed to fetch customer", error);
  }
}

// PUT /api/customers/[id] — update (clears cache)
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const role = authed.session.user.role;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  const parsed = await validateBody(req, updateCustomerSchema);
  if ("error" in parsed) return parsed.error;

  // A staff client only ever holds the masked number, so a `mobile` arriving
  // from one can only be that mask echoed back by the edit form — writing it
  // would overwrite a unique-indexed field with stars. Drop it for non-admins.
  const data = stripMobileForRole(parsed.data, role);

  try {
    await connectDB();
    const customer = await Customer.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!customer) return notFound("Customer not found");
    cache.del(CACHE_KEY);
    return success(maskCustomer(customer, role));
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      return failure("A customer with this mobile already exists", 400);
    }
    return serverError("Failed to update customer", e);
  }
}

// DELETE /api/customers/[id] — admin only, and blocked if the customer has
// outstanding dues.
//
// Admin-only (owner rule) because this is the one destructive act on the
// customer record, and it takes their whole due-payment HISTORY out of reach
// with it: DuePayment rows survive the delete but every read is keyed on the
// customer, who no longer appears anywhere. The zero-dues guard below does not
// help — a mis-keyed payment is exactly what drives a balance to 0. Every other
// money-history-destroying action here (cancel, settle, reconcile, payment
// edit/delete) is already requireAdmin; this was the outlier.
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const customer = await Customer.findById(id).lean();
    if (!customer) return notFound("Customer not found");
    if (customer.totalDue > 0) {
      return failure("Cannot delete a customer with outstanding dues", 400);
    }

    await Customer.findByIdAndDelete(id);
    cache.del(CACHE_KEY);
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete customer", error);
  }
}
