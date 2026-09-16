import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TELEGRAM_ALLOWED_UPDATES } from "@pos/shared/telegram-alert";
import { success, failure, requireAdmin, validateBody } from "@/lib/api-helpers";
import { sealSecret } from "@/lib/telegram/secret";
import { getTelegramConfig, writeTelegramCreds, clearTelegramCreds } from "@/lib/telegram/config";
import { createTelegramPort } from "@/lib/telegram/api";

// CR2.3b §21.7 (AS AMENDED) — POST validates a pasted BotFather token via
// getMe, THEN seals+persists the credentials, THEN calls setWebhook. Persist-
// before-setWebhook is deliberate: a setWebhook failure must never strand a
// state where Telegram holds a secret we never saved (Repair heals it from
// the stored creds — this route never re-derives anything Telegram already
// has). DELETE reverses the order: it needs the STORED token to call
// deleteWebhook, so that call happens FIRST, and creds are unset regardless
// of its outcome.

export const dynamic = "force-dynamic";

// BotFather token shape: digits, a colon, then the secret part. Telegram has
// never published a fixed length for the secret part — this stays permissive
// on the tail (30-70) rather than pinning an exact count.
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,70}$/;
const connectBodySchema = z.object({
  token: z.string().regex(TELEGRAM_BOT_TOKEN_PATTERN, "That doesn't look like a BotFather token."),
});

// Generated, then sliced down to this many base64url characters (a charset
// ⊂ Telegram's own allowed secret-token charset) — the raw byte count below
// is deliberately larger so the slice never runs short.
const TELEGRAM_WEBHOOK_SECRET_LENGTH = 64;
const TELEGRAM_WEBHOOK_SECRET_RAW_BYTES = 64;

const getMeResultSchema = z.object({
  id: z.number(),
  username: z.string().optional(),
});

const TOKEN_REJECTED_MESSAGE = "Token was rejected by Telegram.";
const NO_USERNAME_MESSAGE = "The bot has no username — recreate it with BotFather.";
const NOT_DEPLOYED_MESSAGE = "Telegram needs the deployed https site — run setup from the live panel.";
const KEY_MATERIAL_MISSING_MESSAGE = "Server key material is missing.";

const LOCALHOST_MARKERS = ["localhost", "127.0.0.1"];

// Derives the webhook URL from the ADMIN'S OWN request (never a new env var —
// white-label). Refuses anything that isn't the deployed https site: a
// preview/local host can never receive a real Telegram callback anyway.
function deriveWebhookUrl(req: Request): string | null {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return null;
  if (proto !== "https") return null;
  if (LOCALHOST_MARKERS.some((marker) => host.includes(marker))) return null;
  return `https://${host}/api/telegram/webhook`;
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const parsed = await validateBody(req, connectBodySchema);
  if ("error" in parsed) return parsed.error;
  const { token } = parsed.data;

  try {
    const port = createTelegramPort(token);
    const me = await port.getMe();
    if (!me.ok) return failure(TOKEN_REJECTED_MESSAGE, 400);

    const meResult = getMeResultSchema.safeParse(me.result);
    if (!meResult.success) return failure(TOKEN_REJECTED_MESSAGE, 400);
    const { id, username } = meResult.data;
    if (!username) return failure(NO_USERNAME_MESSAGE, 400);

    const url = deriveWebhookUrl(req);
    if (!url) return failure(NOT_DEPLOYED_MESSAGE, 400);

    const secret = randomBytes(TELEGRAM_WEBHOOK_SECRET_RAW_BYTES)
      .toString("base64url")
      .slice(0, TELEGRAM_WEBHOOK_SECRET_LENGTH);

    const tokenEnc = sealSecret(token, "bot-token");
    const secretEnc = sealSecret(secret, "webhook-secret");
    if (!tokenEnc || !secretEnc) return failure(KEY_MATERIAL_MISSING_MESSAGE, 500);

    const now = new Date();
    // Persist FIRST — see the file-header note on why this order is load-bearing.
    await writeTelegramCreds({
      telegramBotTokenEnc: tokenEnc,
      telegramWebhookSecretEnc: secretEnc,
      telegramBotId: String(id),
      telegramBotUsername: username,
      telegramValidatedAt: now,
    });

    const webhook = await port.setWebhook({
      url,
      secretToken: secret,
      allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES],
      dropPendingUpdates: true,
    });

    if (!webhook.ok) {
      // Creds stay — "Repair webhook" re-runs setWebhook from the stored
      // secret rather than leaving a half-connected state.
      return success({ username, botId: String(id), webhookUrl: null, webhookSet: false });
    }

    await writeTelegramCreds({ telegramWebhookUrl: url, telegramWebhookSetAt: now });
    return success({ username, botId: String(id), webhookUrl: url, webhookSet: true });
  } catch {
    return failure("Could not connect the Telegram bot.", 500);
  }
}

export async function DELETE() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    const config = await getTelegramConfig();
    let webhookDeleted = false;
    if (config.state !== "absent" && config.token) {
      const result = await createTelegramPort(config.token).deleteWebhook();
      webhookDeleted = result.ok;
    }
    // Unset regardless of the outcome above — chat rows are retained
    // (reconnecting the same bot keeps everyone registered).
    await clearTelegramCreds();
    return success({ webhookDeleted });
  } catch {
    return failure("Could not disconnect the Telegram bot.", 500);
  }
}
