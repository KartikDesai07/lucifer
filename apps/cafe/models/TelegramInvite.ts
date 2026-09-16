import mongoose, { Schema, type Document, type Model } from "mongoose";

// CR2.3b (phase-CR2-public-ordering.md §21.2 #2 / §21.6c) — one single-use
// deep-link invite code an admin mints so a staff member's Telegram chat can
// connect itself via `/start <code>`. Deliberately NOT in the federated
// registry (mirrors models/TelegramChat.ts / models/OrderRequest.ts) — a
// plain default-bound CORE-cluster model, bounded to
// TELEGRAM_MAX_INVITES_LIVE live rows.
//
// Pruned LAZILY on mint — UNUSED-expired rows only (mirrors
// order-request-create.ts's pruneOrderRequests pattern). USED rows are
// retained deliberately: they are the replay-verdict source for a re-tapped
// deep link (lib/telegram/chats.ts's consumeInvite) and the label→chat audit
// trail — tiny and bounded, never a cleanup target.

export interface ITelegramInvite extends Document {
  // mintUniquePublicToken() output, 14 chars, alphabet ⊂ Telegram's own
  // A-Za-z0-9_- (lib/public-token.ts / packages/shared/src/public.ts).
  code: string;
  label: string; // staff-entered ("Kitchen phone"), sanitizePublicText'd at the write site
  expiresAt: Date;
  // No defaults (omit-empty) — a still-live invite carries neither key.
  usedAt?: Date;
  usedChatId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA (schemas-not-models, mirrors models/OrderRequest.ts) —
// this model is not registered anywhere federated today.
export const telegramInviteSchema = new Schema<ITelegramInvite>(
  {
    // unique:true creates the index — no separate index() call needed.
    code: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    usedChatId: { type: String },
  },
  { timestamps: true },
);

// NO TTL index: ttl-guard's default-deny (build-rule #23 / shared.md) allows
// exactly one registry TTL index platform-wide (Heartbeat — ttl-guard.ts).
// An expired, UNUSED invite is deleted lazily on the next mint (pruneInvites,
// lib/telegram/chats.ts) rather than via a TTL index, precisely so a USED row
// (needed for replay verdicts + the label→chat audit trail) is never at risk
// of an index sweep deleting it too. Unique code is the ONLY index this
// schema declares. This model is never walked by the registry's module-load
// TTL sweep (deliberately not federated — see the file header), so its own
// test pins `assertSchemaTtlAllowed` directly (lib/telegram-model.test.ts).

// Reuse the compiled model across hot reloads / serverless invocations.
export const TelegramInvite: Model<ITelegramInvite> =
  (mongoose.models.TelegramInvite as Model<ITelegramInvite>) ??
  mongoose.model<ITelegramInvite>("TelegramInvite", telegramInviteSchema);
