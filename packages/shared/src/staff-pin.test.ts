import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAFF_PIN_LENGTH,
  STAFF_PIN_PATTERN,
  STAFF_PIN_EASY,
  isValidStaffPin,
  staffPinProblem,
  STAFF_PIN_MESSAGES,
  staffPinSchema,
  STAFF_PIN_RATE_MAX,
  STAFF_PIN_DAILY_BLOCK,
  staffPinBucket,
  PIN_DEVICE_COOKIE,
  PIN_DEVICE_MAX,
  PIN_DEVICE_MAX_AGE_SECONDS,
  SCREEN_LOCK_MINUTES,
  SCREEN_LOCK_DEFAULT_MINUTES,
  encodePinFailure,
  parsePinFailure,
  pinFailureMessage,
  type PinSignInFailure,
} from "./staff-pin";
import { DINER_PIN_BANNED } from "./public-diner";
import { createStaffSchema, updateStaffSchema } from "./schemas/staff.schema";
import { SESSION_MAX_AGE_SECONDS, SESSION_KEEPALIVE_SECONDS } from "./constants";

test("PIN constants", () => {
  assert.equal(STAFF_PIN_LENGTH, 4, "length 4");
  assert.equal(STAFF_PIN_PATTERN.test("1234"), true, "pattern accepts 4 digits");
  assert.equal(STAFF_PIN_EASY, DINER_PIN_BANNED, "the easy list is the diner's list, not a copy");
  assert.equal(STAFF_PIN_RATE_MAX, 5, "rate max");
  assert.equal(STAFF_PIN_DAILY_BLOCK, 20, "daily block");
  assert.equal(PIN_DEVICE_COOKIE, "pos-pin-device", "cookie name");
  assert.equal(PIN_DEVICE_MAX, 30, "device max");
  assert.equal(PIN_DEVICE_MAX_AGE_SECONDS, 400 * 24 * 60 * 60, "device cookie age");
});

test("shape and easy problems", () => {
  assert.equal(staffPinProblem("7391"), null, "7391 is fine");
  assert.equal(isValidStaffPin("7391"), true, "7391 valid");
  for (const bad of ["12a4", "123", "12345", "", 1234, null, undefined]) {
    assert.equal(staffPinProblem(bad), "shape", `shape for ${String(bad)}`);
    assert.equal(isValidStaffPin(bad), false, `invalid ${String(bad)}`);
  }
  for (const easy of ["0000", "1234", "2580"]) {
    assert.equal(staffPinProblem(easy), "easy", `easy for ${easy}`);
    assert.equal(isValidStaffPin(easy), false, `invalid ${easy}`);
  }
});

test("staffPinSchema messages", () => {
  const shape = staffPinSchema.safeParse("12a4");
  assert.equal(shape.success, false, "shape fails");
  if (!shape.success) assert.equal(shape.error.issues[0].message, "Enter exactly 4 digits.", "shape message");
  const easy = staffPinSchema.safeParse("1234");
  assert.equal(easy.success, false, "easy fails");
  if (!easy.success) assert.equal(easy.error.issues[0].message, "Too easy to guess. Pick another PIN.", "easy message");
  assert.equal(staffPinSchema.safeParse("7391").success, true, "good pin passes");
  assert.deepEqual(
    STAFF_PIN_MESSAGES,
    { shape: "Enter exactly 4 digits.", easy: "Too easy to guess. Pick another PIN." },
    "messages",
  );
});

test("staffPinBucket", () => {
  assert.equal(staffPinBucket("abc"), "staffpin:abc", "bucket");
});

test("screen lock values", () => {
  assert.deepEqual([...SCREEN_LOCK_MINUTES], [0, 30, 60, 120], "values");
  assert.equal(SCREEN_LOCK_DEFAULT_MINUTES, 60, "default");
});

test("failure codes round trip", () => {
  const all: PinSignInFailure[] = [
    { kind: "wrong", triesLeft: 3 },
    { kind: "wait", retryAfterSec: 540 },
    { kind: "blocked" },
    { kind: "device" },
    { kind: "nopin" },
  ];
  const codes = ["wrong:3", "wait:540", "blocked", "device", "nopin"];
  all.forEach((f, i) => {
    assert.equal(encodePinFailure(f), codes[i], `encode ${codes[i]}`);
    assert.deepEqual(parsePinFailure(codes[i]), f, `parse ${codes[i]}`);
  });
  assert.deepEqual(parsePinFailure("weird"), { kind: "nopin" }, "unknown");
  assert.deepEqual(parsePinFailure(undefined), { kind: "nopin" }, "undefined");
  assert.deepEqual(parsePinFailure(null), { kind: "nopin" }, "null");
  assert.deepEqual(parsePinFailure("wrong:x"), { kind: "nopin" }, "bad count");
});

test("failure messages are exact", () => {
  assert.equal(pinFailureMessage({ kind: "wrong", triesLeft: 1 }), "Incorrect PIN · 1 try left", "1 try");
  assert.equal(pinFailureMessage({ kind: "wrong", triesLeft: 3 }), "Incorrect PIN · 3 tries left", "3 tries");
  assert.equal(pinFailureMessage({ kind: "wrong", triesLeft: 0 }), "Incorrect PIN", "0 tries");
  assert.equal(pinFailureMessage({ kind: "wait", retryAfterSec: 540 }), "Too many wrong PINs. Try again in 9 min.", "wait");
  assert.equal(pinFailureMessage({ kind: "wait", retryAfterSec: 61 }), "Too many wrong PINs. Try again in 2 min.", "wait ceil");
  assert.equal(
    pinFailureMessage({ kind: "blocked" }),
    "This PIN is blocked after too many wrong tries. Ask an admin to unblock it.",
    "blocked",
  );
  assert.equal(
    pinFailureMessage({ kind: "device" }),
    "Sign in with your username and password on this device first.",
    "device",
  );
  assert.equal(pinFailureMessage({ kind: "nopin" }), "Sign in with your username and password.", "nopin");
  assert.equal(
    pinFailureMessage({ kind: "offline" }),
    "No internet. The PIN can't be checked right now. Printing goes on.",
    "offline",
  );
});

test("staff schemas carry the optional pin", () => {
  const base = { name: "Asha", mobile: "9999999999", username: "asha", password: "password1" };
  assert.equal(createStaffSchema.safeParse(base).success, true, "pin is optional");
  assert.equal(createStaffSchema.safeParse({ ...base, pin: "7391" }).success, true, "good pin");
  assert.equal(createStaffSchema.safeParse({ ...base, pin: "1111" }).success, false, "easy pin refused");
  assert.equal(updateStaffSchema.safeParse({ pin: "7391" }).success, true, "update accepts pin");
  assert.equal(updateStaffSchema.safeParse({ pinBlocked: false }).success, true, "unblock accepted");
  assert.equal(updateStaffSchema.safeParse({ pinBlocked: true }).success, false, "block not accepted");
});

test("session is 90 days, keepalive stays 30 minutes", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 90 * 24 * 60 * 60, "90 days");
  assert.equal(SESSION_KEEPALIVE_SECONDS, 30 * 60, "keepalive");
});
