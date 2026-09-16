import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveChatTitle,
  dispatchUpdate,
  parseStartPayload,
  verifySecretHeader,
  type TelegramUpdate,
  type WebhookPorts,
} from "./webhook-core";

// CR2.3b §21.4 S5 — pure dispatch core tests over FAKE ports. No Mongoose, no
// fetch, no env — this suite must run standalone via
// `node --import tsx --test lib/telegram/webhook-core.test.ts`.

// ── verifySecretHeader ───────────────────────────────────────────────────────

test("verifySecretHeader: matching header/secret returns true", () => {
  assert.equal(verifySecretHeader("shh-secret", "shh-secret"), true);
});

test("verifySecretHeader: mismatched same-length header returns false", () => {
  assert.equal(verifySecretHeader("shh-secreX", "shh-secret"), false);
});

test("verifySecretHeader: different-length header returns false (no throw)", () => {
  assert.equal(verifySecretHeader("short", "a-much-longer-secret"), false);
});

test("verifySecretHeader: null or empty header/secret returns false, never throws", () => {
  assert.equal(verifySecretHeader(null, "secret"), false);
  assert.equal(verifySecretHeader("", "secret"), false);
  assert.equal(verifySecretHeader("secret", ""), false);
  assert.doesNotThrow(() => verifySecretHeader("x".repeat(5000), "y".repeat(3)));
});

// ── parseStartPayload ────────────────────────────────────────────────────────

test("parseStartPayload: plain /start <code> form", () => {
  assert.equal(parseStartPayload("/start ABC123_-xyz"), "ABC123_-xyz");
});

test("parseStartPayload: group /start@bot <code> form", () => {
  assert.equal(parseStartPayload("/start@my_cafe_bot ABC123"), "ABC123");
});

test("parseStartPayload: bare /start (no payload) returns empty string, not null", () => {
  assert.equal(parseStartPayload("/start"), "");
  assert.equal(parseStartPayload("/start@my_cafe_bot"), "");
});

test("parseStartPayload: junk text returns null", () => {
  assert.equal(parseStartPayload("hello"), null);
  assert.equal(parseStartPayload(undefined), null);
});

test("parseStartPayload: payload over TELEGRAM_START_PAYLOAD_MAX returns null", () => {
  assert.equal(parseStartPayload(`/start ${"a".repeat(65)}`), null);
  assert.equal(parseStartPayload(`/start ${"a".repeat(64)}`), "a".repeat(64));
});

test("parseStartPayload: bad-charset payload returns null", () => {
  assert.equal(parseStartPayload("/start abc!def"), null);
  assert.equal(parseStartPayload("/start abc.def"), null);
});

test("parseStartPayload: two payload tokens returns null", () => {
  assert.equal(parseStartPayload("/start abc def"), null);
});

// ── deriveChatTitle ──────────────────────────────────────────────────────────

test("deriveChatTitle: title wins when present (group/supergroup/channel)", () => {
  assert.equal(
    deriveChatTitle({ id: 1, type: "group", title: "Kitchen phone" }),
    "Kitchen phone",
  );
});

test("deriveChatTitle: falls back to first+last name when no title (private chat)", () => {
  assert.equal(
    deriveChatTitle({ id: 2, type: "private", first_name: "Asha", last_name: "Rao" }),
    "Asha Rao",
  );
  assert.equal(deriveChatTitle({ id: 3, type: "private", first_name: "Asha" }), "Asha");
});

test("deriveChatTitle: falls back to username when no title or name", () => {
  assert.equal(deriveChatTitle({ id: 4, type: "private", username: "ashar" }), "ashar");
});

test("deriveChatTitle: falls back to the numeric id when nothing else present", () => {
  assert.equal(deriveChatTitle({ id: 5, type: "private" }), "5");
});

// ── dispatchUpdate ───────────────────────────────────────────────────────────

function fakePorts(overrides: Partial<WebhookPorts> = {}): WebhookPorts & {
  connectCalls: Array<[string, { chatId: string; chatType: string; title: string }]>;
  rewriteCalls: Array<[string, string]>;
} {
  const connectCalls: Array<[string, { chatId: string; chatType: string; title: string }]> = [];
  const rewriteCalls: Array<[string, string]> = [];
  return {
    connectCalls,
    rewriteCalls,
    async connect(code, chat) {
      connectCalls.push([code, chat]);
      return overrides.connect ? overrides.connect(code, chat) : "connected";
    },
    async rewrite(oldId, newId) {
      rewriteCalls.push([oldId, newId]);
      return overrides.rewrite ? overrides.rewrite(oldId, newId) : "rewritten";
    },
  };
}

