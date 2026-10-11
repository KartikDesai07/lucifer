import { connectDB } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { scratchCardsBlockedFor } from "@/lib/reward-levels-config";
import { success, requireAdmin, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// GET /api/settings/reward-levels — admin only. CB-7 S3: the settings document has no server-computed booleans and
// scratchCardsBlockedFor reads process.env (server-only), so the scratch-card editor asks here whether cards are
// blocked on this platform. Only the verdict leaves the server — never the env value, never the settings.
export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    await connectDB();
    const settings = await getSettings();
    return success({ scratchBlocked: scratchCardsBlockedFor(settings) });
  } catch (error) {
    return serverError("Failed to read the scratch card status", error);
  }
}
