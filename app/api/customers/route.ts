import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import cache, { TTL } from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAuth,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { createCustomerSchema } from "@/schemas";
import { escapeRegex } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CACHE_KEY = "customers";

// GET /api/customers — list all (cached 2min) or search by name/mobile (no cache)
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const search = new URL(req.url).searchParams.get("search")?.trim();

  try {
    if (search) {
      await connectDB();
      const rx = new RegExp(escapeRegex(search), "i");
      const customers = await Customer.find({
        $or: [{ name: rx }, { mobile: rx }],
      })
        .sort({ name: 1 })
        .limit(50)
        .lean();
      return success(customers);
    }

    // No search → check the cache before opening a DB connection (a cache hit
    // needs no DB round-trip).
    const cachedCustomers = cache.get(CACHE_KEY);
    if (cachedCustomers) return success(cachedCustomers);

    await connectDB();
    const customers = await Customer.find().sort({ name: 1 }).lean();
    cache.set(CACHE_KEY, customers, TTL.CUSTOMERS);
    return success(customers);
  } catch (error) {
    return serverError("Failed to fetch customers", error);
  }
}

// POST /api/customers — create (clears cache)
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createCustomerSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const customer = await Customer.create(parsed.data);
    cache.del(CACHE_KEY);
    return created(customer);
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      return failure("A customer with this mobile already exists", 400);
    }
    return serverError("Failed to create customer", e);
  }
}
