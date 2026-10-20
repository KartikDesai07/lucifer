import { test } from "node:test";
import assert from "node:assert/strict";

import { pinKeyFromKeyboard, pinPadNext } from "@/lib/pin-pad";

test("pinPadNext: appends, caps at the length, deletes, clears", () => {
  assert.equal(pinPadNext("12", "3"), "123", "append");
  assert.equal(pinPadNext("1234", "5"), "1234", "full value ignores more digits");
  assert.equal(pinPadNext("123", "back"), "12", "back drops one");
  assert.equal(pinPadNext("", "back"), "", "back on empty");
  assert.equal(pinPadNext("123", "clear"), "", "clear empties");
  assert.equal(pinPadNext("12", "3", 3), "123", "custom length reached");
  assert.equal(pinPadNext("123", "4", 3), "123", "custom length caps");
});

test("pinKeyFromKeyboard: digits, Backspace, Delete; else null", () => {
  assert.equal(pinKeyFromKeyboard("7"), "7", "digit");
  assert.equal(pinKeyFromKeyboard("0"), "0", "zero");
  assert.equal(pinKeyFromKeyboard("Backspace"), "back", "Backspace");
  assert.equal(pinKeyFromKeyboard("Delete"), "clear", "Delete");
  assert.equal(pinKeyFromKeyboard("Escape"), null, "Escape is not ours");
  assert.equal(pinKeyFromKeyboard("a"), null, "letter");
  assert.equal(pinKeyFromKeyboard("12"), null, "multi-char");
});
