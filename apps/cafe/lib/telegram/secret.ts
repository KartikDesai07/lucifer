import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// CR2.3b §21.2 #1 — the token-at-rest envelope for Telegram credentials
// (models/Settings.ts's telegramBotTokenEnc / telegramWebhookSecretEnc).
// Pure node:crypto, no DB, no fetch — every function here is DB-free
// unit-testable. NEVER throws: any failure (missing key material, tampered
// envelope, wrong purpose) returns null, and no error path may echo the
// plaintext, the envelope, or any fragment of either — only
// lib/telegram/config.ts calls these, and it never logs.
//
// Key derivation deliberately mirrors apps/hub/lib/vault-core.ts's naming
// (IV_BYTES/TAG_BYTES/KEY_BYTES, the exact-length gate before any crypto op)
// but does NOT import from hub — a cafe request path must never depend on
// hub code. HKDF over `AUTH_SECRET ?? NEXTAUTH_SECRET` (this exact order
// mirrors Auth.js's own env fallback; the deployed cafe sets
// NEXTAUTH_SECRET) with a per-purpose `info` string, so a bot-token envelope
// can never be opened as a webhook-secret envelope even under the same
// derived-key family (§21.0.2).

const IV_BYTES = 12; // 96-bit GCM nonce (the GCM-correct size)
const TAG_BYTES = 16; // full 128-bit GCM auth tag — never accept less
const KEY_BYTES = 32; // AES-256 key
const ENVELOPE_VERSION = "v1";
const ENVELOPE_PART_COUNT = 4; // "v1" + iv + tag + ciphertext
const HKDF_SALT = "pos-telegram-secret-v1";

export type TelegramSecretPurpose = "bot-token" | "webhook-secret";

/** utf8(`telegram|<purpose>`) — bound as BOTH the HKDF `info` and the GCM
 *  AAD, so a purpose mismatch fails the key derivation's intent and the
 *  cipher's own authentication. */
function purposeContext(purpose: TelegramSecretPurpose): string {
  return `telegram|${purpose}`;
}

/** The raw HKDF input key material: `AUTH_SECRET ?? NEXTAUTH_SECRET` — this
 *  exact order mirrors Auth.js's own env fallback (no new env var). Returns
 *  null (never throws) when neither is set, so every seal/open call degrades
 *  to "unavailable" instead of crashing a route. */
function ikm(): string | null {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function deriveKey(purpose: TelegramSecretPurpose): Buffer | null {
  const material = ikm();
  if (!material) return null;
  try {
    return Buffer.from(hkdfSync("sha256", material, HKDF_SALT, purposeContext(purpose), KEY_BYTES));
  } catch {
    return null;
  }
}

/**
 * Seal `plaintext` into a flat `v1:<b64 iv>:<b64 tag>:<b64 ciphertext>`
 * envelope string. Returns null (never throws) if key material is
 * unavailable or the cipher operation fails for any reason.
 */
export function sealSecret(plaintext: string, purpose: TelegramSecretPurpose): string | null {
  const key = deriveKey(purpose);
  if (!key) return null;
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(purposeContext(purpose), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENVELOPE_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
      ":",
    );
  } catch {
    return null;
  }
}

/**
 * Open a sealed envelope back into plaintext. Strict parse (exactly
 * ENVELOPE_PART_COUNT `:`-separated parts, version literal "v1"); the
 * decoded iv/tag are LENGTH-GATED to exactly IV_BYTES/TAG_BYTES BEFORE any
 * crypto call — Node ≤22's setAuthTag() accepts a truncated 4/8/12-byte tag
 * unless `authTagLength` is pinned, so skipping this gate would let a
 * tampered short tag pass. Any failure anywhere (bad shape, wrong purpose,
 * tampered ciphertext, missing key material) returns null — never throws,
 * never echoes the envelope. `envelope` is typed as `string`, but the value
 * actually read off a hand-edited Settings doc is not statically guaranteed
 * to be one — a non-string would throw out of `.split(":")` before the try
 * block below, so it is guarded here too.
 */
export function openSecret(envelope: string, purpose: TelegramSecretPurpose): string | null {
  const key = deriveKey(purpose);
  if (!key) return null;
  if (typeof envelope !== "string") return null;

  const parts = envelope.split(":");
  if (parts.length !== ENVELOPE_PART_COUNT || parts[0] !== ENVELOPE_VERSION) return null;
  const [, ivPart, tagPart, ciphertextPart] = parts;

  try {
    const iv = Buffer.from(ivPart, "base64");
    const tag = Buffer.from(tagPart, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const ciphertext = Buffer.from(ciphertextPart, "base64");

    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(purposeContext(purpose), "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
