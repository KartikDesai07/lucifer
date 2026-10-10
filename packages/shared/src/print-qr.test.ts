import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MS_PER_MINUTE,
  PAY_QR_MINUTES_DEFAULT,
  PAY_QR_MINUTES_MAX,
  PAY_QR_MINUTES_MIN,
  PAY_QR_MODES,
  PAY_QR_MODE_DEFAULT,
  PAY_QR_NO_LIMIT,
  UPI_ID_MAX_LEN,
  UPI_PAYEE_ESCAPED_MAX,
  UPI_RULES_MAX,
  UPI_RULE_UPTO_MAX,
  isPayQrMinutes,
  isSafeHttpsLink,
  isValidUpiId,
  payQrMinutesOf,
  payQrModeOf,
  payQrPlan,
  upiIdForAmount,
  upiPayUri,
  upiRulesOf,
  type PayQrInput,
  type UpiRule,
} from "./print-qr";

test("isValidUpiId accepts handle@bank shapes", () => {
  // The bank handle takes letters AND digits: a real ID the form refused would leave the cafe with no pay QR.
  for (const id of ["samplecafe@okaxis", "sample.cafe-1_x@ybl", "ab@upi", "9876543210@paytm", "name@bank1"]) {
    assert.equal(isValidUpiId(id), true, id);
  }
});

test("isValidUpiId rejects malformed IDs, spaces, a one-character bank, and anything over UPI_ID_MAX_LEN", () => {
  const tooLong = `${"a".repeat(UPI_ID_MAX_LEN)}@okaxis`;
  for (const id of ["", "no-at-sign", "a@1", "a@okaxis", "with space@okaxis", "x@@okaxis", "name@ok axis", "name@ok.axis", tooLong]) {
    assert.equal(isValidUpiId(id), false, id);
  }
});

test("upiPayUri builds the NPCI upi://pay link with two-decimal amount and escaped payee/note", () => {
  assert.equal(
    upiPayUri({ upiId: "samplecafe@okaxis", payee: "Sample Cafe", amount: 630, note: "Bill 128" }),
    "upi://pay?pa=samplecafe@okaxis&pn=Sample%20Cafe&am=630.00&cu=INR&tn=Bill%20128",
  );
  assert.equal(
    upiPayUri({ upiId: "a.b@ybl", payee: "Tea & Co", amount: 99.5, note: "Bill 1" }),
    "upi://pay?pa=a.b@ybl&pn=Tea%20%26%20Co&am=99.50&cu=INR&tn=Bill%201",
  );
});

test("upiPayUri caps the escaped payee name at UPI_PAYEE_ESCAPED_MAX, cutting at whole characters", () => {
  // A long Devanagari name escapes to 9 bytes a letter; uncapped it grows the QR past a 58 mm slip.
  const long = "क".repeat(60);
  const pn = /pn=([^&]*)&/.exec(upiPayUri({ upiId: "a.b@ybl", payee: long, amount: 1, note: "Bill 1" }))?.[1] ?? "";
  assert.ok(pn.length > 0 && pn.length <= UPI_PAYEE_ESCAPED_MAX, String(pn.length));
  assert.equal(decodeURIComponent(pn), "क".repeat(pn.length / 9));
  // A Latin name inside the cap is untouched.
  const short = upiPayUri({ upiId: "a.b@ybl", payee: "Sample Cafe", amount: 1, note: "Bill 1" });
  assert.ok(short.includes("pn=Sample%20Cafe&"), short);
});

test("isSafeHttpsLink accepts a plain https link", () => {
  assert.equal(isSafeHttpsLink("https://example.com"), true);
  assert.equal(isSafeHttpsLink("https://example.com/menu?table=4#top"), true);
});

test("isSafeHttpsLink rejects http, an upper-case scheme, userinfo, a backslash, a space and no host", () => {
  for (const link of [
    "http://example.com",
    "HTTPS://example.com",
    "https://user:pass@example.com",
    "https://user@example.com",
    "https://example.com\\evil",
    "https://example.com/a b",
    "https:///example.com",
    "https://",
    "example.com",
    "",
  ]) {
    assert.equal(isSafeHttpsLink(link), false, JSON.stringify(link));
  }
});

