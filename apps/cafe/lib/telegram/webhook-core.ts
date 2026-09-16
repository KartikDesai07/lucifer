import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { TELEGRAM_CHAT_TYPES, TELEGRAM_START_PAYLOAD_MAX } from "@pos/shared/telegram-alert";

// CR2.3b §21.4 S5 — the PURE dispatch core for POST /api/telegram/webhook.
// Zero Mongoose/fetch/env imports: every side effect (invite consume, chat
// upsert, chat-id rewrite) is injected via `WebhookPorts` so this file (and
// its test) never touch a DB. The route (app/api/telegram/webhook/route.ts)
// is the only caller and owns everything DB/env-shaped — header check, host
// gate, config read, body cap, rate limit, response shape.

// ── Wire shape (minimal-permissive: unknown keys pass through, Telegram's
// update object carries many fields this app never reads) ──────────────────
const telegramChatSchema = z
  .object({
    id: z.number(),
    type: z.string(),
    title: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
  })
  .passthrough();

const telegramMessageSchema = z
  .object({
    chat: telegramChatSchema,
    text: z.string().optional(),
    migrate_to_chat_id: z.number().optional(),
  })
  .passthrough();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().optional(),
    message: telegramMessageSchema.optional(),
  })
  .passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramUpdateChat = z.infer<typeof telegramChatSchema>;

// ── Secret header compare ────────────────────────────────────────────────────
// Length-guarded BEFORE timingSafeEqual — it throws (not returns false) on a
// length mismatch, and a leaked stack/exception here must never happen on an
// unauthenticated path. Never throws.
export function verifySecretHeader(header: string | null, expected: string): boolean {
  if (!header || !expected) return false;
  try {
    const headerBuf = Buffer.from(header, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (headerBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(headerBuf, expectedBuf);
  } catch {
    return false;
  }
}

// ── /start payload parsing ──────────────────────────────────────────────────
// Accepts `/start <code>` and the group form `/start@<bot> <code>`. A bare
// `/start` (no payload) returns "" — distinct from null (junk/invalid), so
// the route can reply with the guide text instead of ignoring the message.
const START_COMMAND_PATTERN = /^\/start(?:@\S+)?(?:\s+(\S.*))?$/;
const START_PAYLOAD_CHARSET = /^[A-Za-z0-9_-]+$/;

export function parseStartPayload(text: string | undefined): string | null {
  if (typeof text !== "string") return null;
  const match = START_COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;

  const rest = match[1];
  if (rest === undefined) return ""; // bare /start (or /start@bot with no payload)

  // Exactly one payload token — "/start abc def" is junk, not a payload.
  const tokens = rest.trim().split(/\s+/);
  if (tokens.length !== 1) return null;

  const payload = tokens[0];
  if (payload.length < 1 || payload.length > TELEGRAM_START_PAYLOAD_MAX) return null;
  if (!START_PAYLOAD_CHARSET.test(payload)) return null;
  return payload;
}

// ── Display-name derivation (models/TelegramChat.ts's `title` field) ────────
// First non-empty wins: our own title ?? first+last name ?? username ?? the
// numeric id as a string (always non-empty — private chats carry no title).
export function deriveChatTitle(chat: TelegramUpdateChat): string {
  if (chat.title) return chat.title;
  const fullName = [chat.first_name, chat.last_name].filter((part) => !!part).join(" ");
  if (fullName) return fullName;
  if (chat.username) return chat.username;
  return String(chat.id);
}

// ── Injected side effects ────────────────────────────────────────────────────
// Deliberately the SAME return union as chats.ts's ConnectChatVerdict /
// ChatStore["rewriteChatId"] — the route wires these directly to
// `connectChat` / `mongooseChatStore.rewriteChatId`, no verdict remapping.
export interface WebhookPorts {
  connect(
    code: string,
    chat: { chatId: string; chatType: string; title: string },
  ): Promise<"connected" | "replay" | "used" | "expired" | "unknown" | "cap">;
  rewrite(oldId: string, newId: string): Promise<"rewritten" | "collision" | "unknown">;
}

export interface DispatchResult {
  reply?: { chatId: number; text: string };
  effect: string;
}

// White-label reply text (§21.4 S5) — never a cafe name, never dynamic
// content, plain text (no HTML needed). "replay" gets the SAME text as
// "connected" — a re-tapped deep link must not read as an oracle telling a
// caller their code was already consumed by someone else.
const REPLY_GUIDE = "Open this chat from the invite link in your cafe panel to connect it.";
const CONNECT_REPLY: Record<
  "connected" | "replay" | "used" | "expired" | "unknown" | "cap",
  string
> = {
  connected: "Connected. You will get order alerts in this chat.",
  replay: "Connected. You will get order alerts in this chat.",
  used: "This invite link was already used on another chat. Ask for a new invite from the panel.",
  expired: "This invite link has expired. Ask for a new invite from the panel.",
  unknown: "This invite link is not valid. Ask for a new invite from the panel.",
  cap: "The connected-chat limit is reached. Remove a chat in the panel, then try a new invite.",
};

const CHAT_TYPES: readonly string[] = TELEGRAM_CHAT_TYPES;

// Pure dispatch: never throws (ports failures are caught and degrade to
// `{effect: "ignored"}`, no reply) — a transient DB blip must not surface as
// an uncaught error on an unauthenticated path. Dispatch is migrate-first BY
// DESIGN: a migrate service message never carries a /start payload in
// practice, so the order below (migrate, then a parsed `/start` code, then
// bare `/start`, else ignore) never actually competes for the same update —
// if both somehow appeared, migrate wins and the connect is simply retried
// by the user.
export async function dispatchUpdate(
  update: TelegramUpdate,
  ports: WebhookPorts,
): Promise<DispatchResult> {
  const message = update.message;
  if (!message) return { effect: "ignored" };
  const chat = message.chat;

  if (message.migrate_to_chat_id !== undefined) {
    try {
      const verdict = await ports.rewrite(String(chat.id), String(message.migrate_to_chat_id));
      if (verdict === "rewritten") return { effect: "migrated" };
      if (verdict === "collision") return { effect: "migrate-collision" };
      return { effect: "ignored" };
    } catch {
      return { effect: "ignored" };
    }
  }

  const payload = parseStartPayload(message.text);
  if (payload === null) return { effect: "ignored" };

  if (payload === "") {
    return { reply: { chatId: chat.id, text: REPLY_GUIDE }, effect: "guide" };
  }

  if (!CHAT_TYPES.includes(chat.type)) return { effect: "ignored" };

  try {
    const verdict = await ports.connect(payload, {
      chatId: String(chat.id),
      chatType: chat.type,
      title: deriveChatTitle(chat),
    });
    return { reply: { chatId: chat.id, text: CONNECT_REPLY[verdict] }, effect: verdict };
  } catch {
    return { effect: "ignored" };
  }
}
