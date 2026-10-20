import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { PIN_DEVICE_MAX, PIN_DEVICE_MAX_AGE_SECONDS } from "@pos/shared/staff-pin";
import {
  cookieValue,
  pinDeviceCookieOptions,
  pinDeviceKey,
  readPinDevice,
  rememberPerson,
  signPinDevice,
  type PinDevicePerson,
} from "./pin-device";

const key = pinDeviceKey("test-secret-one") as Buffer;
const otherKey = pinDeviceKey("test-secret-two") as Buffer;
const idOf = (n: number) => n.toString(16).padStart(24, "0");
const people: PinDevicePerson[] = [
  { id: idOf(1), at: 1000 },
  { id: idOf(2), at: 2000 },
];

function flip(s: string, i: number): string {
  return s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
}

test("pinDeviceKey derives 32 bytes and returns null without a secret", () => {
  assert.equal(key.length, 32, "32-byte key");
  assert.equal(pinDeviceKey(undefined), null, "no secret -> null");
  assert.equal(pinDeviceKey(""), null, "empty secret -> null");
  assert.notDeepEqual(key, otherKey, "different secrets give different keys");
});

test("sign then read round-trips", () => {
  const v = signPinDevice(people, key);
  assert.equal(v.split(".").length, 2, "exactly one dot");
  assert.deepEqual(readPinDevice(v, key), people, "round trip");
});

test("a one-character change in payload or signature gives null", () => {
  const v = signPinDevice(people, key);
  const [p, s] = v.split(".");
  assert.equal(readPinDevice(`${flip(p, 3)}.${s}`, key), null, "payload tampered");
  assert.equal(readPinDevice(`${p}.${flip(s, 3)}`, key), null, "signature tampered");
  assert.equal(readPinDevice(`${p}.${s.slice(1)}`, key), null, "short signature");
});

test("another key, no key, empty and garbage give null", () => {
  const v = signPinDevice(people, key);
  assert.equal(readPinDevice(v, otherKey), null, "other key");
  assert.equal(readPinDevice(v, null), null, "no key");
  assert.equal(readPinDevice(undefined, key), null, "undefined");
  assert.equal(readPinDevice("", key), null, "empty");
  assert.equal(readPinDevice("garbage", key), null, "no dot");
  assert.equal(readPinDevice("a.b.c", key), null, "two dots");
  assert.equal(readPinDevice("!!!.???", key), null, "undecodable");
});

test("a correctly signed but badly shaped payload gives null", () => {
  const forge = (obj: unknown) => {
    const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
    return `${p}.${createHmac("sha256", key).update(p).digest("base64url")}`;
  };
  assert.deepEqual(readPinDevice(forge({ v: 1, p: [[idOf(1), 5]] }), key), [{ id: idOf(1), at: 5 }], "control");
  assert.equal(readPinDevice(forge({ v: 2, p: [] }), key), null, "bad version");
  assert.equal(readPinDevice(forge({ v: 1, p: "x" }), key), null, "p not array");
  assert.equal(readPinDevice(forge({ v: 1, p: [["nothex", 5]] }), key), null, "bad id");
  assert.equal(readPinDevice(forge({ v: 1, p: [[idOf(1), -1]] }), key), null, "negative at");
  assert.equal(readPinDevice(forge({ v: 1, p: [[idOf(1), "5"]] }), key), null, "string at");
  assert.equal(readPinDevice(forge({ v: 1, p: [[idOf(1)]] }), key), null, "short entry");
  assert.equal(readPinDevice(forge({ v: 1, p: [[idOf(1), 5, 6]] }), key), null, "long entry");
  const max = Array.from({ length: PIN_DEVICE_MAX }, (_, i) => [idOf(i + 1), i]);
  assert.notEqual(readPinDevice(forge({ v: 1, p: max }), key), null, "30 ok");
  const over = Array.from({ length: PIN_DEVICE_MAX + 1 }, (_, i) => [idOf(i + 1), i]);
  assert.equal(readPinDevice(forge({ v: 1, p: over }), key), null, "31 rejected");
});

test("rememberPerson moves to front, dedupes, caps, never mutates", () => {
  const before = JSON.stringify(people);
  const r = rememberPerson(people, idOf(1), 9000);
  assert.deepEqual(r, [{ id: idOf(1), at: 9000 }, { id: idOf(2), at: 2000 }], "moved to front, new time");
  assert.equal(JSON.stringify(people), before, "input untouched");
  assert.deepEqual(rememberPerson(null, idOf(7), 5), [{ id: idOf(7), at: 5 }], "null input");
  let list: PinDevicePerson[] = [];
  for (let i = 1; i <= PIN_DEVICE_MAX + 5; i++) list = rememberPerson(list, idOf(i), i);
  assert.equal(list.length, PIN_DEVICE_MAX, "capped");
  assert.equal(list[0].id, idOf(PIN_DEVICE_MAX + 5), "newest first");
  assert.equal(list.some((p) => p.id === idOf(1)), false, "oldest dropped");
  assert.equal(new Set(list.map((p) => p.id)).size, list.length, "no duplicates");
});

test("cookieValue parses a header and ignores names that merely end with it", () => {
  assert.equal(cookieValue("a=1; pos-pin-device=xyz; b=2", "pos-pin-device"), "xyz", "middle");
  assert.equal(cookieValue("xpos-pin-device=bad; pos-pin-device=ok", "pos-pin-device"), "ok", "suffix name skipped");
  assert.equal(cookieValue("xpos-pin-device=bad", "pos-pin-device"), undefined, "suffix only");
  assert.equal(cookieValue(null, "pos-pin-device"), undefined, "null header");
  assert.equal(cookieValue("a=1", "pos-pin-device"), undefined, "absent");
});

test("pinDeviceCookieOptions values", () => {
  assert.deepEqual(
    pinDeviceCookieOptions(),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: PIN_DEVICE_MAX_AGE_SECONDS,
    },
    "options",
  );
});
