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
import { CUSTOMER_SEARCH_LIMIT } from "@/lib/constants";
import { maskCustomer, maskCustomers } from "@/lib/customer-privacy";

export const dynamic = "force-dynamic";

const CACHE_KEY = "customers";

// List projection (F2.10 audit): every list consumer (customers table, POS
// search, form pre-fill, history header) reads only these; timestamps are never
// rendered and `appliedOrders` is already `select:false` on the schema.
const LIST_FIELDS = "name mobile visits totalSpend totalDue notes";

// GET /api/customers — list all (cached 2min) or search by name/mobile (no cache)
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const role = authed.session.user.role;

  const search = new URL(req.url).searchParams.get("search")?.trim();

  try {
    if (search) {
      await connectDB();
      const rx = new RegExp(escapeRegex(search), "i");
      const customers = await Customer.find({
        $or: [{ name: rx }, { mobile: rx }],
      })
        .select(LIST_FIELDS)
        .sort({ name: 1 })
        .limit(CUSTOMER_SEARCH_LIMIT)
        .lean();
      return success(maskCustomers(customers, role));
    }

    // No search → check the cache before opening a DB connection (a cache hit
    // needs no DB round-trip).
    const cachedCustomers = cache.get<Array<Record<string, unknown>>>(CACHE_KEY);
    if (cachedCustomers) return success(maskCustomers(cachedCustomers, role));

    await connectDB();
    // Full list by design (§9: cache the whole list or nothing) — projected,
    // never truncated: a .limit() here would poison the cache with partial data.
    const customers = await Customer.find()
      .select(LIST_FIELDS)
      .sort({ name: 1 })
      .lean();
    // Cache the RAW, unmasked docs — the cache is process-wide and shared
    // across roles; caching a masked list would serve stars to the next admin.
    cache.set(CACHE_KEY, customers, TTL.CUSTOMERS);
    return success(maskCustomers(customers, role));
  } catch (error) {
    return serverError("Failed to fetch customers", error);
  }
}

// POST /api/customers — create (clears cache)
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const role = authed.session.user.role;

  const parsed = await validateBody(req, createCustomerSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const customer = await Customer.create(parsed.data);
    cache.del(CACHE_KEY);
    // Customer.create() returns a Mongoose document, not a lean object —
    // spreading it directly (inside maskCustomer) would leak its internals,
    // so convert to a plain object first.
    return created(maskCustomer(customer.toObject(), role));
  } catch (e) {
    if (isDuplicateKeyError(e)) {
      return failure("A customer with this mobile already exists", 400);
    }
    return serverError("Failed to create customer", e);
  }
}
