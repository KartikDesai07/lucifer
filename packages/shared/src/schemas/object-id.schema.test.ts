import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OBJECT_ID_HEX_PATTERN,
  objectIdString,
  isObjectIdString,
} from "./object-id.schema";

// CB-DL-2 D-A 3 — every id the client sees is server-serialised lower-case
// hex (Mongo ObjectId.toString()), so the pattern/schema/guard here are the
// ONE place that contract is expressed; every other place that needs to
// recognise an id string reuses this rather than re-rolling the regex.

const VALID = "64b7f0c2a1d2e3f4a5b6c7d8"; // 24 lower-case hex

// ── OBJECT_ID_HEX_PATTERN ────────────────────────────────────────────────────

test("OBJECT_ID_HEX_PATTERN accepts a 24-char lower-case hex string", () => {
  assert.equal(OBJECT_ID_HEX_PATTERN.test(VALID), true);
});

test("OBJECT_ID_HEX_PATTERN rejects upper-case hex — the platform never serves upper-case ids", () => {
  assert.equal(OBJECT_ID_HEX_PATTERN.test(VALID.toUpperCase()), false);
});

test("OBJECT_ID_HEX_PATTERN rejects 23 and 25 character strings", () => {
  assert.equal(OBJECT_ID_HEX_PATTERN.test(VALID.slice(0, 23)), false);
  assert.equal(OBJECT_ID_HEX_PATTERN.test(VALID + "a"), false);
});

test("OBJECT_ID_HEX_PATTERN rejects an empty string", () => {
  assert.equal(OBJECT_ID_HEX_PATTERN.test(""), false);
});

test("OBJECT_ID_HEX_PATTERN rejects a 24-char string containing a non-hex character", () => {
  const notHex = "g".repeat(24);
  assert.equal(OBJECT_ID_HEX_PATTERN.test(notHex), false);
  const oneBadChar = VALID.slice(0, 23) + "g";
  assert.equal(OBJECT_ID_HEX_PATTERN.test(oneBadChar), false);
});

// ── isObjectIdString ─────────────────────────────────────────────────────────

test("isObjectIdString guards a valid id and narrows the type", () => {
  const v: unknown = VALID;
  assert.equal(isObjectIdString(v), true);
});

test("isObjectIdString rejects non-string values without throwing", () => {
  assert.equal(isObjectIdString(12345), false);
  assert.equal(isObjectIdString(null), false);
  assert.equal(isObjectIdString(undefined), false);
  assert.equal(isObjectIdString({}), false);
  assert.equal(isObjectIdString([]), false);
});

test("isObjectIdString rejects an upper-case or malformed string", () => {
  assert.equal(isObjectIdString(VALID.toUpperCase()), false);
  assert.equal(isObjectIdString("not-an-id"), false);
});

// ── objectIdString (Zod schema) ──────────────────────────────────────────────

test("objectIdString parses a valid 24-char lower-case hex string", () => {
  const r = objectIdString.safeParse(VALID);
  assert.equal(r.success, true);
  assert.equal(r.success && r.data, VALID);
});

test("objectIdString rejects an invalid value with message 'Invalid id'", () => {
  const r = objectIdString.safeParse("not-an-id");
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues[0]?.message, "Invalid id");
  }
});

test("objectIdString rejects upper-case hex with message 'Invalid id'", () => {
  const r = objectIdString.safeParse(VALID.toUpperCase());
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues[0]?.message, "Invalid id");
  }
});
