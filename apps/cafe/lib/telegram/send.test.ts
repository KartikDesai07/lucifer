import { test } from "node:test";
import assert from "node:assert/strict";
import { fanOutToChats, type FanOutDeps } from "./send";
import type { TelegramChatRow, ChatStore } from "./chats";
import { TELEGRAM_TRANSPORT_ERROR, type TelegramPort, type TelegramResult, type TelegramSendMessageParams } from "./api";
import type { TelegramRequestSummary } from "./format";
import { TELEGRAM_RETRY_AFTER_MAX_SEC } from "@pos/shared/telegram-alert";

// CR2.3b S4 — DB-free, fetch-free fan-out tests. Every dependency is a fake:
// no Mongoose import (chats.ts's real store is never touched) and no real
// `fetch` (api.ts's real port is never touched). Fakes never real-sleep.

function buildRow(overrides: Partial<TelegramChatRow> = {}): TelegramChatRow {
  return {
    chatId: "100", chatType: "private", title: "Staff", active: true,
    types: ["newRequest"], connectedAt: new Date(0), ...overrides,
  };
}

function buildSummary(): TelegramRequestSummary {
  return {
    type: "newRequest", shortCode: "ABC123", targetKind: "table", tableNo: "5",
    name: "Diner", itemCount: 1, itemsPreview: ["1× Tea"], total: 100,
  };
}

interface FakeStore extends ChatStore {
  rows: TelegramChatRow[];
  sendCalls: string[];
  errorCalls: Array<{ chatId: string; code: number }>;
  deactivateCalls: Array<{ chatId: string; reason: "blocked" | "migrated" }>;
  rewriteCalls: Array<{ oldId: string; newId: string }>;
  rewriteVerdict: "rewritten" | "collision" | "unknown";
}

function createFakeStore(rows: TelegramChatRow[]): FakeStore {
  const store: FakeStore = {
    rows,
    sendCalls: [],
    errorCalls: [],
    deactivateCalls: [],
    rewriteCalls: [],
    rewriteVerdict: "rewritten",
    async listActive() {
      return store.rows;
    },
    async recordSend(chatId) {
      store.sendCalls.push(chatId);
    },
    async recordError(chatId, code) {
      store.errorCalls.push({ chatId, code });
    },
    async deactivate(chatId, reason) {
      store.deactivateCalls.push({ chatId, reason });
    },
    async rewriteChatId(oldId, newId) {
      store.rewriteCalls.push({ oldId, newId });
      return store.rewriteVerdict;
    },
  };
  return store;
}

interface FakePort {
  calls: Array<{ chatId: string; text: string }>;
  responses: TelegramResult[];
  sendMessage(params: TelegramSendMessageParams): Promise<TelegramResult>;
}

function createFakePort(responses: TelegramResult[]): FakePort {
  const port: FakePort = {
    calls: [],
    responses,
    async sendMessage(params) {
      port.calls.push({ chatId: params.chatId, text: params.text });
      return port.responses.shift() ?? { ok: true, result: null };
    },
  };
  return port;
}

// A fake `now`/`sleep` pair that never real-waits: `sleep` just advances the
// same clock `now` reads, and both record their call history.
function createDeps(
  store: ChatStore,
  port: Pick<TelegramPort, "sendMessage">,
): FanOutDeps & { sleepCalls: number[]; time: { value: number } } {
  const time = { value: 0 };
  const sleepCalls: number[] = [];
  return {
    port,
    store,
    now: () => time.value,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
      time.value += ms;
    },
    sleepCalls,
    time,
  };
}

const OK: TelegramResult = { ok: true, result: null };

test("toggle filter skips a chat BEFORE any port call", async () => {
  const store = createFakeStore([buildRow({ chatId: "1", types: ["editedRequest"] })]);
  const port = createFakePort([OK]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 0);
  assert.equal(result.skipped, 1);
});

test("an inactive row is filtered by the same toggle predicate, never reaching the port", async () => {
  const store = createFakeStore([buildRow({ chatId: "2", active: false })]);
  const port = createFakePort([OK]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 0);
  assert.equal(result.skipped, 1);
});

test("the message is rendered once and every targeted chat receives the identical text", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" }), buildRow({ chatId: "2" })]);
  const port = createFakePort([OK, OK]);
  const deps = createDeps(store, port);
  await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 2);
  assert.equal(port.calls[0].text, port.calls[1].text);
});

test("an ok send records the send and counts as sent", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const port = createFakePort([OK]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(result.sent, 1);
  assert.deepEqual(store.sendCalls, ["1"]);
});

test("403 deactivates the chat with reason 'blocked' and never retries", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const port = createFakePort([{ ok: false, errorCode: 403 }]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 1);
  assert.equal(result.deactivated, 1);
  assert.deepEqual(store.deactivateCalls, [{ chatId: "1", reason: "blocked" }]);
});

