import { TELEGRAM_ALLOWED_UPDATES } from "@pos/shared/telegram-alert";
import { success, failure, requireAdmin } from "@/lib/api-helpers";
import { getTelegramConfig, writeTelegramCreds } from "@/lib/telegram/config";
import { createTelegramPort } from "@/lib/telegram/api";

// CR2.3b §21.7 — re-runs setWebhook with the STORED secret (no re-paste).
// Heals the "webhook-unset" half-state connect/route.ts can leave behind
// when its own setWebhook call fails.

export const dynamic = "force-dynamic";

const NOT_CONNECTED_MESSAGE = "Connect a bot token first.";
const NOT_DEPLOYED_MESSAGE = "Telegram needs the deployed https site — run setup from the live panel.";
const LOCALHOST_MARKERS = ["localhost", "127.0.0.1"];

// Same derivation + refusal as connect/route.ts's deriveWebhookUrl — kept as
// a local copy (this slice may only touch the nine named files, so the two
// routes cannot share a helper module).
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

  try {
    const config = await getTelegramConfig();
    if (config.state !== "ok" || !config.token || !config.webhookSecret) {
      return failure(NOT_CONNECTED_MESSAGE, 400);
    }

    const url = deriveWebhookUrl(req);
    if (!url) return failure(NOT_DEPLOYED_MESSAGE, 400);

    const webhook = await createTelegramPort(config.token).setWebhook({
      url,
      secretToken: config.webhookSecret,
      allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES],
      dropPendingUpdates: true,
    });

    if (!webhook.ok) return success({ webhookUrl: null, webhookSet: false });

    await writeTelegramCreds({ telegramWebhookUrl: url, telegramWebhookSetAt: new Date() });
    return success({ webhookUrl: url, webhookSet: true });
  } catch {
    return failure("Could not repair the Telegram webhook.", 500);
  }
}
