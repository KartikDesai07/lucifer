import { z } from "zod";
import { success, failure, requireAdmin, validateBody } from "@/lib/api-helpers";
import { getTelegramConfig } from "@/lib/telegram/config";
import { createTelegramPort } from "@/lib/telegram/api";
import { listChats, mongooseChatStore } from "@/lib/telegram/chats";
import { renderTelegramMessage, type TelegramRequestSummary } from "@/lib/telegram/format";

// CR2.3b §21.7 (AS AMENDED) — a single required `chatId`, ONE Telegram call,
// no retry. An unbounded all-chat fan-out could run past the route's time
// budget (≥20 chats × the send timeout); the admin UI sends one row at a
// time instead. A Telegram-side send failure is DATA here (200, ok:false),
// never an HTTP error — it is recorded on the chat row exactly like a real
// send failure would be.

export const dynamic = "force-dynamic";

// Same shape lib/telegram/chats.ts gates chat ids on (not exported there).
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,20}$/;
const testSendBodySchema = z.object({
  chatId: z.string().regex(TELEGRAM_CHAT_ID_PATTERN),
});

const NOT_CONNECTED_MESSAGE = "Connect a bot token first.";
const PAUSED_MESSAGE = "Telegram alerts are paused — turn them on first.";
// Chosen uniformly for both "no such chat" and "chat is deactivated" — the
// spec left the exact status ambiguous ("404/400 static"); flagged in the
// S6 report.
const CHAT_NOT_AVAILABLE_MESSAGE = "That chat is not registered or is inactive.";

// Static demo content — §21.6d field set, no `note`.
const TEST_SEND_SUMMARY: TelegramRequestSummary = {
  type: "newRequest",
  shortCode: "TEST",
  targetKind: "table",
  tableNo: "5",
  name: "Test diner",
  itemCount: 2,
  itemsPreview: ["1× Demo item", "1× Second item"],
  total: 0,
};

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const parsed = await validateBody(req, testSendBodySchema);
  if ("error" in parsed) return parsed.error;
  const { chatId } = parsed.data;

  try {
    const config = await getTelegramConfig();
    if (config.state !== "ok" || !config.token) return failure(NOT_CONNECTED_MESSAGE, 400);
    if (config.paused) return failure(PAUSED_MESSAGE, 400);

    const rows = await listChats();
    const chat = rows.find((row) => row.chatId === chatId);
    if (!chat || chat.active !== true) return failure(CHAT_NOT_AVAILABLE_MESSAGE, 404);

    const text = renderTelegramMessage(TEST_SEND_SUMMARY);
    const result = await createTelegramPort(config.token).sendMessage({ chatId, text, parseMode: "HTML" });

    const now = new Date();
    if (result.ok) {
      await mongooseChatStore.recordSend(chatId, now);
      return success({ chatId, ok: true });
    }

    await mongooseChatStore.recordError(chatId, result.errorCode, now);
    return success({ chatId, ok: false, errorCode: result.errorCode });
  } catch {
    return failure("Could not send the test message.", 500);
  }
}