test("429 with a small retry_after retries EXACTLY once, then succeeds", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const port = createFakePort([{ ok: false, errorCode: 429, retryAfterSec: 2 }, OK]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 2);
  assert.deepEqual(deps.sleepCalls, [2000]);
  assert.equal(result.sent, 1);
});

test("429 with retryAfterSec over TELEGRAM_RETRY_AFTER_MAX_SEC never retries", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const tooLong = TELEGRAM_RETRY_AFTER_MAX_SEC + 1;
  const port = createFakePort([{ ok: false, errorCode: 429, retryAfterSec: tooLong }]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 1);
  assert.equal(deps.sleepCalls.length, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(store.errorCalls, [{ chatId: "1", code: 429 }]);
});

test("a second 429 after the one retry records the error and makes no third call", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const port = createFakePort([
    { ok: false, errorCode: 429, retryAfterSec: 1 },
    { ok: false, errorCode: 429, retryAfterSec: 1 },
  ]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(store.errorCalls, [{ chatId: "1", code: 429 }]);
});

test("a migrate result that resolves 'rewritten' resends exactly once to the NEW chat id", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  store.rewriteVerdict = "rewritten";
  const port = createFakePort([{ ok: false, errorCode: 400, migrateToChatId: "2" }, OK]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.deepEqual(store.rewriteCalls, [{ oldId: "1", newId: "2" }]);
  assert.equal(port.calls.length, 2);
  assert.equal(port.calls[1].chatId, "2");
  assert.equal(result.migrated, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(store.sendCalls, ["2"]);
});

test("a migrate result that resolves 'collision' never resends and counts as deactivated", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  store.rewriteVerdict = "collision";
  const port = createFakePort([{ ok: false, errorCode: 400, migrateToChatId: "2" }]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 1);
  assert.equal(result.deactivated, 1);
  assert.equal(result.migrated, 0);
});

test("budget exhaustion mid-list skips every remaining chat with zero port calls for them", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" }), buildRow({ chatId: "2" })]);
  const port = createFakePort([OK]);
  const deps = createDeps(store, port);
  // The first send jumps the clock straight past the budget window.
  const realSend = port.sendMessage.bind(port);
  port.sendMessage = async (params) => {
    deps.time.value += 999_999_999;
    return realSend(params);
  };
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(port.calls.length, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1);
});

test("a transport error (errorCode 0) records the error but leaves the chat active", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const port = createFakePort([{ ok: false, errorCode: TELEGRAM_TRANSPORT_ERROR }]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(result.failed, 1);
  assert.equal(store.deactivateCalls.length, 0);
  assert.deepEqual(store.errorCalls, [{ chatId: "1", code: TELEGRAM_TRANSPORT_ERROR }]);
});

test("a generic 400 records the error and does NOT deactivate the chat", async () => {
  const store = createFakeStore([buildRow({ chatId: "1" })]);
  const port = createFakePort([{ ok: false, errorCode: 400 }]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(result.failed, 1);
  assert.equal(store.deactivateCalls.length, 0);
  assert.deepEqual(store.errorCalls, [{ chatId: "1", code: 400 }]);
});

test("an empty active list produces an all-zero result and zero port calls", async () => {
  const store = createFakeStore([]);
  const port = createFakePort([]);
  const deps = createDeps(store, port);
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.deepEqual(result, { sent: 0, failed: 0, deactivated: 0, migrated: 0, skipped: 0 });
  assert.equal(port.calls.length, 0);
});

test("fanOutToChats never rejects even when every dependency throws", async () => {
  const throwingStore: ChatStore = {
    listActive: () => Promise.reject(new Error("boom")),
    recordSend: () => Promise.reject(new Error("boom")),
    recordError: () => Promise.reject(new Error("boom")),
    deactivate: () => Promise.reject(new Error("boom")),
    rewriteChatId: () => Promise.reject(new Error("boom")),
  };
  const throwingPort: Pick<TelegramPort, "sendMessage"> = {
    sendMessage: () => Promise.reject(new Error("boom")),
  };
  const deps: FanOutDeps = {
    port: throwingPort,
    store: throwingStore,
    now: () => 0,
    sleep: () => Promise.reject(new Error("boom")),
  };
  await assert.doesNotReject(() => fanOutToChats("newRequest", buildSummary(), deps));
});

test("fanOutToChats never rejects even when the store lists chats but every send-side dep throws", async () => {
  const store: ChatStore = {
    listActive: async () => [buildRow({ chatId: "1" })],
    recordSend: () => Promise.reject(new Error("boom")),
    recordError: () => Promise.reject(new Error("boom")),
    deactivate: () => Promise.reject(new Error("boom")),
    rewriteChatId: () => Promise.reject(new Error("boom")),
  };
  const port: Pick<TelegramPort, "sendMessage"> = {
    sendMessage: () => Promise.reject(new Error("boom")),
  };
  const deps: FanOutDeps = { port, store, now: () => 0, sleep: async () => {} };
  const result = await fanOutToChats("newRequest", buildSummary(), deps);
  assert.equal(result.failed, 1);
});
