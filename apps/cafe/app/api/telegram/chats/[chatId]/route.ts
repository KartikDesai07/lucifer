import { z } from "zod";
import { normalizeAlertTypes } from "@pos/shared/telegram-alert";
import { success, failure, requireAdmin, validateBody } from "@/lib/api-helpers";
import { updateChatToggles, removeChat, type ChatTogglePatch } from "@/lib/telegram/chats";

// CR2.3b §21.7 — PATCH toggles a chat's alert types / active flag (re-
// activates a 403-deactivated row); DELETE removes the row entirely.

export const dynamic = "force-dynamic";

// Telegram chat ids can be negative (groups/channels) and up to ~20 digits —
// the same shape lib/telegram/chats.ts's own (unexported) CHAT_ID_PATTERN
// gates on; declared again here since that constant isn't exported.
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,20}$/;

const patchChatBodySchema = z.object({
  types: z.unknown().optional(),
  active: z.boolean().optional(),
});

type Params = { params: Promise<{ chatId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { chatId } = await params;
  if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId)) return success({ updated: false });

  const parsed = await validateBody(req, patchChatBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    // Normalized at the route boundary too (not only inside updateChatToggles)
    // so the stored value is already registry-shaped before it crosses the
    // lib/telegram/chats.ts seam.
    const patch: ChatTogglePatch = {};
    if (parsed.data.types !== undefined) patch.types = normalizeAlertTypes(parsed.data.types);
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;

    const result = await updateChatToggles(chatId, patch);
    if (result === "error") return failure("Could not update that chat.", 500);
    return success({ updated: result === "updated" });
  } catch {
    return failure("Could not update that chat.", 500);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { chatId } = await params;
  if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId)) return success({ removed: false });

  try {
    const result = await removeChat(chatId);
    if (result === "error") return failure("Could not remove that chat.", 500);
    return success({ removed: result === "removed" });
  } catch {
    return failure("Could not remove that chat.", 500);
  }
}
