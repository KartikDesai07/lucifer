import mongoose, { Schema, type Document, type Model } from "mongoose";
import { TELEGRAM_CHAT_TYPES, type TelegramChatType } from "@pos/shared/telegram-alert";

// CR2.3b (phase-CR2-public-ordering.md §21.2 #2 / §21.6c) — one row per
// Telegram chat (private DM or group/channel) currently registered to
// receive fan-out alerts. Deliberately NOT in the federated registry
// (mirrors models/OrderRequest.ts / models/PromoRedemption.ts, for the same
// reason) — a plain default-bound CORE-cluster model. Rows are tiny and
// bounded (≤ TELEGRAM_MAX_CHATS, packages/shared/src/telegram-alert.ts), so
// none of the ledger's paise/sharding discipline applies here.

export const TELEGRAM_CHAT_DEACTIVATED_REASONS = [
  "blocked",
  "not_found",
  "removed",
  "migrated",
] as const;
export type TelegramChatDeactivatedReason = (typeof TELEGRAM_CHAT_DEACTIVATED_REASONS)[number];

export interface ITelegramChat extends Document {
  // Telegram chat ids can exceed Number.MAX_SAFE_INTEGER for supergroups —
  // stored as a STRING, never a Number, to avoid silent precision loss.
  chatId: string;
  chatType: TelegramChatType;
  // OUR display-name field, derived at dispatch time (lib/telegram/chats.ts),
  // never Telegram's own `chat.title`: chat.title ?? [first_name, last_name]
  // ?? username ?? String(chat.id) — always non-empty (a private chat
  // carries no `title` field from Telegram at all). Escaped at SEND time
  // (lib/telegram/format.ts), never at storage — this column holds the raw
  // display text.
  title: string;
  active: boolean;
  // TelegramAlertType[] — validated through normalizeAlertTypes
  // (packages/shared/src/telegram-alert.ts) at every WRITE site, not by this
  // schema (mirrors OrderRequest's own unchecked embedded string arrays).
  types: string[];
  connectedAt: Date;
  // No defaults on the fields below (omit-empty) — a chat that has never
  // failed a send carries none of them.
  lastSendAt?: Date;
  lastErrorAt?: Date;
  lastErrorCode?: number; // Telegram's numeric error_code — never a description string
  deactivatedReason?: TelegramChatDeactivatedReason;
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA (schemas-not-models, mirrors models/OrderRequest.ts) —
// this model is not registered anywhere federated today.
export const telegramChatSchema = new Schema<ITelegramChat>(
  {
    // unique:true creates the index — no separate index() call needed.
    chatId: { type: String, required: true, unique: true },
    chatType: { type: String, enum: [...TELEGRAM_CHAT_TYPES], required: true },
    title: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    types: { type: [String], required: true },
    connectedAt: { type: Date, required: true },
    lastSendAt: { type: Date },
    lastErrorAt: { type: Date },
    lastErrorCode: { type: Number },
    deactivatedReason: { type: String, enum: [...TELEGRAM_CHAT_DEACTIVATED_REASONS] },
  },
  { timestamps: true },
);

// NO TTL index: ttl-guard's default-deny (build-rule #23 / shared.md) allows
// exactly one registry TTL index platform-wide (Heartbeat) — a chat row is
// retained until an admin removes it. Unique chatId is the ONLY index this
// schema declares. This model is never walked by the registry's module-load
// TTL sweep (deliberately not federated — see the file header), so its own
// test pins `assertSchemaTtlAllowed` directly (lib/telegram-model.test.ts).

// Reuse the compiled model across hot reloads / serverless invocations.
export const TelegramChat: Model<ITelegramChat> =
  (mongoose.models.TelegramChat as Model<ITelegramChat>) ??
  mongoose.model<ITelegramChat>("TelegramChat", telegramChatSchema);
