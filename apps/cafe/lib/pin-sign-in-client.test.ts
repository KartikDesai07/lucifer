// Task 11 rulings R8/R9 (PIN lock): the pure answer mappings of lib/pin-sign-in-client.ts. What
// signIn(..., { redirect: false }) resolved with becomes the page's answer; nothing from next-auth is
// mocked (the mappings take the plain result object).
import { test } from "node:test";
import assert from "node:assert/strict";

import { passwordSignInOutcome, pinSignInOutcome } from "@/lib/pin-sign-in-client";

const refused = (code?: string, error = "CredentialsSignin") => ({ ok: true, error, code });

test("pinSignInOutcome: a success, and no answer at all", () => {
  assert.deepEqual(pinSignInOutcome({ ok: true }), { ok: true }, "ok with no error -> ok");
  assert.deepEqual(pinSignInOutcome({ ok: true, error: undefined, code: undefined }), { ok: true }, "explicit undefineds -> ok");
  assert.deepEqual(pinSignInOutcome(undefined), { ok: false, failure: { kind: "offline" } }, "no result -> offline");
});

test("pinSignInOutcome: every code the server sends maps to its own kind", () => {
  assert.deepEqual(pinSignInOutcome(refused("wrong:3")), { ok: false, failure: { kind: "wrong", triesLeft: 3 } }, "wrong:3");
  assert.deepEqual(pinSignInOutcome(refused("wrong:0")), { ok: false, failure: { kind: "wrong", triesLeft: 0 } }, "wrong:0");
  assert.deepEqual(pinSignInOutcome(refused("wait:540")), { ok: false, failure: { kind: "wait", retryAfterSec: 540 } }, "wait:540");
  for (const kind of ["blocked", "device", "nopin"] as const) {
    assert.deepEqual(pinSignInOutcome(refused(kind)), { ok: false, failure: { kind } }, kind);
  }
});

test("pinSignInOutcome: an answer with no code the page knows is error, never nopin", () => {
  const error = { ok: false, failure: { kind: "error" } };
  assert.deepEqual(pinSignInOutcome({ ok: true, error: "Configuration" }), error, "Configuration, no code (a server or DB error)");
  assert.deepEqual(pinSignInOutcome(refused("weird", "Configuration")), error, "Configuration with an unknown code");
  assert.deepEqual(pinSignInOutcome(refused("credentials")), error, "Auth.js's default CredentialsSignin code");
  assert.deepEqual(pinSignInOutcome(refused("wrong:x")), error, "a malformed count");
  assert.deepEqual(pinSignInOutcome(refused(undefined, "MissingCSRF")), error, "another Auth.js error with no code");
  assert.deepEqual(pinSignInOutcome({ ok: false }), error, "not ok and no error");
});

test("passwordSignInOutcome: success, no answer, and any refusal reads as wrong credentials", () => {
  assert.deepEqual(passwordSignInOutcome({ ok: true }), { ok: true }, "ok with no error -> ok");
  assert.deepEqual(passwordSignInOutcome(undefined), { ok: false, failure: { kind: "offline" } }, "no result -> offline");
  const credentials = { ok: false, failure: { kind: "credentials" } };
  assert.deepEqual(passwordSignInOutcome(refused("credentials")), credentials, "the CredentialsSignin default code");
  assert.deepEqual(passwordSignInOutcome(refused(undefined)), credentials, "an error with no code");
  assert.deepEqual(passwordSignInOutcome({ ok: true, error: "Configuration" }), credentials, "Configuration (as the login page shows it today)");
  assert.deepEqual(passwordSignInOutcome({ ok: false }), credentials, "not ok and no error");
});