// ── Pay QR policy (S3b, owner decisions A4) ─────────────────────────────────
// payQrPlan is the one place that decides whether a slip prints the "Scan to pay" QR, for how much, and until when.
// Every leg below starts from a bill that WOULD print (BASE) and changes exactly the one thing under test, so
// removing that single rule from print-qr.ts is the only way the leg can fail, and each leg also asserts the
// unchanged BASE still prints (the positive landmark: a plan that returned null for everything would pass a bare
// "is null" check).
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const MAIN_UPI = "samplecafe@okaxis";
const BASE: PayQrInput = {
  mode: "always",
  minutes: PAY_QR_MINUTES_DEFAULT,
  upiId: MAIN_UPI,
  upiRules: [],
  cancelled: false,
  total: 100,
  paid: 0,
  nowMs: NOW,
};
const plan = (over: Partial<PayQrInput> = {}) => payQrPlan({ ...BASE, ...over });

test("pay QR policy constants: 5 to 1440 minutes, default 60, No limit is 0, default mode always, a minute is 60000 ms", () => {
  assert.equal(PAY_QR_MINUTES_MIN, 5);
  assert.equal(PAY_QR_MINUTES_MAX, 1440);
  assert.equal(PAY_QR_MINUTES_DEFAULT, 60);
  assert.equal(PAY_QR_NO_LIMIT, 0);
  assert.equal(PAY_QR_MODE_DEFAULT, "always");
  assert.equal(MS_PER_MINUTE, 60000);
  assert.deepEqual([...PAY_QR_MODES], ["always", "owed", "never"]);
});

test("payQrPlan: the unchanged BASE bill prints, asking the whole total for 60 minutes from now", () => {
  assert.deepEqual(plan(), { amount: 100, validTillMs: NOW + 60 * MS_PER_MINUTE, upiId: MAIN_UPI });
});

test("payQrPlan: a cancelled bill prints no pay QR, whatever the mode", () => {
  assert.equal(plan({ cancelled: true }), null);
  assert.equal(plan({ cancelled: true, mode: "owed" }), null);
  assert.notEqual(plan({ cancelled: false }), null);
});

test("payQrPlan: mode never prints no pay QR even for a bill with money due", () => {
  assert.equal(plan({ mode: "never", paid: 0 }), null);
  assert.equal(plan({ mode: "never", paid: 40 }), null);
  assert.notEqual(plan({ mode: "always" }), null);
});

test("payQrPlan: an invalid UPI ID prints no pay QR", () => {
  for (const upiId of ["", "no-at-sign", "a@1", "with space@okaxis"]) {
    assert.equal(plan({ upiId }), null, JSON.stringify(upiId));
  }
  assert.notEqual(plan({ upiId: "a.b@ybl" }), null);
});

test("payQrPlan: owed + fully paid prints no pay QR", () => {
  assert.equal(plan({ mode: "owed", paid: 100 }), null);
  assert.notEqual(plan({ mode: "owed", paid: 0 }), null);
});

test("payQrPlan: owed + overpaid prints no pay QR", () => {
  assert.equal(plan({ mode: "owed", paid: 130 }), null);
});

test("payQrPlan: owed + partly paid asks exactly what is still due", () => {
  assert.equal(plan({ mode: "owed", total: 250, paid: 100 })?.amount, 150);
});

test("payQrPlan: always + fully paid still prints, asking the full total", () => {
  assert.equal(plan({ mode: "always", total: 250, paid: 250 })?.amount, 250);
});

test("payQrPlan: always + overpaid asks the full total", () => {
  assert.equal(plan({ mode: "always", total: 250, paid: 300 })?.amount, 250);
});

test("payQrPlan: a partly paid bill under always asks exactly what is due, never more than is owed", () => {
  assert.equal(plan({ mode: "always", total: 250, paid: 100 })?.amount, 150);
  assert.equal(plan({ mode: "always", total: 100, paid: 99.5 })?.amount, 0.5);
});

test("payQrPlan: a zero-total bill prints no pay QR (there is nothing to ask), in either mode", () => {
  assert.equal(plan({ mode: "always", total: 0, paid: 0 }), null);
  assert.equal(plan({ mode: "owed", total: 0, paid: 0 }), null);
  assert.notEqual(plan({ total: 1 }), null);
});

