import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MASKED_BILL_VALUE,
  MASKED_MONEY,
  REVEAL_BLOCKED_MESSAGE,
  REVEAL_NO_PIN_MESSAGE,
  REVEAL_START,
  REVEAL_SUB,
  REVEAL_TOAST,
  SALES_REVEAL_KEY,
  SALES_REVEAL_MS,
  grantSalesReveal,
  maskMoney,
  nextRevealTick,
  pinGateOf,
  readSalesReveal,
  revealNotice,
  revealPrompt,
  revealReducer,
  revealState,
  writeSalesReveal,
  type RevealHookState,
} from "@/lib/sales-reveal";

// The sales mask (U0 match Task 6; values 3.3, 3.16, 3.17; design 7): the figures stay "₹ • • • •" until the signed-in
// person enters their own PIN, then show for an hour on this device. Pure: the three states of the reveal button and
// its hint, the mask, the grant kept in sessionStorage.

const ME = "665f00000000000000000a01";
const OTHER = "665f00000000000000000a02";
const NOW = 1_760_000_000_000;
const MIN = 60_000;

test("the constants: one hour, the storage key, the HTML's words", () => {
  assert.equal(SALES_REVEAL_MS, 3_600_000, "the reveal lasts one hour");
  assert.equal(SALES_REVEAL_KEY, "pos.salesReveal", "the grant lives under pos.salesReveal");
  assert.equal(MASKED_MONEY, "₹ • • • •", "the masked money: ₹, a space, four U+2022 bullets with single spaces");
  assert.equal(MASKED_BILL_VALUE, "• • • •", "the masked bill row value: four bullets");
  assert.equal(REVEAL_TOAST, "Sales visible for the next hour · tap the eye to hide", "the toast after a right PIN");
  assert.equal(
    REVEAL_SUB,
    "Sales stay visible on this device for 1 hour. They hide again when the screen locks or you leave Dashboard.",
    "the dialog's sub text",
  );
  assert.equal(REVEAL_NO_PIN_MESSAGE.admin, "Set a PIN on the Staff page to show sales.", "an admin without a PIN");
  assert.equal(REVEAL_NO_PIN_MESSAGE.staff, "Ask an admin to set your PIN to show sales.", "a staff member without a PIN");
});

test("revealState: masked, no unlock -> Show, eye, transparent, 'PIN needed to view' with a padlock in #A1A1AA", () => {
  const v = revealState({ shown: false, until: 0, by: null, me: ME, now: NOW });
  assert.deepEqual(
    {
      label: v.label,
      icon: v.icon,
      bg: v.bg,
      title: v.title,
      hint: v.hint,
      hintIcon: v.hintIcon,
      hintColor: v.hintColor,
    },
    {
      label: "Show",
      icon: "eye",
      bg: "transparent",
      title: "Enter your PIN to show sales",
      hint: "PIN needed to view",
      hintIcon: "lock",
      hintColor: "#A1A1AA",
    },
    "the first state of values 3.3",
  );
  assert.equal(v.visible, false, "nothing shows");
  assert.equal(v.unlocked, false, "the PIN is needed");
});

test("revealState: shown -> Hide, eye with a slash, #2A2A2F, 'Visible · hides in N min' with a clock in #6FDC8C", () => {
  const v = revealState({ shown: true, until: NOW + SALES_REVEAL_MS, by: ME, me: ME, now: NOW });
  assert.deepEqual(
    [v.label, v.icon, v.bg, v.title, v.hint, v.hintIcon, v.hintColor],
    ["Hide", "eye-off", "#2A2A2F", "Hide sales figures", "Visible · hides in 60 min", "clock", "#6FDC8C"],
    "the second state of values 3.3 (right after the PIN: 60 min)",
  );
  assert.equal(v.visible, true, "the figures show");
  assert.equal(v.minutesLeft, 60, "60 minutes left");
});

test("revealState: hidden but still unlocked -> Show, eye, transparent, 'Unlocked · N min left' with a clock in #A1A1AA", () => {
  const v = revealState({ shown: false, until: NOW + 42 * MIN + 1, by: ME, me: ME, now: NOW });
  assert.deepEqual(
    [v.label, v.icon, v.bg, v.title, v.hint, v.hintIcon, v.hintColor],
    ["Show", "eye", "transparent", "Show sales figures", "Unlocked · 43 min left", "clock", "#A1A1AA"],
    "the third state of values 3.3 (minutes rounded up, as the HTML's ceil)",
  );
  assert.equal(v.visible, false, "the figures are hidden");
  assert.equal(v.unlocked, true, "Show needs no PIN within the hour");
});

test("revealState: the minutes count up to the next whole minute; the last millisecond still reads 1 min", () => {
  const left = (ms: number) => revealState({ shown: true, until: NOW + ms, by: ME, me: ME, now: NOW }).hint;
  assert.equal(left(59 * MIN + 30_000), "Visible · hides in 60 min", "59.5 min left reads 60");
  assert.equal(left(59 * MIN), "Visible · hides in 59 min", "exactly 59 min reads 59");
  assert.equal(left(1), "Visible · hides in 1 min", "one millisecond left reads 1 min");
});

