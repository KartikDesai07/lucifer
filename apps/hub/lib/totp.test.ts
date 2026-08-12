import { test } from "node:test";
import assert from "node:assert/strict";

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpAuthUri,
  totpCodeForStep,
  totpStep,
  verifyTotp,
} from "./totp";

// DB-free tests for the RFC 6238 TOTP core (F3.4 v1-primary 2FA). Validated
// against the RFC 6238 Appendix-B SHA1 test vectors so the hand-rolled HOTP is
// provably interoperable with real authenticator apps (Google/Microsoft/Authy).

// RFC 6238 test secret: ASCII "12345678901234567890" (20 bytes), whose canonical
// base32 is the well-known value below (external reference for base32Encode).
const RFC_ASCII = "12345678901234567890";
const RFC_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32Encode matches the canonical RFC 4648 encoding of the RFC 6238 secret", () => {
  assert.equal(base32Encode(Buffer.from(RFC_ASCII, "ascii")), RFC_B32);
});

test("base32 round-trips arbitrary bytes and tolerates padding/case/spaces", () => {
  assert.equal(base32Decode(RFC_B32).toString("ascii"), RFC_ASCII);
  const bytes = Buffer.from([0x00, 0xff, 0x10, 0x9a, 0x42, 0x7b, 0xc3]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  // lower-case + spaces + padding all decode to the same bytes
  assert.deepEqual(base32Decode("gezd gnbv==="), base32Decode("GEZDGNBV"));
});

test("base32Decode throws on a non-alphabet character (never silently mis-decodes)", () => {
  assert.throws(() => base32Decode("GEZD1NBV"), /invalid base32/); // '1' not in the alphabet
});

test("HOTP/TOTP matches the RFC 6238 Appendix-B 8-digit SHA1 vectors", () => {
  // [unix seconds, expected 8-digit TOTP]
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, expected] of vectors) {
    const step = totpStep(seconds * 1000);
    assert.equal(totpCodeForStep(RFC_B32, step, 8), expected, `t=${seconds}`);
  }
});

test("6-digit codes are the low 6 digits of the 8-digit vector", () => {
  // 94287082 % 1e6 = 287082
  assert.equal(totpCodeForStep(RFC_B32, totpStep(59_000), 6), "287082");
});

test("verifyTotp accepts the current code and returns the matched step", () => {
  const nowMs = 59_000;
  const step = totpStep(nowMs);
  assert.equal(verifyTotp(RFC_B32, "287082", nowMs), step); // 6-digit default
  assert.equal(verifyTotp(RFC_B32, "94287082", nowMs, { digits: 8 }), step);
});

test("verifyTotp honors the ±1 drift window but not step ±2", () => {
  const nowMs = 1_000_000_000_000; // arbitrary
  const center = totpStep(nowMs);
  assert.equal(verifyTotp(RFC_B32, totpCodeForStep(RFC_B32, center - 1), nowMs), center - 1);
  assert.equal(verifyTotp(RFC_B32, totpCodeForStep(RFC_B32, center + 1), nowMs), center + 1);
  assert.equal(verifyTotp(RFC_B32, totpCodeForStep(RFC_B32, center - 2), nowMs), null);
  assert.equal(verifyTotp(RFC_B32, totpCodeForStep(RFC_B32, center + 2), nowMs), null);
});

test("verifyTotp rejects wrong, wrong-length, and non-numeric codes", () => {
  const nowMs = 59_000;
  assert.equal(verifyTotp(RFC_B32, "000000", nowMs), null);
  assert.equal(verifyTotp(RFC_B32, "2870820", nowMs), null); // 7 digits
  assert.equal(verifyTotp(RFC_B32, "28708", nowMs), null); // 5 digits
  assert.equal(verifyTotp(RFC_B32, "abcdef", nowMs), null);
  assert.equal(verifyTotp(RFC_B32, "  287082  ", nowMs), totpStep(nowMs)); // trims
});

test("generateTotpSecret yields a fresh 20-byte (32-char base32) secret", () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  assert.equal(a.length, 32);
  assert.equal(base32Decode(a).length, 20);
  assert.notEqual(a, b);
});

test("totpAuthUri embeds issuer, account, secret and SHA1/6/30 params", () => {
  const uri = totpAuthUri(RFC_B32, "owner", "POS Hub");
  assert.match(uri, /^otpauth:\/\/totp\/POS%20Hub%3Aowner\?/u);
  assert.match(uri, new RegExp(`secret=${RFC_B32}`));
  assert.match(uri, /issuer=POS\+Hub/u);
  assert.match(uri, /algorithm=SHA1/u);
  assert.match(uri, /digits=6/u);
  assert.match(uri, /period=30/u);
});
