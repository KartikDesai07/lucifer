import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTelegramPort, TELEGRAM_TRANSPORT_ERROR } from "./api";

// CR2.3b coverage gap — every other telegram suite fakes the whole
// TelegramPort; nothing exercises the REAL `createTelegramPort` against the
// actual Bot API wire shape. This suite stubs the GLOBAL `fetch` (never a
// real network call) and drives the real response-mapping logic in api.ts:
// error_code / parameters.retry_after / parameters.migrate_to_chat_id
// mapping, the deliberate `description` drop, and the transport-error
// collapse on any non-2xx-shaped failure.

const TOKEN = "123456:AA-fake-token-value-should-never-leak";

type FetchCall = { url: string; init: RequestInit | undefined };

let calls: FetchCall[] = [];
let nextImpl: (url: string, init?: RequestInit) => Promise<{ json: () => Promise<unknown> }>;
const realFetch = globalThis.fetch;

before(() => {
  // @ts-expect-error — test stub narrows the signature; api.ts only ever
  // calls fetch(url, init) and awaits response.json().
  globalThis.fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return nextImpl(url, init);
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  nextImpl = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
});

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) });
}

test("ok:true response passes through {ok:true, result}", async () => {
  nextImpl = () => jsonResponse({ ok: true, result: { username: "cafe_bot" } });
  const port = createTelegramPort(TOKEN);
  const res = await port.getMe();
  assert.deepEqual(res, { ok: true, result: { username: "cafe_bot" } });
});