const REPLY_CONNECTED = "Connected. You will get order alerts in this chat.";
const REPLY_USED =
  "This invite link was already used on another chat. Ask for a new invite from the panel.";
const REPLY_EXPIRED = "This invite link has expired. Ask for a new invite from the panel.";
const REPLY_UNKNOWN = "This invite link is not valid. Ask for a new invite from the panel.";
const REPLY_CAP =
  "The connected-chat limit is reached. Remove a chat in the panel, then try a new invite.";
const REPLY_GUIDE = "Open this chat from the invite link in your cafe panel to connect it.";

function updateWithText(text: string, chatOverrides: Record<string, unknown> = {}): TelegramUpdate {
  return {
    message: { chat: { id: 42, type: "private", ...chatOverrides }, text },
  } as TelegramUpdate;
}

test("dispatchUpdate: migrate_to_chat_id calls rewrite with STRINGIFIED ids", async () => {
  const ports = fakePorts();
  const update = {
    message: { chat: { id: 100, type: "group" }, migrate_to_chat_id: 200 },
  } as TelegramUpdate;
  const result = await dispatchUpdate(update, ports);
  assert.deepEqual(ports.rewriteCalls, [["100", "200"]]);
  assert.equal(result.effect, "migrated");
  assert.equal(result.reply, undefined);
});

test("dispatchUpdate: valid code maps EVERY connect verdict to its exact reply, using derived title + stringified chatId", async () => {
  const verdictToReply: Record<string, string> = {
    connected: REPLY_CONNECTED,
    replay: REPLY_CONNECTED,
    used: REPLY_USED,
    expired: REPLY_EXPIRED,
    unknown: REPLY_UNKNOWN,
    cap: REPLY_CAP,
  };
  for (const [verdict, expectedReply] of Object.entries(verdictToReply)) {
    const ports = fakePorts({ connect: async () => verdict as never });
    const update = updateWithText("/start GOODCODE123", { title: "Kitchen phone" });
    const result = await dispatchUpdate(update, ports);
    assert.deepEqual(ports.connectCalls, [
      ["GOODCODE123", { chatId: "42", chatType: "private", title: "Kitchen phone" }],
    ]);
    assert.equal(result.reply?.text, expectedReply);
    assert.equal(result.reply?.chatId, 42);
  }
});

test("dispatchUpdate: replay gets the SAME reply as connected (no oracle)", async () => {
  const connected = await dispatchUpdate(
    updateWithText("/start GOODCODE123"),
    fakePorts({ connect: async () => "connected" }),
  );
  const replay = await dispatchUpdate(
    updateWithText("/start GOODCODE123"),
    fakePorts({ connect: async () => "replay" }),
  );
  assert.equal(connected.reply?.text, replay.reply?.text);
});

test("dispatchUpdate: bare /start replies with the guide text and calls no port", async () => {
  const ports = fakePorts();
  const result = await dispatchUpdate(updateWithText("/start"), ports);
  assert.equal(result.effect, "guide");
  assert.equal(result.reply?.text, REPLY_GUIDE);
  assert.equal(ports.connectCalls.length, 0);
  assert.equal(ports.rewriteCalls.length, 0);
});

test("dispatchUpdate: unknown chat type is ignored, connect never called", async () => {
  const ports = fakePorts();
  const update = updateWithText("/start GOODCODE123", { type: "bot" });
  const result = await dispatchUpdate(update, ports);
  assert.equal(result.effect, "ignored");
  assert.equal(result.reply, undefined);
  assert.equal(ports.connectCalls.length, 0);
});

test("dispatchUpdate: non-message update is ignored", async () => {
  const ports = fakePorts();
  const result = await dispatchUpdate({ update_id: 1 } as TelegramUpdate, ports);
  assert.equal(result.effect, "ignored");
  assert.equal(result.reply, undefined);
});

test("dispatchUpdate: ports.connect throwing degrades to ignored, no reply, never throws", async () => {
  const ports = fakePorts({
    connect: async () => {
      throw new Error("boom");
    },
  });
  await assert.doesNotReject(async () => {
    const result = await dispatchUpdate(updateWithText("/start GOODCODE123"), ports);
    assert.equal(result.effect, "ignored");
    assert.equal(result.reply, undefined);
  });
});