test("payQrPlan: float dust in total - paid counts as paid: no Scan to pay 0.00 under owed, the full total under always", () => {
  // 100.3 - 100.29999999999 is about 1e-11 in floats; a bare "due > 0" check would print a zero-rupee ask.
  assert.equal(plan({ mode: "owed", total: 100.3, paid: 100.29999999999 }), null);
  assert.equal(plan({ mode: "always", total: 100.3, paid: 100.29999999999 })?.amount, 100.3);
  // A real one-paisa balance is still owed, and a cents subtraction is rounded to whole paise.
  assert.equal(plan({ mode: "owed", total: 100.3, paid: 100.29 })?.amount, 0.01);
  assert.equal(plan({ mode: "owed", total: 100.3, paid: 100.2 })?.amount, 0.1);
});

test("payQrPlan: No limit (0) prints with no valid-till even when the bill was first printed days ago", () => {
  const daysAgo = new Date(NOW - 3 * 24 * 60 * MS_PER_MINUTE).toISOString();
  assert.deepEqual(plan({ minutes: PAY_QR_NO_LIMIT, firstPrintedAt: daysAgo }), { amount: 100, validTillMs: null, upiId: MAIN_UPI });
  // The same stamp under a 60 minute window has long expired, so the leg above is not passing for another reason.
  assert.equal(plan({ minutes: 60, firstPrintedAt: daysAgo }), null);
});

test("payQrPlan: the window starts at the first-print stamp, not at now", () => {
  const stamp = NOW - 10 * MS_PER_MINUTE;
  assert.deepEqual(plan({ minutes: 60, firstPrintedAt: new Date(stamp).toISOString() }), {
    amount: 100,
    validTillMs: stamp + 60 * MS_PER_MINUTE,
    upiId: MAIN_UPI,
  });
});

test("payQrPlan: a reprint exactly at valid-till still prints; one millisecond later prints nothing", () => {
  const stamp = NOW - 60 * MS_PER_MINUTE;
  const firstPrintedAt = new Date(stamp).toISOString();
  const till = stamp + 60 * MS_PER_MINUTE;
  assert.deepEqual(plan({ minutes: 60, firstPrintedAt, nowMs: till }), { amount: 100, validTillMs: till, upiId: MAIN_UPI });
  assert.equal(plan({ minutes: 60, firstPrintedAt, nowMs: till + 1 }), null);
});

test("payQrPlan: with no stamp this print is the first, so valid-till is now + minutes", () => {
  assert.deepEqual(plan({ minutes: 5 }), { amount: 100, validTillMs: NOW + 5 * MS_PER_MINUTE, upiId: MAIN_UPI });
  assert.deepEqual(plan({ minutes: 1440, firstPrintedAt: undefined }), { amount: 100, validTillMs: NOW + 1440 * MS_PER_MINUTE, upiId: MAIN_UPI });
});

test("payQrPlan: an unparseable stamp is treated as no stamp (window from now), not as an expired bill", () => {
  assert.deepEqual(plan({ minutes: 60, firstPrintedAt: "garbage" }), plan({ minutes: 60 }));
  assert.deepEqual(plan({ minutes: 60, firstPrintedAt: "" }), { amount: 100, validTillMs: NOW + 60 * MS_PER_MINUTE, upiId: MAIN_UPI });
});

test("payQrModeOf keeps each member and falls back to always for an absent, foreign or non-string value", () => {
  for (const mode of PAY_QR_MODES) assert.equal(payQrModeOf(mode), mode);
  for (const bad of [undefined, null, "sometimes", "ALWAYS", 1, {}]) {
    assert.equal(payQrModeOf(bad), "always", String(bad));
  }
});

test("payQrMinutesOf keeps 0 (No limit) and in-range whole minutes, and falls back to 60 for anything else", () => {
  // 0 must NOT be defaulted: a falsy check would turn No limit back into 60 minutes.
  assert.equal(payQrMinutesOf(0), 0);
  for (const kept of [5, 30, 1440]) assert.equal(payQrMinutesOf(kept), kept);
  for (const bad of [4, 1441, 5.5, Number.NaN, -5, "60", "120", null, undefined]) {
    assert.equal(payQrMinutesOf(bad), 60, String(bad));
  }
});

test("isPayQrMinutes accepts 0 and the 5 to 1440 whole minutes, and rejects every edge outside them", () => {
  for (const ok of [0, 5, 60, 1440]) assert.equal(isPayQrMinutes(ok), true, String(ok));
  for (const bad of [1, 4, 1441, -1, 5.5, 0.5, Number.NaN, Infinity]) assert.equal(isPayQrMinutes(bad), false, String(bad));
});
