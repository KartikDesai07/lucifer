import { z } from "zod";
import { TELEGRAM_SEND_TIMEOUT_MS } from "@pos/shared/telegram-alert";

// CR2.3b S3 — the Bot API port. A thin, pure-`fetch` wrapper around
// https://api.telegram.org/bot<token>/<method> — nothing here reads DB/env,
// nothing here logs, and the token is interpolated into the URL ONLY (never
// echoed back in a return value or thrown error). §21.8: ~150 lines.
//
// Deliberately DROPS Telegram's `description` field from every result: that
// string can echo request content (e.g. "chat not found: <id>") back at a
// caller, and every decision this port's consumers make (§21.4 S4 send
// rules — 429 retry, 403 deactivate, migrate rewrite) is keyed on NUMERIC
// fields only (`error_code`, `parameters.*`). Keeping `description` out of
// the return type makes token/PII leakage into a log line structurally
// impossible rather than merely "not currently logged".

/** Real Telegram `error_code`s are HTTP-status-shaped (400s/403/404/429/5xx)
 *  and never 0 — this is OUR sentinel for "we never got a real Telegram
 *  response to classify" (network/timeout/abort/non-JSON/malformed-envelope). */
export const TELEGRAM_TRANSPORT_ERROR = 0;

export type TelegramResult =
  | { ok: true; result: unknown }
  | { ok: false; errorCode: number; retryAfterSec?: number; migrateToChatId?: string };

export interface TelegramSetWebhookParams {
  url: string;
  secretToken: string;
  allowedUpdates: readonly string[];
  dropPendingUpdates?: boolean;
}

export interface TelegramSendMessageParams {
  chatId: string;
  text: string;
  parseMode?: "HTML";
}

export interface TelegramPort {
  getMe(): Promise<TelegramResult>;
  setWebhook(params: TelegramSetWebhookParams): Promise<TelegramResult>;
  deleteWebhook(): Promise<TelegramResult>;
  getWebhookInfo(): Promise<TelegramResult>;
  sendMessage(params: TelegramSendMessageParams): Promise<TelegramResult>;
}

// Minimal envelope shape we ever look at. `result` is intentionally
// `z.unknown()` (callers that need it, e.g. getMe's username, parse it
// further themselves) and `description` is NEVER given a field here — see
// the file header. Anything that doesn't fit this shape is junk ⇒ transport
// error, never a thrown parse exception.
const telegramEnvelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().optional(),
  parameters: z
    .object({
      retry_after: z.number().optional(),
      // Arrives as a JSON number, but Telegram chat ids need up to 52 bits —
      // never keep it as a JS number in OUR domain past this boundary.
      migrate_to_chat_id: z.number().optional(),
    })
    .optional(),
});

async function callTelegramApi(token: string, method: string, body: Record<string, unknown>): Promise<TelegramResult> {
  let raw: unknown;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_SEND_TIMEOUT_MS),
    });
    raw = await response.json();
  } catch {
    // Network failure, non-2xx that still throws on .json() being called on
    // a body-less response, timeout/abort — all collapse to one sentinel.
    return { ok: false, errorCode: TELEGRAM_TRANSPORT_ERROR };
  }

  const parsed = telegramEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errorCode: TELEGRAM_TRANSPORT_ERROR };
  const envelope = parsed.data;

  if (envelope.ok) return { ok: true, result: envelope.result ?? null };

  const retryAfterSec = envelope.parameters?.retry_after;
  const migrateToChatIdRaw = envelope.parameters?.migrate_to_chat_id;
  return {
    ok: false,
    errorCode: envelope.error_code ?? TELEGRAM_TRANSPORT_ERROR,
    ...(typeof retryAfterSec === "number" ? { retryAfterSec } : {}),
    ...(typeof migrateToChatIdRaw === "number" ? { migrateToChatId: String(migrateToChatIdRaw) } : {}),
  };
}

/** Builds a `TelegramPort` bound to one bot token. Never throws — every
 *  branch above collapses transport/parse failures into a `TelegramResult`,
 *  never an exception, so a caller never needs a try/catch around a send. */
export function createTelegramPort(token: string): TelegramPort {
  return {
    getMe: () => callTelegramApi(token, "getMe", {}),
    setWebhook: (params) =>
      callTelegramApi(token, "setWebhook", {
        url: params.url,
        secret_token: params.secretToken,
        allowed_updates: params.allowedUpdates,
        drop_pending_updates: params.dropPendingUpdates,
      }),
    deleteWebhook: () => callTelegramApi(token, "deleteWebhook", {}),
    getWebhookInfo: () => callTelegramApi(token, "getWebhookInfo", {}),
    sendMessage: (params) =>
      callTelegramApi(token, "sendMessage", {
        chat_id: params.chatId,
        text: params.text,
        parse_mode: params.parseMode,
      }),
  };
}
