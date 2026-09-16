import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import {
  success,
  failure,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { changePasswordSchema } from "@/schemas";
import { BCRYPT_ROUNDS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Any signed-in user can change their OWN password.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, changePasswordSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const staff = await Staff.findById(authed.session.user.id).select(
      "+password",
    );
    if (!staff) return failure("User not found", 404);

    const isValid = await bcrypt.compare(
      parsed.data.currentPassword,
      staff.password,
    );
    if (!isValid) return failure("Current password is incorrect", 400);

    staff.password = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
    await staff.save();

    return success({ updated: true });
  } catch (error) {
    return serverError("Failed to change password", error);
  }
}
