import mongoose from "mongoose";
import type { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAdmin,
  isDuplicateKeyError,
} from "@/lib/api-helpers";
import { updateStaffSchema } from "@/schemas";

export const dynamic = "force-dynamic";

const CACHE_KEY = "staff";

type Params = { params: Promise<{ id: string }> };

// Refuse any update/deactivation that would leave the cafe with zero active
// admins — that would lock everyone out of staff management, settings, and
// reports with no way back in. Returns a ready 400 response to refuse, else null.
// Assumes connectDB() has already been called.
//
// Note: the count-then-write is not atomic, so two concurrent demotions of two
// *different* admins could in theory both pass and drive the active-admin count
// to zero. Accepted at single-cafe scale (one or two admins; demotions are rare,
// deliberate, single-operator actions) and recoverable by reactivating in the DB.
async function guardLastAdmin(
  targetId: string,
  next: { role?: "admin" | "staff"; isActive?: boolean },
): Promise<NextResponse | null> {
  const demoting = next.role === "staff";
  const deactivating = next.isActive === false;
  if (!demoting && !deactivating) return null;

  const target = await Staff.findById(targetId)
    .select("role isActive")
    .lean<{ role: "admin" | "staff"; isActive: boolean } | null>();
  // Only an active admin losing admin/active status can orphan the set.
  if (!target || target.role !== "admin" || !target.isActive) return null;

  const activeAdmins = await Staff.countDocuments({
    role: "admin",
    isActive: true,
  });
  if (activeAdmins <= 1) {
    return failure("Cannot remove the last active admin", 400);
  }
  return null;
}

// GET /api/staff/[id] — single staff (admin only, no password)
export async function GET(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Staff not found");

  try {
    await connectDB();
    const staff = await Staff.findById(id).select("-password").lean();
    if (!staff) return notFound("Staff not found");
    return success(staff);
  } catch {
    return failure("Failed to fetch staff");
  }
}

// PUT /api/staff/[id] — update staff details (admin only; password via change-password)
export async function PUT(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Staff not found");

  const parsed = await validateBody(req, updateStaffSchema);
  if ("error" in parsed) return parsed.error;

  // Mirror the DELETE self-lockout guard: an admin must not demote or deactivate
  // their OWN account (PUT could otherwise bypass it via role/isActive).
  if (
    id === admin.session.user.id &&
    (parsed.data.role === "staff" || parsed.data.isActive === false)
  ) {
    return failure("You cannot demote or deactivate your own account", 400);
  }

  try {
    await connectDB();
    const guard = await guardLastAdmin(id, parsed.data);
    if (guard) return guard;

    const staff = await Staff.findByIdAndUpdate(id, parsed.data, {
      new: true,
      runValidators: true,
    })
      .select("-password")
      .lean();
    if (!staff) return notFound("Staff not found");
    cache.del(CACHE_KEY);
    return success(staff);
  } catch (e) {
    if (isDuplicateKeyError(e)) return failure("Username already taken", 400);
    return failure("Failed to update staff");
  }
}

// DELETE /api/staff/[id] — soft delete (isActive:false), admin only
export async function DELETE(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Staff not found");

  // An admin must not lock themselves out of their own account.
  if (id === admin.session.user.id) {
    return failure("You cannot deactivate your own account", 400);
  }

  try {
    await connectDB();
    const guard = await guardLastAdmin(id, { isActive: false });
    if (guard) return guard;

    const staff = await Staff.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    )
      .select("-password")
      .lean();
    if (!staff) return notFound("Staff not found");
    cache.del(CACHE_KEY);
    return success({ deleted: true });
  } catch {
    return failure("Failed to delete staff");
  }
}