test("revealState: another person never inherits the reveal, even marked shown", () => {
  const v = revealState({ shown: true, until: NOW + SALES_REVEAL_MS, by: OTHER, me: ME, now: NOW });
  assert.equal(v.visible, false, "a reveal granted to someone else shows nothing");
  assert.equal(v.unlocked, false, "and asks this person for their own PIN");
  assert.equal(v.hint, "PIN needed to view", "the masked hint");
  assert.equal(v.title, "Enter your PIN to show sales", "the masked title");
  const nobody = revealState({ shown: true, until: NOW + SALES_REVEAL_MS, by: ME, me: null, now: NOW });
  assert.equal(nobody.visible, false, "no signed-in person sees nothing");
});

test("revealState: the hour runs out -> masked again and the PIN is needed", () => {
  const until = NOW + SALES_REVEAL_MS;
  const before = revealState({ shown: true, until, by: ME, me: ME, now: until - 1 });
  assert.equal(before.visible, true, "one millisecond before the hour ends the figures still show");
  const at = revealState({ shown: true, until, by: ME, me: ME, now: until });
  assert.equal(at.visible, false, "at the hour the figures hide");
  assert.equal(at.unlocked, false, "and the next Show asks for the PIN");
  assert.equal(at.label, "Show", "the button reads Show");
  assert.equal(revealState({ shown: false, until, by: ME, me: ME, now: NOW + 61 * MIN }).hint, "PIN needed to view", "after 61 minutes");
});

test("maskMoney: '₹ • • • •' for money, '• • • •' for a bill row, the text itself once shown", () => {
  assert.equal(maskMoney("₹48,250", false), "₹ • • • •", "masked money");
  assert.equal(maskMoney("₹48,250", true), "₹48,250", "shown money");
  assert.equal(maskMoney("− ₹1,840", false, "bill"), "• • • •", "a masked bill row");
  assert.equal(maskMoney("− ₹1,840", true, "bill"), "− ₹1,840", "a shown bill row");
});

test("grantSalesReveal: this person, for one hour from now", () => {
  assert.deepEqual(grantSalesReveal(ME, NOW), { by: ME, until: NOW + SALES_REVEAL_MS }, "by me until now + 1 hour");
});

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

test("the grant round-trips through sessionStorage as { by, until }", () => {
  const store = memoryStorage();
  writeSalesReveal(store, { by: ME, until: NOW + SALES_REVEAL_MS });
  assert.deepEqual(JSON.parse(store.data.get(SALES_REVEAL_KEY) ?? "null"), { by: ME, until: NOW + SALES_REVEAL_MS }, "stored as { by, until }");
  assert.deepEqual(readSalesReveal(store, NOW), { by: ME, until: NOW + SALES_REVEAL_MS }, "read back the same");
});

test("readSalesReveal clamps a stored hour: a hand-edited far future never unlocks for longer than an hour from now", () => {
  const store = memoryStorage({ [SALES_REVEAL_KEY]: JSON.stringify({ by: ME, until: NOW + 365 * 24 * 60 * MIN }) });
  assert.deepEqual(readSalesReveal(store, NOW), { by: ME, until: NOW + SALES_REVEAL_MS }, "clamped to now + 1 hour");
  const shorter = memoryStorage({ [SALES_REVEAL_KEY]: JSON.stringify({ by: ME, until: NOW + 5 * MIN }) });
  assert.deepEqual(readSalesReveal(shorter, NOW), { by: ME, until: NOW + 5 * MIN }, "an earlier end is kept as it is");
});

test("readSalesReveal: nothing, junk, the wrong shape or a storage that throws read as no grant", () => {
  assert.equal(readSalesReveal(memoryStorage()), null, "nothing stored");
  assert.equal(readSalesReveal(memoryStorage({ [SALES_REVEAL_KEY]: "{not json" })), null, "junk");
  assert.equal(readSalesReveal(memoryStorage({ [SALES_REVEAL_KEY]: JSON.stringify({ by: 7, until: NOW }) })), null, "a number for by");
  assert.equal(readSalesReveal(memoryStorage({ [SALES_REVEAL_KEY]: JSON.stringify({ by: ME, until: "soon" }) })), null, "a string for until");
  assert.equal(readSalesReveal(memoryStorage({ [SALES_REVEAL_KEY]: "null" })), null, "null");
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readSalesReveal(throwing), null, "a read that throws is no grant");
  assert.doesNotThrow(() => writeSalesReveal(throwing, { by: ME, until: NOW }), "a write that throws is ignored");
  assert.equal(readSalesReveal(null), null, "no storage at all");
  assert.doesNotThrow(() => writeSalesReveal(null, { by: ME, until: NOW }), "no storage at all: the write is a no-op");
});

test("nextRevealTick: the wait until the hint's minute changes, then until the hour ends; none once it has", () => {
  const until = NOW + SALES_REVEAL_MS;
  assert.equal(nextRevealTick(until, NOW), MIN, "60 min left: the count drops to 59 a minute later");
  assert.equal(nextRevealTick(until, NOW + 30_000), 30_000, "59.5 min left: 30 s to the next whole minute");
  assert.equal(nextRevealTick(until, until - 1), 1, "the last millisecond: wake at the end");
  assert.equal(nextRevealTick(until, until), null, "the hour is over: no timer");
  assert.equal(nextRevealTick(0, NOW), null, "no grant: no timer");
});

