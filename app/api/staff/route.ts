import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import cache, { TTL } from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { createStaffSchema } from "@/schemas";
import { BCRYPT_ROUNDS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const CACHE_KEY = "staff";

// GET /api/staff — list all staff (admin only, cached 5min, no password)
export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    const cachedStaff = cache.get(CACHE_KEY);
    if (cachedStaff) return success(cachedStaff);

    await connectDB();
    const staff = await Staff.find().select("-password").sort({ name: 1 }).lean();
    cache.set(CACHE_KEY, staff, TTL.STAFF);
    return success(staff);
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
