import { success, failure, requireAdmin } from "@/lib/api-helpers";
import { listChats } from "@/lib/telegram/chats";

// CR2.3b §21.7 — list every registered Telegram chat (active and
// deactivated). TelegramChatRow carries no secret by construction.

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    const rows = await listChats();
    return success(rows);
  } catch {
    return failure("Could not load Telegram chats.", 500);
  }
}