test("revealPrompt: '{First name}, enter your PIN'", () => {
  assert.equal(revealPrompt("Rohan Kapoor"), "Rohan, enter your PIN", "the first word of the name");
  assert.equal(revealPrompt("  Admin  "), "Admin, enter your PIN", "a one-word name, trimmed");
  assert.equal(revealPrompt(undefined), "Enter your PIN", "no name");
});

// ── the reveal hook's state, as a pure reducer (Task 6 fix 1) ────────────────

const UNTIL = NOW + SALES_REVEAL_MS;
const mine = { by: ME, until: UNTIL };
const at = (over: Partial<RevealHookState> = {}): RevealHookState => ({ ...REVEAL_START, ...over });

test("revealReducer: every visit starts hidden, with no dialog and no grant until it is read back", () => {
  assert.deepEqual(REVEAL_START, { grant: null, shown: false, pinOpen: false }, "the start");
  assert.deepEqual(revealReducer(REVEAL_START, { type: "restore", grant: mine }), at({ grant: mine }), "the tab's grant read back: still hidden");
});

test("revealReducer toggle: without the hour it opens the PIN dialog; within it it shows at once; shown it hides", () => {
  assert.deepEqual(revealReducer(at(), { type: "toggle", me: ME, now: NOW }), at({ pinOpen: true }), "no grant: the dialog");
  assert.deepEqual(revealReducer(at({ grant: mine }), { type: "toggle", me: ME, now: NOW + MIN }), at({ grant: mine, shown: true }), "within the hour: shown, no PIN");
  assert.deepEqual(revealReducer(at({ grant: mine, shown: true }), { type: "toggle", me: ME, now: NOW + MIN }), at({ grant: mine }), "shown: hidden, the hour kept");
  assert.deepEqual(revealReducer(at({ grant: mine }), { type: "toggle", me: OTHER, now: NOW + MIN }), at({ grant: mine, pinOpen: true }), "another person: their own PIN");
  assert.deepEqual(revealReducer(at({ grant: mine }), { type: "toggle", me: ME, now: UNTIL }), at({ grant: mine, pinOpen: true }), "the hour over: the PIN again");
});

test("revealReducer grant / lock / leave / expire / closePin", () => {
  assert.deepEqual(revealReducer(at({ pinOpen: true }), { type: "grant", grant: mine }), at({ grant: mine, shown: true }), "a right PIN: shown, the dialog closed, the hour kept");
  assert.deepEqual(revealReducer(at({ grant: mine, shown: true, pinOpen: true }), { type: "lock" }), at({ grant: mine }), "a lock: hidden and the dialog closed; the hour stays");
  assert.deepEqual(revealReducer(at({ grant: mine, shown: true }), { type: "leave" }), at({ grant: mine }), "leaving the dashboard: hidden; the hour stays");
  assert.deepEqual(revealReducer(at({ grant: mine, shown: true }), { type: "expire", now: UNTIL - 1 }), at({ grant: mine, shown: true }), "before the end: unchanged");
  assert.deepEqual(revealReducer(at({ grant: mine, shown: true }), { type: "expire", now: UNTIL }), at({ grant: mine }), "at the end: hidden");
  assert.deepEqual(revealReducer(at({ pinOpen: true }), { type: "closePin" }), at(), "Cancel, Escape or the scrim");
});

// ── what the dialog knows before the keys (Task 6 fix 1) ────────────────────

test("pinGateOf: an admin's own cached staff row says up front whether the PIN is set or blocked; no row is unknown", () => {
  assert.equal(pinGateOf(undefined), "unknown", "no row (staff, or no cached list): ask the server");
  assert.equal(pinGateOf({ hasPin: false }), "nopin", "no PIN set");
  assert.equal(pinGateOf({}), "nopin", "a row from before PINs");
  assert.equal(pinGateOf({ hasPin: true, pinBlocked: true }), "blocked", "a blocked PIN");
  assert.equal(pinGateOf({ hasPin: true, pinBlocked: false }), "ready", "ready for the keys");
});

test("revealNotice: the no-PIN words (admin / staff) or the blocked words instead of the keys; none when ready or unknown", () => {
  assert.equal(revealNotice("nopin", true), REVEAL_NO_PIN_MESSAGE.admin, "an admin without a PIN");
  assert.equal(revealNotice("nopin", false), REVEAL_NO_PIN_MESSAGE.staff, "a staff member without a PIN");
  assert.equal(revealNotice("blocked", false), REVEAL_BLOCKED_MESSAGE, "a blocked PIN");
  assert.equal(REVEAL_BLOCKED_MESSAGE, "This PIN is blocked after too many wrong tries. Ask an admin to unblock it.", "the sign-in's own blocked words");
  assert.equal(revealNotice("ready", true), null, "the keys");
  assert.equal(revealNotice("unknown", false), null, "the keys while the server is asked");
});
