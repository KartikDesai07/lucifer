import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { success, failure, requireAdmin } from "@/lib/api-helpers";
import { getTelegramConfig } from "@/lib/telegram/config";
import { createTelegramPort } from "@/lib/telegram/api";
import { listChats } from "@/lib/telegram/chats";

// CR2.3b §21.7 — read-only admin status card. Never a 500 for a Telegram-side
// failure (getWebhookInfo is a best-effort live check): the stored config +
// chat-registry counts are always returned even when Telegram itself is
// unreachable.

export const dynamic = "force-dynamic";

// A chat counts as "erroring" once its last send failure falls inside this
// trailing window — visible on the card without opening every row.
const TELEGRAM_ERRORING_WINDOW_MS = 24 * 60 * 60 * 1000;

const webhookInfoResultSchema = z.object({
  url: z.string().optional(),
  pending_update_count: z.number().optional(),
  last_error_message: z.string().optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    const config = await getTelegramConfig();

    // telegramWebhookSetAt is NOT select:false on the schema, so a plain
    // (no `+`) projection is allowed here — lib/telegram/config.ts's
    // TelegramConfig shape doesn't carry this field and this slice may not
    // touch that file (see the S6 report's flagged ambiguity).
    await connectDB();
    const doc = await Settings.findOne({}).select("telegramWebhookSetAt").lean();
    const webhookSetAt = doc?.telegramWebhookSetAt ?? null;

    const rows = await listChats();
    const activeChats = rows.filter((row) => row.active).length;
    const erroringCutoff = Date.now() - TELEGRAM_ERRORING_WINDOW_MS;
    const erroringChats = rows.filter(
      (row) => row.lastErrorAt && row.lastErrorAt.getTime() >= erroringCutoff,
    ).length;

    let live: { urlMatches: boolean; pendingUpdateCount: number; lastErrorMessage: string | null } | null = null;
    let liveError = false;
    if (config.state === "ok" && config.token) {
      const info = await createTelegramPort(config.token).getWebhookInfo();
      const parsedInfo = info.ok ? webhookInfoResultSchema.safeParse(info.result) : null;
      if (info.ok && parsedInfo?.success) {
        live = {
          urlMatches: parsedInfo.data.url === config.webhookUrl,
          pendingUpdateCount: parsedInfo.data.pending_update_count ?? 0,
          lastErrorMessage: parsedInfo.data.last_error_message ?? null,
        };
      } else {
        liveError = true;
      }
    }

    return success({
      state: config.state,
      paused: config.paused,
      botUsername: config.botUsername ?? null,
      botId: config.botId ?? null,
      webhookUrl: config.webhookUrl ?? null,
      webhookSetAt,
      activeChats,
      erroringChats,
      live,
      liveError,
    });
  } catch {
    return failure("Could not load Telegram status.", 500);
  }
}
