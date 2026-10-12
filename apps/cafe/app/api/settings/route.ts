import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { getSettings, invalidateSettingsCache, settingsUpdateOf } from "@/lib/settings";
import cache from "@/lib/cache";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";
import { invalidateTelegramConfigCache } from "@/lib/telegram/config";
import {
  success,
  validateBody,
  requireAuth,
  requireAdmin,
  serverError,
  failure,
} from "@/lib/api-helpers";
import { updateSettingsSchema } from "@/schemas";
import { rewardLevelsSwitchOnRefusal } from "@/lib/reward-levels-config";
import { SCRATCH_BLOCK_ENV_VAR } from "@pos/shared/reward-levels";

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
    // CB-7 S5: an OFF -> ON flip of the scratch cards is refused while they are blocked for this cafe (platform
    // flag or Tamil Nadu GSTIN). The stored blob is read FRESH (never the 45 s cache) and only when this PUT
    // switches levels on; the GSTIN is the one the cafe will have after this save.
    if (parsed.data.rewardLevels?.enabled === true) {
      const stored = await Settings.findOne({}).select("rewardLevels gstNumber").lean();
      const refusal = rewardLevelsSwitchOnRefusal(parsed.data.rewardLevels, stored?.rewardLevels, {
        envFlag: process.env[SCRATCH_BLOCK_ENV_VAR],
        gstNumber: parsed.data.gstNumber ?? stored?.gstNumber,
      });
      if (refusal !== null) return failure(refusal, 409);
    }
    // A null slip template is cleared ($unset); see settingsUpdateOf.
    const settings = await Settings.findOneAndUpdate({}, settingsUpdateOf(parsed.data), {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }).lean();

    invalidateSettingsCache();
    // CR2.2 fix round — restaurantName/allowTableChange/gst all ride the
    // public menu payload (lib/public-menu.ts), so a settings save must
    // invalidate that cache too, not just its own. Residual client/edge
    // staleness is bounded by the menu route's own max-age=30/swr=60 (≤90s
    // worst case) — accepted, re-checked on the CR2.5 device leg.
    cache.del(PUBLIC_MENU_CACHE_KEY);
    // telegramPaused rides this PUT; getTelegramConfig() resolves it into a
    // separately-cached object, so this PUT must invalidate that cache too.
    invalidateTelegramConfigCache();
    return success(settings);
  } catch (error) {
    return serverError("Failed to update settings", error);
  }
}
