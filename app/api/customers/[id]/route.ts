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
  isDuplicateKeyError,
} from "@/lib/api-helpers";
import { updateCustomerSchema } from "@/schemas";

export const dynamic = "force-dynamic";

const CACHE_KEY = "customers";

type Params = { params: Promise<{ id: string }> };

// GET /api/customers/[id]
export async function GET(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const customer = await Customer.findById(id).lean();
    if (!customer) return notFound("Customer not found");
    return success(customer);
  } catch {
    return failure("Failed to fetch customer");
  }
}

// PUT /api/customers/[id] — update (clears cache)
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  const parsed = await validateBody(req, updateCustomerSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const customer = await Customer.findByIdAndUpdate(id, parsed.data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!customer) return notFound("Customer not found");
    cache.del(CACHE_KEY);
    return success(customer);
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      return failure("A customer with this mobile already exists", 400);
    }
    return failure("Failed to update customer");
  }
}

// DELETE /api/customers/[id] — blocked if the customer has outstanding dues
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAuth();
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
  } catch {
    return failure("Failed to delete customer");
  }
}
