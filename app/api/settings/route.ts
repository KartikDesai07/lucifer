import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import {
  success,
  validateBody,
  requireAuth,
  requireAdmin,
  serverError,
} from "@/lib/api-helpers";
import { updateSettingsSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/settings — any authenticated user (POS receipt needs it). Cached;
// getSettings() materializes the singleton atomically (no read-then-create race).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    const settings = await getSettings();
    return success(settings);
  } catch (error) {
    return serverError("Failed to fetch settings", error);
  }
}

// PUT /api/settings — admin only. Upserts the singleton, then clears the cache.
export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const parsed = await validateBody(req, updateSettingsSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const settings = await Settings.findOneAndUpdate({}, parsed.data, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }).lean();

    invalidateSettingsCache();
    return success(settings);
  } catch (error) {
    return serverError("Failed to update settings", error);
  }
}
