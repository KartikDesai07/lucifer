import cache from "@/lib/cache";
import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { openSecret } from "./secret";

// CR2.3b §21.2 #2 / §21.4 S2 — the cached read/write surface over the 8
// Telegram fields on the Settings singleton (models/Settings.ts §21.6).
// Mirrors lib/settings.ts's own cache pattern (same in-process burst-buffer
// cache, same "read-only twin never upserts" rationale) but is a SEPARATE
// cache key: the Telegram config additionally opens both sealed envelopes,
// which lib/settings.ts's readers must never do.

const TELEGRAM_CONFIG_CACHE_KEY = "telegram-config";
// Short burst-buffer TTL, matching TTL.SETTINGS (lib/cache.ts) — Telegram
// creds change only from the admin card, so a few seconds of staleness after
// Connect/Disconnect is the same accepted window Settings itself lives with.
const TELEGRAM_CONFIG_CACHE_TTL_SEC = 45;

export type TelegramConfigState = "absent" | "ok" | "unreadable";

export interface TelegramConfig {
  state: TelegramConfigState;
  token: string | null;
  webhookSecret: string | null;
  botId?: string;
  botUsername?: string;
  webhookUrl?: string;
  paused: boolean;
}

// The shape a `+telegramBotTokenEnc +telegramWebhookSecretEnc` projection
// returns — only the Telegram fields this module touches.
interface TelegramCredsDoc {
  telegramBotTokenEnc?: string;
  telegramWebhookSecretEnc?: string;
  telegramBotId?: string;
  telegramBotUsername?: string;
  telegramWebhookUrl?: string;
  telegramPaused?: boolean;
}

function resolveConfig(doc: TelegramCredsDoc | null): TelegramConfig {
  const paused = doc?.telegramPaused === true;
  if (!doc || !doc.telegramBotTokenEnc) {
    return { state: "absent", token: null, webhookSecret: null, paused };
  }

  const token = openSecret(doc.telegramBotTokenEnc, "bot-token");
  const webhookSecret = doc.telegramWebhookSecretEnc
    ? openSecret(doc.telegramWebhookSecretEnc, "webhook-secret")
    : null;
  const state: TelegramConfigState = token !== null && webhookSecret !== null ? "ok" : "unreadable";

  return {
    state,
    token,
    webhookSecret,
    botId: doc.telegramBotId,
    botUsername: doc.telegramBotUsername,
    webhookUrl: doc.telegramWebhookUrl,
    paused,
  };
}

/**
 * Cached read of the Telegram creds off the Settings singleton. A PLAIN
 * `findOne` (never getSettings()'s upserting getter, exactly like
 * readSettings() — lib/settings.ts): this is called from the anonymous
 * webhook path (lib/telegram/webhook-core.ts), and an upsert-with-timestamps
 * write on every anonymous hit would cost one Mongo write per cache window
 * against a 512MB M0 that has no backups. The `+` projection below is the
 * ONLY place in the app allowed to read either `*Enc` field (both are
 * `select: false` on the schema).
 */
export async function getTelegramConfig(): Promise<TelegramConfig> {
  const hit = cache.get<TelegramConfig>(TELEGRAM_CONFIG_CACHE_KEY);
  if (hit) return hit;

  await connectDB();
  const doc = (await Settings.findOne({})
    .select("+telegramBotTokenEnc +telegramWebhookSecretEnc")
    .lean()) as TelegramCredsDoc | null;

  const config = resolveConfig(doc);
  cache.set(TELEGRAM_CONFIG_CACHE_KEY, config, TELEGRAM_CONFIG_CACHE_TTL_SEC);
  return config;
}

export interface TelegramCredsWrite {
  telegramBotTokenEnc: string;
  telegramWebhookSecretEnc: string;
  telegramBotId: string;
  telegramBotUsername?: string;
  telegramValidatedAt: Date;
  telegramWebhookUrl?: string;
  telegramWebhookSetAt?: Date;
}

/**
 * Single re-runnable upsert (§21.7: connect/repair may call this more than
 * once for the same bot). Also invalidates the Settings cache — the write
 * touches the SAME Settings doc getSettings()/readSettings() cache, and
 * several of these fields (botUsername, webhookUrl, ...) are NOT
 * `select: false`, so a stale Settings cache entry would otherwise keep
 * serving pre-connect values to the admin card (mirrors the PUT
 * /api/settings route's own invalidation discipline).
 */
export async function writeTelegramCreds(fields: Partial<TelegramCredsWrite>): Promise<void> {
  await connectDB();
  await Settings.findOneAndUpdate({}, { $set: fields }, { upsert: true });
  invalidateTelegramConfigCache();
  invalidateSettingsCache();
}

// Every telegram CRED field — deliberately excludes `telegramPaused`: that
// is a Settings kill-switch toggle, not a credential (§21.7's DELETE row
// disconnects the bot without silently un-muting a cafe that had paused
// sends).
const TELEGRAM_CRED_FIELDS = [
  "telegramBotTokenEnc",
  "telegramWebhookSecretEnc",
  "telegramBotId",
  "telegramBotUsername",
  "telegramValidatedAt",
  "telegramWebhookUrl",
  "telegramWebhookSetAt",
] as const;

/** `$unset` every telegram CRED field (never `telegramPaused`) — re-runnable. */
export async function clearTelegramCreds(): Promise<void> {
  await connectDB();
  const unset = Object.fromEntries(TELEGRAM_CRED_FIELDS.map((field) => [field, 1]));
  await Settings.findOneAndUpdate({}, { $unset: unset });
  invalidateTelegramConfigCache();
  invalidateSettingsCache();
}

export function invalidateTelegramConfigCache(): void {
  cache.del(TELEGRAM_CONFIG_CACHE_KEY);
}
