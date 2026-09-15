import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import cache from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { listStaff, STAFF_LIST } from "@/lib/masters";
import { createStaffSchema } from "@/schemas";
import { BCRYPT_ROUNDS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// POST's invalidation must clear exactly the key the shared list function
// caches under, so it is read off the spec rather than re-spelled here.
const CACHE_KEY = STAFF_LIST.cacheKey;

// GET /api/staff — list all staff (admin only, cached TTL.STAFF, no password).
// The query/sort/projection/cache-key/TTL live in STAFF_LIST (lib/masters.ts),
// which GET /api/bootstrap serves the admin-only staff part from too, so this
// route and the bootstrap can never drift apart.
export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    return success(await listStaff());
  } catch (error) {
    return serverError("Failed to fetch staff", error);
  }
}

// POST /api/staff — create staff (admin only, hashes password)
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const parsed = await validateBody(req, createStaffSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const password = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    const staff = await Staff.create({ ...parsed.data, password });

    // Re-read without the password rather than stripping the hash by hand.
    const safe = await Staff.findById(staff._id).select("-password").lean();
    cache.del(CACHE_KEY);
    return created(safe);
  } catch (e) {
    if (isDuplicateKeyError(e)) return failure("Username already taken", 400);
    return serverError("Failed to create staff", e);
  }
}
