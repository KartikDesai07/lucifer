import { test } from "node:test";
import assert from "node:assert/strict";

import {
  telegramChatSchema,
  TelegramChat,
  TELEGRAM_CHAT_DEACTIVATED_REASONS,
} from "../models/TelegramChat";
import { telegramInviteSchema, TelegramInvite } from "../models/TelegramInvite";
import { assertSchemaTtlAllowed } from "./ttl-guard";

// CR2.3b S2 — DB-free schema/index shape tests for the two new Telegram
// registry collections (models/TelegramChat.ts, models/TelegramInvite.ts).
// No DB connection: every assertion reads the compiled schema's declared
// indexes/paths/enums, or validates a plain (unsaved) document instance —
// mirrors lib/order-request-model.test.ts's own pattern.

// ── TelegramChat ─────────────────────────────────────────────────────────

test("TelegramChat: schema.indexes() carries EXACTLY ONE index — the unique chatId", () => {
  const indexes = telegramChatSchema.indexes();
  assert.equal(indexes.length, 1, "no TTL/compound index besides the unique chatId");
  const [key, options] = indexes[0] as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(key.chatId, 1);
  assert.equal(options.unique, true);
});

test("TelegramChat: chatId path is required and unique", () => {
  const path = telegramChatSchema.path("chatId");
  assert.ok(path, "chatId path must exist");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.equal(options.unique, true);
  assert.equal(options.required, true);
});

test("TelegramChat: chatType enum rejects a value outside TELEGRAM_CHAT_TYPES", () => {
  const doc = new TelegramChat({
    chatId: "12345",
    chatType: "not-a-real-chat-type",
    title: "Kitchen phone",
    connectedAt: new Date(),
    types: ["newRequest"],
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown chatType");
  assert.ok(err?.errors.chatType, "expected the error to be on the chatType path");
});

test("TelegramChat: chatType accepts every TELEGRAM_CHAT_TYPES member", () => {
  for (const chatType of ["private", "group", "supergroup", "channel"] as const) {
    const doc = new TelegramChat({
      chatId: "12345",
      chatType,
      title: "Kitchen phone",
      connectedAt: new Date(),
      types: ["newRequest"],
    });
    const err = doc.validateSync();
    assert.equal(err, undefined, `chatType "${chatType}" must validate cleanly`);
  }
});

test("TelegramChat: deactivatedReason enum is exactly the 4 spec'd values", () => {
  assert.deepEqual(
    [...TELEGRAM_CHAT_DEACTIVATED_REASONS],
    ["blocked", "not_found", "removed", "migrated"],
  );
  const path = telegramChatSchema.path("deactivatedReason");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.deepEqual(options.enum, ["blocked", "not_found", "removed", "migrated"]);
});

test("TelegramChat: deactivatedReason rejects a value outside the 4-member enum", () => {
  const doc = new TelegramChat({
    chatId: "12345",
    chatType: "private",
    title: "Kitchen phone",
    connectedAt: new Date(),
    types: ["newRequest"],
    deactivatedReason: "left",
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown deactivatedReason");
  assert.ok(err?.errors.deactivatedReason);
});

test("TelegramChat: required paths (chatId, chatType, title, connectedAt) fail together when absent", () => {
  const doc = new TelegramChat({});
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error");
  assert.ok(err?.errors.chatId);
  assert.ok(err?.errors.chatType);
  assert.ok(err?.errors.title);
  assert.ok(err?.errors.connectedAt);
});

test("TelegramChat: types path is declared required:true on the schema (§21.6c exact shape)", () => {
  // Not asserted via validateSync() above: Mongoose auto-vivifies an
  // undefined array path to `[]` before required-ness is checked, so an
  // omitted `types` never actually raises a validation error — a known
  // Mongoose array-default quirk, not a bug in this schema. The spec's exact
  // shape (`{ type: [String], required: true }`) is still honored and
  // checked here at the schema-option level.
  const path = telegramChatSchema.path("types");
  assert.ok(path, "types path must exist");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.equal(options.required, true);
});

test("TelegramChat: active defaults true; optional error/deactivation fields are absent on a minimal doc", () => {
  const doc = new TelegramChat({
    chatId: "12345",
    chatType: "private",
    title: "Kitchen phone",
    connectedAt: new Date(),
    types: ["newRequest"],
  });
  assert.equal(doc.active, true);
  assert.equal(doc.lastSendAt, undefined);
  assert.equal(doc.lastErrorAt, undefined);
  assert.equal(doc.lastErrorCode, undefined);
  assert.equal(doc.deactivatedReason, undefined);
});

test("assertSchemaTtlAllowed(TelegramChat) does not throw — no TTL index declared", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("TelegramChat", telegramChatSchema));
});

// ── TelegramInvite ───────────────────────────────────────────────────────

test("TelegramInvite: schema.indexes() carries EXACTLY ONE index — the unique code", () => {
  const indexes = telegramInviteSchema.indexes();
  assert.equal(indexes.length, 1, "no TTL/compound index besides the unique code");
  const [key, options] = indexes[0] as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(key.code, 1);
  assert.equal(options.unique, true);
});

test("TelegramInvite: code path is required and unique", () => {
  const path = telegramInviteSchema.path("code");
  assert.ok(path, "code path must exist");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.equal(options.unique, true);
  assert.equal(options.required, true);
});

test("TelegramInvite: required paths (code, label, expiresAt) fail together when absent", () => {
  const doc = new TelegramInvite({});
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error");
  assert.ok(err?.errors.code);
  assert.ok(err?.errors.label);
  assert.ok(err?.errors.expiresAt);
});

test("TelegramInvite: usedAt/usedChatId are absent on a minimal unused invite (omit-empty)", () => {
  const doc = new TelegramInvite({
    code: "AbCdEfGhIjKlMn",
    label: "Kitchen phone",
    expiresAt: new Date(),
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a minimal doc must validate cleanly");
  assert.equal(doc.usedAt, undefined);
  assert.equal(doc.usedChatId, undefined);
});

test("assertSchemaTtlAllowed(TelegramInvite) does not throw — no TTL index declared", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("TelegramInvite", telegramInviteSchema));
});
