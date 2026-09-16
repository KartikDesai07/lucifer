import { z } from "zod";
import { connectDB } from "@/lib/db";
import { TelegramInvite } from "@/models/TelegramInvite";
import { telegramDeepLink } from "@pos/shared/telegram-alert";
import { success, failure, requireAdmin, validateBody } from "@/lib/api-helpers";
import { getTelegramConfig } from "@/lib/telegram/config";
import { mintInvite } from "@/lib/telegram/chats";

// CR2.3b §21.7 — GET lists LIVE (unused, unexpired) invites for the admin
// card; POST mints one. Per the S6 spec, GET reads TelegramInvite directly
// rather than through lib/telegram/chats.ts (flagged in the S6 report — that
// module's own header comment claims to be the only Mongoose access point
// for the chat/invite registry; chats.ts wasn't in this slice's touch list
// so no listInvites() export exists there yet).

export const dynamic = "force-dynamic";

const TELEGRAM_INVITE_LABEL_MAX = 60;
const mintInviteBodySchema = z.object({
  label: z.string().trim().min(1).max(TELEGRAM_INVITE_LABEL_MAX),
});

const NOT_CONNECTED_MESSAGE = "Connect a bot token first.";
const INVITE_CAP_MESSAGE = "Invite limit reached — revoke an unused invite first.";
const MINT_FAILURE_MESSAGE = "Could not mint a Telegram invite.";

interface InviteListRow {
  code: string;
  label: string;
  expiresAt: Date;
}

export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    await connectDB();
    const config = await getTelegramConfig();
    const rows = (await TelegramInvite.find({ usedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
      .select("code label expiresAt")
      .sort({ expiresAt: 1 })
      .lean()) as unknown as InviteListRow[];

    return success(
      rows.map((row) => ({
        code: row.code,
        label: row.label,
        expiresAt: row.expiresAt,
        deepLink: config.botUsername ? telegramDeepLink(config.botUsername, row.code) : null,
      })),
    );
  } catch {
    return failure("Could not load Telegram invites.", 500);
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const parsed = await validateBody(req, mintInviteBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    const config = await getTelegramConfig();
    if (config.state !== "ok") return failure(NOT_CONNECTED_MESSAGE, 400);

    const minted = await mintInvite(parsed.data.label);
    if (minted === "cap") return failure(INVITE_CAP_MESSAGE, 409);
    if (minted === "error") return failure(MINT_FAILURE_MESSAGE, 500);

    return success({
      code: minted.code,
      label: minted.label,
      expiresAt: minted.expiresAt,
      deepLink: config.botUsername ? telegramDeepLink(config.botUsername, minted.code) : null,
    });
  } catch {
    return failure(MINT_FAILURE_MESSAGE, 500);
  }
}
