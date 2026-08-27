import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyStatusSaveFailure,
  isPromoErrorMessage,
  REFRESH_MENU_HINT,
  SOLD_OUT_EDIT_HINT,
  SOLD_OUT_PATTERN,
  SAVE_FAILED_MESSAGE,
} from "@/components/public/public-status-edit";
import { SOLD_OUT_ERROR } from "@/lib/public-pricing";
import { PROMO_SESSION_OPEN, PROMO_ALREADY_USED } from "@pos/shared/public";

// CR2.5 S1 (repro-first) — §23.1: a sold-out 422's message renders as
// `"<item>" is sold out` PLUS REFRESH_MENU_HINT ("...Please refresh the menu
// and try again."), but refreshing the menu cannot un-sell-out a kept line —
// the diner has to REMOVE it. classifyStatusSaveFailure must special-case the
// sold-out 422 shape with its own actionable hint instead of the generic
// refresh copy. Every other 422 shape (non-sold-out message, or none at all)
// keeps the existing REFRESH_MENU_HINT behaviour untouched.

test("classifyStatusSaveFailure: a sold-out 422 gets SOLD_OUT_EDIT_HINT, not REFRESH_MENU_HINT", () => {
  const message = SOLD_OUT_ERROR("Paneer Tikka");
  const result = classifyStatusSaveFailure(422, message);
  assert.equal(result, message + SOLD_OUT_EDIT_HINT);
  assert.doesNotMatch(result, /Please refresh the menu/);
});

test("classifyStatusSaveFailure: a non-sold-out 422 message still gets REFRESH_MENU_HINT (unchanged)", () => {
  const message = "Unknown item in your order";
  const result = classifyStatusSaveFailure(422, message);
  assert.equal(result, message + REFRESH_MENU_HINT);
});

test("classifyStatusSaveFailure: a 422 with undefined envelopeError falls back to SAVE_FAILED_MESSAGE + REFRESH_MENU_HINT (unchanged)", () => {
  const result = classifyStatusSaveFailure(422, undefined);
  assert.equal(result, SAVE_FAILED_MESSAGE + REFRESH_MENU_HINT);
});

// PARITY PIN — SOLD_OUT_PATTERN (the component module's own local literal,
// per the PROMO_MIN_SUBTOTAL_PATTERN idiom) must match exactly what the
// route's real SOLD_OUT_ERROR template produces. Only THIS test file may
// import @/lib/public-pricing — the component module itself is forbidden
// from importing it (public-surface-paths.test.ts pin 8 walks components/public/**).
test("PARITY: SOLD_OUT_PATTERN matches SOLD_OUT_ERROR(name) for names incl. quotes and ₹/spaces", () => {
  const names = [
    "Paneer Tikka",
    'Chef\'s "Special" Thali',
    "₹99 Combo Meal",
  ];
  for (const name of names) {
    const message = SOLD_OUT_ERROR(name);
    assert.match(message, SOLD_OUT_PATTERN, `SOLD_OUT_PATTERN must match ${JSON.stringify(message)}`);
  }
});

// CR2.5 review F4 — createProductSchema.name is z.string().trim().min(1):
// interior newlines are LEGAL (trim only strips the ends), so the pattern
// must match a sold-out message whose name wraps across lines. `.` without
// the s flag excludes \n — [\s\S] is the required character class.
test("PARITY: SOLD_OUT_PATTERN matches SOLD_OUT_ERROR(name) when the name contains an interior newline", () => {
  const message = SOLD_OUT_ERROR("Iced\nMatcha");
  assert.match(message, SOLD_OUT_PATTERN, `SOLD_OUT_PATTERN must match ${JSON.stringify(message)}`);
  assert.equal(
    classifyStatusSaveFailure(422, message),
    message + SOLD_OUT_EDIT_HINT,
    "a newline-named sold-out 422 must still get the remove-that-item hint, not the refresh dead-end",
  );
});

// CR2.5 review F2 — the PATCH's promo resolver can 422 with PROMO_SESSION_OPEN
// (order-request-edit.ts:180) and PROMO_ALREADY_USED (:198). Both are promo
// rejections and must ride the ON-THE-FIELD contract (PublicStatusItems.tsx
// routes on isPromoErrorMessage) — falling through to the generic banner
// appended REFRESH_MENU_HINT to copy that refresh can never fix ("ask the
// staff… Please refresh the menu").
test("isPromoErrorMessage: PROMO_SESSION_OPEN and PROMO_ALREADY_USED are promo rejections (field-routed, never the refresh banner)", () => {
  assert.equal(isPromoErrorMessage(PROMO_SESSION_OPEN), true);
  assert.equal(isPromoErrorMessage(PROMO_ALREADY_USED), true);
  // The sold-out shape must never be classified as a promo rejection.
  assert.equal(isPromoErrorMessage(SOLD_OUT_ERROR("Paneer Tikka")), false);
});

test("SOLD_OUT_PATTERN must NOT match unrelated messages", () => {
  assert.doesNotMatch("Paneer Tikka is sold out", SOLD_OUT_PATTERN, "no surrounding quotes — must not match");
  assert.doesNotMatch("Please wait a moment and try again.", SOLD_OUT_PATTERN);
  assert.doesNotMatch("Add ₹50 more to use this code", SOLD_OUT_PATTERN, "promo message — must not match");
  assert.doesNotMatch("This promo code is no longer active", SOLD_OUT_PATTERN);
});
