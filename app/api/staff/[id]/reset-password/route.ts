import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import {
  success,
  notFound,
  validateBody,
  requireAdmin,
  serverError,
} from "@/lib/api-helpers";
import { resetPasswordSchema } from "@/schemas";
import { BCRYPT_ROUNDS } from "@/lib/constants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/staff/[id]/reset-password — admin sets a new password for a staff
// member who is locked out (forgot theirs). No current password required; this
// is the admin override that self-service change-password can't cover.
export async function POST(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Staff not found");

  const parsed = await validateBody(req, resetPasswordSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const password = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
    const staff = await Staff.findByIdAndUpdate(id, { password })
      .select("_id")
      .lean();
    if (!staff) return notFound("Staff not found");
    return success({ updated: true });
  } catch (error) {
    return serverError("Failed to reset password", error);
  }
}
