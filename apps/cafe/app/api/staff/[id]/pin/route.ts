import mongoose from "mongoose";
import type { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";
import { success, notFound, requireAdmin, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The PIN is shown to admins in the clear (spec 5.2), so no cache may keep it.
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

// GET /api/staff/[id]/pin — the staff member's PIN, or null when none is set (admin only)
export async function GET(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return noStore(admin.error);

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Staff not found"));

  try {
    await connectDB();
    const staff = await Staff.findById(id).select("+pin").lean<{ pin?: string } | null>();
    if (!staff) return noStore(notFound("Staff not found"));
    return noStore(success({ pin: staff.pin ?? null }));
  } catch (error) {
    return noStore(serverError("Failed to fetch the PIN", error));
  }
}
