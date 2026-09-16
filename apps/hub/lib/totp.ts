import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { TOTP_DIGITS, TOTP_DRIFT_STEPS, TOTP_STEP_SECONDS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// TOTP — RFC 6238 (HOTP RFC 4226 over a time counter), pure Node `crypto`, NO new
// dependency. TOTP is F3.4's v1 PRIMARY 2FA (Auth.js v5's WebAuthn/passkey
// provider is still experimental — added later). HMAC-SHA1 is the RFC default and
// what every authenticator app (Google/Microsoft/Authy/1Password) implements;
// SHA1 here keys a fresh 20-byte secret per HMAC and is not a collision context.
//
// Verification returns the MATCHED time-step (not just a boolean) so the caller
// can enforce a monotonic replay guard (a code is single-use even within its
// ±1-step validity window — see HubUser.totpLastStep / lib/auth.ts).
//
// This module NEVER logs (plaintext TOTP secrets/URIs flow through it — eslint
// no-console override + the source-scan test cover it, like the vault).
// ─────────────────────────────────────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 §6

/** Encode bytes as unpadded RFC 4648 base32 (what authenticator apps expect in
 * the `secret=` of an otpauth:// URI). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/** Decode an RFC 4648 base32 string (padding + casing + spaces tolerated).
 * Throws on any non-alphabet character — a malformed stored secret must fail
 * loudly, never silently decode to the wrong bytes. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh TOTP secret: 20 bytes (160 bits — RFC 4226 recommended, SHA1 block-
 * aligned), returned base32-encoded for enrolment. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226): the `digits`-length code for one counter value. */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter. JS bitwise ops are 32-bit, so split the halves.
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** The current time-step (counter) for a unix-ms timestamp. */
export function totpStep(nowMs: number, stepSeconds: number = TOTP_STEP_SECONDS): number {
  return Math.floor(nowMs / 1000 / stepSeconds);
}

/** Generate the code for a given step — used by tests and the enrol preview. */
export function totpCodeForStep(
  secretBase32: string,
  step: number,
  digits: number = TOTP_DIGITS,
): string {
  return hotp(base32Decode(secretBase32), step, digits);
}

/**
 * Verify a submitted code against a base32 secret within ±drift steps of `now`.
 * Returns the matched step on success (so the caller can enforce single-use /
 * replay protection: reject any step ≤ the last accepted step) or null on no
 * match. Constant-time per-candidate compare (`timingSafeEqual`) so a timing
 * side-channel can't reveal how close a guess was.
 */
export function verifyTotp(
  secretBase32: string,
  submittedCode: string,
  nowMs: number,
  opts: { digits?: number; stepSeconds?: number; drift?: number } = {},
): number | null {
  const digits = opts.digits ?? TOTP_DIGITS;
  const stepSeconds = opts.stepSeconds ?? TOTP_STEP_SECONDS;
  const drift = opts.drift ?? TOTP_DRIFT_STEPS;

  const submitted = submittedCode.trim();
  if (!/^[0-9]+$/u.test(submitted) || submitted.length !== digits) return null;

  const secret = base32Decode(secretBase32);
  const center = totpStep(nowMs, stepSeconds);
  const submittedBuf = Buffer.from(submitted, "utf8");
  // Oldest→newest so a code straddling a boundary resolves to a stable step;
  // the replay guard rejects re-use regardless of which step matched.
  for (let offset = -drift; offset <= drift; offset += 1) {
    const step = center + offset;
    if (step < 0) continue;
    const candidate = Buffer.from(hotp(secret, step, digits), "utf8");
    if (candidate.length === submittedBuf.length && timingSafeEqual(candidate, submittedBuf)) {
      return step;
    }
  }
  return null;
}

/** The otpauth:// URI an authenticator app scans (issuer + account label). */
export function totpAuthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