test("request URL carries /bot<token>/<method> for every port method", async () => {
  nextImpl = () => jsonResponse({ ok: true, result: null });
  const port = createTelegramPort(TOKEN);

  await port.getMe();
  await port.deleteWebhook();
  await port.getWebhookInfo();
  await port.setWebhook({ url: "https://x.test/hook", secretToken: "s", allowedUpdates: ["message"] });
  await port.sendMessage({ chatId: "1", text: "hi" });

  assert.equal(calls.length, 5);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/getMe`);
  assert.equal(calls[1].url, `https://api.telegram.org/bot${TOKEN}/deleteWebhook`);
  assert.equal(calls[2].url, `https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
  assert.equal(calls[3].url, `https://api.telegram.org/bot${TOKEN}/setWebhook`);
  assert.equal(calls[4].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
});

test("request body is JSON with a content-type header", async () => {
  nextImpl = () => jsonResponse({ ok: true, result: null });
  const port = createTelegramPort(TOKEN);
  await port.sendMessage({ chatId: "42", text: "hello", parseMode: "HTML" });

  const call = calls[0];
  assert.equal(call.init?.method, "POST");
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  const parsedBody = JSON.parse(call.init?.body as string);
  assert.deepEqual(parsedBody, { chat_id: "42", text: "hello", parse_mode: "HTML" });
});

test("error_code 429 with parameters.retry_after maps to retryAfterSec", async () => {
  nextImpl = () => jsonResponse({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } });
  const port = createTelegramPort(TOKEN);
  const res = await port.sendMessage({ chatId: "1", text: "hi" });
  assert.deepEqual(res, { ok: false, errorCode: 429, retryAfterSec: 3 });
});

test("migrate_to_chat_id (large 52-bit-ish number) maps to a STRING", async () => {
  const bigChatId = -1002345678901234;
  nextImpl = () =>
    jsonResponse({ ok: false, error_code: 400, description: "group migrated", parameters: { migrate_to_chat_id: bigChatId } });
  const port = createTelegramPort(TOKEN);
  const res = await port.sendMessage({ chatId: "1", text: "hi" });
  if (res.ok) throw new Error("expected ok:false");
  assert.equal(res.migrateToChatId, "-1002345678901234");
  assert.equal(typeof res.migrateToChatId, "string");
});

test("description is deliberately dropped from the returned object", async () => {
  nextImpl = () =>
    jsonResponse({ ok: false, error_code: 400, description: "chat not found: -100123", parameters: { retry_after: 1 } });
  const port = createTelegramPort(TOKEN);
  const res = await port.sendMessage({ chatId: "1", text: "hi" });
  assert.equal(Object.keys(res).includes("description"), false);
  assert.deepEqual(Object.keys(res).sort(), ["errorCode", "ok", "retryAfterSec"].sort());
});

test("ok:false with no parameters omits retryAfterSec/migrateToChatId", async () => {
  nextImpl = () => jsonResponse({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
  const port = createTelegramPort(TOKEN);
  const res = await port.sendMessage({ chatId: "1", text: "hi" });
  if (res.ok) throw new Error("expected ok:false");
  assert.deepEqual(res, { ok: false, errorCode: 403 });
  assert.equal(res.retryAfterSec, undefined);
  assert.equal(res.migrateToChatId, undefined);
});

test("fetch rejecting (network error) collapses to transport error, never throws", async () => {
  nextImpl = () => Promise.reject(new Error("ENOTFOUND api.telegram.org"));
  const port = createTelegramPort(TOKEN);
  const res = await port.getMe();
  assert.deepEqual(res, { ok: false, errorCode: TELEGRAM_TRANSPORT_ERROR });
});

test("response.json() rejecting (non-JSON body) collapses to transport error, never throws", async () => {
  nextImpl = () => Promise.resolve({ json: () => Promise.reject(new Error("Unexpected token in JSON")) });
  const port = createTelegramPort(TOKEN);
  const res = await port.getMe();
  assert.deepEqual(res, { ok: false, errorCode: TELEGRAM_TRANSPORT_ERROR });
});

test("junk JSON shape (no ok field) collapses to transport error", async () => {
  nextImpl = () => jsonResponse({ weird: true });
  const port = createTelegramPort(TOKEN);
  const res = await port.getMe();
  assert.deepEqual(res, { ok: false, errorCode: TELEGRAM_TRANSPORT_ERROR });
});

test("HTTP 500 with a valid Telegram error envelope still maps from the BODY's error_code", async () => {
  // api.ts NEVER reads response.status/response.ok — it awaits response.json()
  // unconditionally and lets the envelope's own `ok`/`error_code` fields drive
  // everything. A stub that returns a well-formed envelope body regardless of
  // the (unmodeled, since we never construct a real Response) status code
  // therefore parses exactly like a 200 would. Pinning the TRUE behavior read
  // from the source: HTTP status is irrelevant to this port, only the body is.
  nextImpl = () => jsonResponse({ ok: false, error_code: 500, description: "Internal Server Error" });
  const port = createTelegramPort(TOKEN);
  const res = await port.getMe();
  assert.deepEqual(res, { ok: false, errorCode: 500 });
});

test("the token never appears in any returned result, for any branch", async () => {
  // Note: `result` on the ok:true branch is an untyped passthrough of
  // whatever Telegram sends back — it is not, and should not be, scrubbed
  // by this port. Real Telegram responses never echo the bot token in a
  // result body (the token travels in the URL only), so these branches
  // exercise the paths where OUR OWN mapping code could plausibly leak it:
  // the deliberately-dropped `description` field, and both transport-error
  // catch paths (network rejection, non-JSON body) where the underlying
  // error message might otherwise have been surfaced.
  const branches: Array<() => Promise<{ json: () => Promise<unknown> }>> = [
    () => jsonResponse({ ok: false, error_code: 429, description: TOKEN, parameters: { retry_after: 2 } }),
    () => Promise.reject(new Error(`failed for ${TOKEN}`)),
    () => Promise.resolve({ json: () => Promise.reject(new Error(TOKEN)) }),
  ];

  for (const impl of branches) {
    nextImpl = impl;
    const port = createTelegramPort(TOKEN);
    const res = await port.getMe();
    assert.equal(JSON.stringify(res).includes(TOKEN), false);
  }
});
