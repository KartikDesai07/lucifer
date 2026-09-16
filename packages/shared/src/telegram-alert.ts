// ─────────────────────────────────────────────────────────────────────────────
// CR2.3b — the Telegram alert-type CONTRACT, single-homed here (#31) because
// three separate runtimes must agree on it without importing each other:
//   • the cafe server's fan-out (lib/telegram/notify.ts) decides which chats
//     get a given event;
//   • the webhook (app/api/telegram/webhook/route.ts) writes/reads a chat's
//     `types` array on connect/reconnect;
//   • the admin UI (Settings → Telegram tab) renders the toggle list and
//     calls the same normalizer before it PATCHes a chat.
// This module is PURE and client-safe (PURE JS/TS only — zero imports, no
// Node/DB APIs) — the same predicates run identically wherever each of those
// mounts.
// ─────────────────────────────────────────────────────────────────────────────

/** The three events a chat can be alerted on. Order here IS the canonical
 *  registry order — `normalizeAlertTypes` restores it regardless of input
 *  order, and the admin UI renders toggles in this order. */
export const TELEGRAM_ALERT_TYPES = ["newRequest", "autoAccepted", "editedRequest"] as const;
export type TelegramAlertType = (typeof TELEGRAM_ALERT_TYPES)[number];

export interface TelegramAlertTypeMeta {
  type: TelegramAlertType;
  label: string; // admin toggle label
  description: string; // one line under the toggle
  defaultOn: boolean; // seeded onto a NEWLY connected chat
}

/** `editedRequest` defaults OFF (§21.0.1): a diner's PATCH to their own still-
 *  pending request makes the tray card staff already saw stale, but it is a
 *  lower-urgency event than a brand-new order — default-OFF bounds send
 *  volume without hiding the capability from a cafe that wants it. */
export const TELEGRAM_ALERT_REGISTRY: readonly TelegramAlertTypeMeta[] = [
  {
    type: "newRequest",
    label: "New QR order to approve",
    description: "A diner placed an order that is waiting for staff to accept.",
    defaultOn: true,
  },
  {
    type: "autoAccepted",
    label: "Auto-accepted QR order",
    description: "Auto mode accepted a diner's order and created the bill without staff action.",
    defaultOn: true,
  },
  {
    type: "editedRequest",
    label: "Diner changed a waiting order",
    description: "A diner edited an order that has not been accepted yet, so the card staff saw is stale.",
    defaultOn: false,
  },
];

/** The default toggle set seeded onto a newly-connected chat — registry
 *  order, a fresh array on every call (the caller may mutate its result). */
export function defaultAlertTypes(): TelegramAlertType[] {
  return TELEGRAM_ALERT_REGISTRY.filter((meta) => meta.defaultOn).map((meta) => meta.type);
}

/** Type guard for one raw value. Deliberately an array `.includes()`, never
 *  an object-keyed lookup — a string like "constructor" or "__proto__" must
 *  fail this the same as any other non-member (object-literal allow-list
 *  hazard). */
export function isTelegramAlertType(v: unknown): v is TelegramAlertType {
  return typeof v === "string" && (TELEGRAM_ALERT_TYPES as readonly string[]).includes(v);
}

/** Normalizes a raw (wire/DB) value into a de-duped, registry-ordered list of
 *  known alert types. Anything that isn't an array becomes `[]`; any member
 *  that isn't a known type (wrong case, junk string, object, number, null) is
 *  dropped rather than trusted — members are validated by VALUE via
 *  `isTelegramAlertType`, never treated as object keys. */
export function normalizeAlertTypes(v: unknown): TelegramAlertType[] {
  if (!Array.isArray(v)) return [];
  const present = new Set<TelegramAlertType>();
  for (const entry of v) {
    if (isTelegramAlertType(entry)) present.add(entry);
  }
  return TELEGRAM_ALERT_REGISTRY.filter((meta) => present.has(meta.type)).map((meta) => meta.type);
}

/** The subset of a `TelegramChat` row this module's predicates need. `types`
 *  is `readonly string[]` (not `TelegramAlertType[]`) because the row comes
 *  off the wire/DB unvalidated — `shouldSendToChat` normalizes it itself. */
export interface TelegramChatToggles {
  active: boolean;
  types: readonly string[];
}

/** Whether a given event should fan out to this chat. Strict `=== true` on
 *  `active` (never truthiness) — a chat row's `active` field is a real
 *  boolean once it round-trips through Mongoose, but this predicate must not
 *  start trusting a truthy non-boolean if a caller ever passes raw JSON. */
export function shouldSendToChat(chat: TelegramChatToggles, type: TelegramAlertType): boolean {
  return chat.active === true && normalizeAlertTypes(chat.types).includes(type);
}

/** The Telegram deep-link a staff member taps to connect a chat. Both
 *  operands are charset-bounded by their own minters/validators before this
 *  is ever called (a bot username by Telegram itself, an invite code by
 *  `mintUniquePublicToken`) — this function stays dumb and pure, no
 *  encoding, no rewriting. Charset enforcement is the caller's job. */
export function telegramDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

// ── Webhook wire constants ──────────────────────────────────────────────────
/** Header Telegram sends on every webhook POST carrying the secret token we
 *  gave `setWebhook` — compared against the sealed, per-cafe stored value. */
export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
/** We only ever handle `/start` text — no inline buttons, no callbacks, no
 *  channel posts. Narrowing this at `setWebhook` time means Telegram never
 *  bothers sending update types we'd just ignore. */
export const TELEGRAM_ALLOWED_UPDATES = ["message"] as const;
/** The `chat.type` values Telegram can hand back on any update. */
export const TELEGRAM_CHAT_TYPES = ["private", "group", "supergroup", "channel"] as const;
export type TelegramChatType = (typeof TELEGRAM_CHAT_TYPES)[number];

// ── Message content bounds (§21.6d) ─────────────────────────────────────────
export const TELEGRAM_TEXT_MAX = 4096;
export const TELEGRAM_SUMMARY_ITEMS_MAX = 6; // items-preview lines per message
export const TELEGRAM_FIELD_NAME_MAX = 64; // diner name, raw-truncated BEFORE escaping
export const TELEGRAM_FIELD_ITEM_MAX = 48; // one items-preview line
export const TELEGRAM_FIELD_NOTE_MAX = 160; // diner note
export const TELEGRAM_START_PAYLOAD_MAX = 64;

// ── Webhook body/rate bounds ─────────────────────────────────────────────────
export const TELEGRAM_WEBHOOK_BODY_MAX_BYTES = 64 * 1024;
export const TELEGRAM_WEBHOOK_RATE_MAX_CHAT = 20; // per PUBLIC_ORDER_RATE_WINDOW_MS (10 min)
export const TELEGRAM_WEBHOOK_RATE_MAX_GLOBAL = 300;

// ── Registry sizing ──────────────────────────────────────────────────────────
export const TELEGRAM_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const TELEGRAM_MAX_CHATS = 20;
export const TELEGRAM_MAX_INVITES_LIVE = 10;

// ── Send behavior ────────────────────────────────────────────────────────────
export const TELEGRAM_SEND_TIMEOUT_MS = 4_000;
export const TELEGRAM_RETRY_AFTER_MAX_SEC = 5;
export const TELEGRAM_FANOUT_BUDGET_MS = 20_000;
