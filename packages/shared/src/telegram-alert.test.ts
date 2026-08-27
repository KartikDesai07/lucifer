import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TELEGRAM_ALERT_TYPES,
  TELEGRAM_ALERT_REGISTRY,
  TELEGRAM_SECRET_HEADER,
  TELEGRAM_START_PAYLOAD_MAX,
  defaultAlertTypes,
  isTelegramAlertType,
  normalizeAlertTypes,
  shouldSendToChat,
  telegramDeepLink,
} from "./telegram-alert";
import { PUBLIC_TOKEN_ALPHABET } from "./public";

// -- registry integrity -----------------------------------------------------

test("registry: exactly the 3 planned types, unique", () => {
  assert.deepEqual(TELEGRAM_ALERT_TYPES, ["newRequest", "autoAccepted", "editedRequest"]);
  assert.equal(new Set(TELEGRAM_ALERT_REGISTRY.map((m) => m.type)).size, TELEGRAM_ALERT_REGISTRY.length);
});

test("registry: defaultOn matches the spec exactly", () => {
  const defaultOnByType = Object.fromEntries(TELEGRAM_ALERT_REGISTRY.map((m) => [m.type, m.defaultOn]));
  assert.deepEqual(defaultOnByType, { newRequest: true, autoAccepted: true, editedRequest: false });
});

// -- defaultAlertTypes -------------------------------------------------------

test("defaultAlertTypes: registry-order defaultOn subset", () => {
  assert.deepEqual(defaultAlertTypes(), ["newRequest", "autoAccepted"]);
});

test("defaultAlertTypes: returns a FRESH array each call — mutating one never corrupts a later call", () => {
  const first = defaultAlertTypes();
  first.push("editedRequest");
  first.length = 0;
  assert.deepEqual(defaultAlertTypes(), ["newRequest", "autoAccepted"]);
});

// -- isTelegramAlertType ------------------------------------------------------

test("isTelegramAlertType: accepts every known type", () => {
  for (const t of TELEGRAM_ALERT_TYPES) assert.equal(isTelegramAlertType(t), true);
});

test("isTelegramAlertType: rejects junk, wrong case, and prototype-key strings", () => {
  assert.equal(isTelegramAlertType("newrequest"), false); // wrong case
  assert.equal(isTelegramAlertType("bogus"), false);
  assert.equal(isTelegramAlertType("constructor"), false);
  assert.equal(isTelegramAlertType("__proto__"), false);
  assert.equal(isTelegramAlertType(123), false);
  assert.equal(isTelegramAlertType(null), false);
  assert.equal(isTelegramAlertType(undefined), false);
});

// -- normalizeAlertTypes ------------------------------------------------------

test("normalizeAlertTypes: non-array input becomes []", () => {
  assert.deepEqual(normalizeAlertTypes(undefined), []);
  assert.deepEqual(normalizeAlertTypes(null), []);
  assert.deepEqual(normalizeAlertTypes("newRequest"), []);
  assert.deepEqual(normalizeAlertTypes({ newRequest: true }), []);
});

test("normalizeAlertTypes: drops junk members (objects/numbers/null/unknown strings)", () => {
  assert.deepEqual(
    normalizeAlertTypes(["newRequest", 42, null, { type: "autoAccepted" }, "bogus", "constructor"]),
    ["newRequest"],
  );
});

test("normalizeAlertTypes: dedupes and restores REGISTRY order regardless of input order", () => {
  assert.deepEqual(
    normalizeAlertTypes(["editedRequest", "newRequest", "editedRequest", "autoAccepted", "newRequest"]),
    ["newRequest", "autoAccepted", "editedRequest"],
  );
});

// -- shouldSendToChat ----------------------------------------------------------

test("shouldSendToChat: active false ⇒ false even with the type present", () => {
  assert.equal(shouldSendToChat({ active: false, types: ["newRequest"] }, "newRequest"), false);
});

test("shouldSendToChat: active true + type present ⇒ true", () => {
  assert.equal(shouldSendToChat({ active: true, types: ["newRequest"] }, "newRequest"), true);
});

test("shouldSendToChat: active true but type absent ⇒ false", () => {
  assert.equal(shouldSendToChat({ active: true, types: ["autoAccepted"] }, "newRequest"), false);
});

test("shouldSendToChat: junk types array ⇒ false (normalized to empty)", () => {
  assert.equal(shouldSendToChat({ active: true, types: ["bogus", "constructor"] }, "newRequest"), false);
});

test("shouldSendToChat: truthy-but-not-true active (1, \"yes\") ⇒ false — strict === true only", () => {
  assert.equal(shouldSendToChat({ active: 1 as unknown as boolean, types: ["newRequest"] }, "newRequest"), false);
  assert.equal(shouldSendToChat({ active: "yes" as unknown as boolean, types: ["newRequest"] }, "newRequest"), false);
});

// -- telegramDeepLink ----------------------------------------------------------

test("telegramDeepLink: exact string, no encoding", () => {
  assert.equal(telegramDeepLink("MyCafeBot", "ABCD1234EFGH"), "https://t.me/MyCafeBot?start=ABCD1234EFGH");
});

// -- charset / constant sanity --------------------------------------------------

test("PUBLIC_TOKEN_ALPHABET is a subset of Telegram's start-payload charset (A-Za-z0-9_-)", () => {
  for (const ch of PUBLIC_TOKEN_ALPHABET) assert.match(ch, /^[A-Za-z0-9_-]$/);
});

test("invite codes (14 chars) fit under TELEGRAM_START_PAYLOAD_MAX", () => {
  assert.ok(14 <= TELEGRAM_START_PAYLOAD_MAX);
});

test("TELEGRAM_SECRET_HEADER: exact header name Telegram sends", () => {
  assert.equal(TELEGRAM_SECRET_HEADER, "X-Telegram-Bot-Api-Secret-Token");
});

// -- purity pin -----------------------------------------------------------------

test("purity pin: telegram-alert.ts has zero import statements and no console.*", () => {
  const path = fileURLToPath(new URL("./telegram-alert.ts", import.meta.url));
  const source = readFileSync(path, "utf8");
  assert.equal(/^\s*import\b/m.test(source), false, "must have zero import statements — pure module");
  assert.equal(/console\./.test(source), false, "must never use console.*");
});
