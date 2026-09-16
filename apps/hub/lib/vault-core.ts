import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// vault-core — the PURE half of the ONE reviewed crypto module (F3.2/F3.3,
// fed-secrets-vault.json §A/§B/§C). No DB, no I/O beyond process.env: every
// function here is DB-free unit-testable, including all tamper cases. The DB
// layer (storeSecret/getSecret/rotateKEK/rotateCred) lives in lib/vault.ts,
// which re-exports this module — `@/lib/vault` stays the single import surface.
// Nothing here may log — plaintext flows through (no-console gate + scan test).
//
// KEK map (§C, zero-downtime rotation): `HUB_KEK` is ALWAYS the CURRENT KEK
// (new records wrap under it), `HUB_KEK_VERSION` (default 1) says which
// version it is, and `HUB_KEK_V<n>` holds a RETIRED KEK kept only until
// rotateKEK migrates every record off version n — so mid-rotation the map is
// {v1: HUB_KEK_V1, v2: HUB_KEK}: old reads keep working, new writes use v2.
// ─────────────────────────────────────────────────────────────────────────────

const DEK_BYTES = 32; // AES-256 key
const IV_BYTES = 12; // 96-bit GCM nonce (the GCM-correct size)
const TAG_BYTES = 16; // full 128-bit GCM auth tag — never accept less
const KEK_BYTES = 32;

/** Vault failures never carry plaintext or key material in the message. */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

// ── KEK map ──────────────────────────────────────────────────────────────────

/** The KEK version new records are wrapped under: `HUB_KEK_VERSION`, default 1. */
export function currentKekVersion(): number {
  const raw = process.env.HUB_KEK_VERSION?.trim();
  if (raw === undefined || raw === "") return 1;
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new VaultError("HUB_KEK_VERSION must be a positive integer");
  }
  return version;
}

/**
 * Resolve the raw KEK material for a version: the CURRENT version reads
 * `HUB_KEK` (mark it "sensitive" on Vercel — the post-April-2026-breach
 * default); a retired version reads `HUB_KEK_V<n>`, which stays configured
 * only until rotateKEK has migrated every record off it. Retire ≠ destroy:
 * keep retired KEKs escrowed OFFLINE — a mongodump restore of pre-rotation
 * data carries the old keyVersion and needs its KEK again.
 *
 * HKDF-split hook (fed-secrets-vault.json §F, deliberately NOT built yet):
 * to take a KEK out of any single host's blast radius, store HALF here and
 * fetch the second half at boot from a second free provider, then combine via
 * `hkdfSync('sha256', envHalf ‖ secondHalf, salt, 'hub-kek', 32)` IN MEMORY —
 * neither a DB dump nor a single env dump reconstructs it. This function is
 * the single seam where that combine would land.
 */
function resolveKekMaterial(version: number): { raw: string; envVar: string } {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new VaultError(`invalid KEK version ${version}`);
  }
  if (version === currentKekVersion()) {
    const raw = process.env.HUB_KEK;
    if (!raw) throw new VaultError("HUB_KEK environment variable is not set");
    // Ambiguity guard: two DIFFERENT keys both claiming the current version is
    // a half-finished env edit (e.g. HUB_KEK flipped, version bump forgotten) —
    // fail closed rather than wrap new records under a contested version.
    const dup = process.env[`HUB_KEK_V${version}`];
    if (dup !== undefined && dup.trim() !== raw.trim()) {
      throw new VaultError(
        `HUB_KEK_V${version} conflicts with HUB_KEK — both claim version ${version}; fix the env before any crypto op`,
      );
    }
    return { raw, envVar: "HUB_KEK" };
  }
  const envVar = `HUB_KEK_V${version}`;
  const raw = process.env[envVar];
  if (!raw) {
    throw new VaultError(
      `unknown KEK version ${version} — set ${envVar} (a retired KEK stays configured until rotateKEK has migrated every record off it)`,
    );
  }
  return { raw, envVar };
}

/** Decode + validate the KEK for a keyVersion: base64 or hex, exactly 32 bytes. */
export function kekForVersion(version: number): Buffer {
  const { raw, envVar } = resolveKekMaterial(version);
  const trimmed = raw.trim();
  // A 64-char hex string is also valid base64 (to 48 bytes), so test hex FIRST.
  const kek = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (kek.length !== KEK_BYTES) {
    throw new VaultError(`${envVar} must decode to exactly 32 bytes (base64 or hex)`);
  }
  return kek;
}

// ── Identity / AAD ───────────────────────────────────────────────────────────

export interface SecretIdentity {
  tenantId: string; // ObjectId hex string
  provider: string;
  accountLabel: string;
}

/** The persisted crypto fields (§A step 9) — every buffer as base64 text. */
export interface EncryptedSecretFields {
  ciphertext: string;
  iv: string;
  tag: string;
  aad: string;
  wrappedDek: string;
  wrapIv: string;
  wrapTag: string;
  keyVersion: number;
}

/** The wrap-only subset §C touches — payload fields are excluded BY TYPE, so
 * rotateKEK cannot re-encrypt (or even read) ciphertext/iv/tag/aad. */
export interface WrappedDekFields {
  wrappedDek: string;
  wrapIv: string;
  wrapTag: string;
  keyVersion: number;
}

/**
 * AAD = utf8("tenantId|provider|accountLabel"). tenantId (ObjectId hex) and
 * provider (enum) can never contain "|", and accountLabel is the LAST component
 * — so the encoding is unambiguous. Guarded anyway: a "|" smuggled into either
 * delimited component could otherwise forge a colliding binding.
 */
export function buildAad(identity: SecretIdentity): Buffer {
  const { tenantId, provider, accountLabel } = identity;
  if (!tenantId || !provider || !accountLabel) {
    throw new VaultError("AAD identity fields must all be non-empty");
  }
  if (tenantId.includes("|") || provider.includes("|")) {
    throw new VaultError('AAD identity fields must not contain "|"');
  }
  return Buffer.from(`${tenantId}|${provider}|${accountLabel}`, "utf8");
}

/** The KEK-wrap AAD binds the wrap to its key version (§A step 7). */
function wrapAad(keyVersion: number): Buffer {
  return Buffer.from(`dek|${keyVersion}`, "utf8");
}

/**
 * Decode a stored base64 crypto field, REQUIRING its exact byte length.
 * Buffer.from(b64) decodes leniently (truncated input → a shorter buffer, no
 * throw), and Node accepts SHORT GCM auth tags (4/8/12B) when authTagLength
 * isn't pinned — so without this gate, an attacker with DB write access could
 * truncate a stored tag and cut forgery cost from 2^128 to 2^32 (proven by a
 * live probe on Node v22.13.1). Belt-and-braces with `authTagLength` below.
 */
function b64Field(name: string, value: string, expectedBytes: number): Buffer {
  const buf = Buffer.from(value, "base64");
  if (buf.length !== expectedBytes) {
    throw new VaultError(`crypto field '${name}' has the wrong length — record tampered or corrupted`);
  }
  return buf;
}

// ── DEK wrap / unwrap — the §A.7/§B.2 primitives shared by encrypt, decrypt,
// AND rewrap, so there is exactly ONE implementation of each ─────────────────

function wrapDek(dek: Buffer, kek: Buffer, keyVersion: number): WrappedDekFields {
  const wrapIv = randomBytes(IV_BYTES);
  const wrapper = createCipheriv("aes-256-gcm", kek, wrapIv);
  wrapper.setAAD(wrapAad(keyVersion));
  const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
  return {
    wrappedDek: wrappedDek.toString("base64"),
    wrapIv: wrapIv.toString("base64"),
    wrapTag: wrapper.getAuthTag().toString("base64"),
    keyVersion,
  };
}

/** Caller MUST zeroize the returned DEK (`dek.fill(0)`) in a `finally`. */
function unwrapDek(fields: WrappedDekFields, kek: Buffer): Buffer {
  const wrapIv = b64Field("wrapIv", fields.wrapIv, IV_BYTES);
  const wrapTag = b64Field("wrapTag", fields.wrapTag, TAG_BYTES);
  const wrappedDek = b64Field("wrappedDek", fields.wrappedDek, DEK_BYTES);
  try {
    const unwrapper = createDecipheriv("aes-256-gcm", kek, wrapIv, { authTagLength: TAG_BYTES });
    unwrapper.setAAD(wrapAad(fields.keyVersion));
    unwrapper.setAuthTag(wrapTag);
    return Buffer.concat([
      unwrapper.update(wrappedDek),
      unwrapper.final(), // throws if the KEK is wrong or any wrap field was tampered
    ]);
  } catch (err) {
    if (err instanceof VaultError) throw err;
    throw new VaultError("DEK unwrap failed — wrong KEK or tampered wrap fields");
  }
}

// ── §A encrypt / §B decrypt / §C rewrap ──────────────────────────────────────

/** §A: encrypt one credential under a fresh DEK, wrap the DEK under the KEK. */
export function encryptSecretRecord(
  identity: SecretIdentity,
  plaintext: string,
  kek: Buffer,
  keyVersion: number,
): EncryptedSecretFields {
  if (!plaintext) throw new VaultError("refusing to store an empty secret");
  const aad = buildAad(identity);

  const dek = randomBytes(DEK_BYTES);
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      aad: aad.toString("base64"),
      ...wrapDek(dek, kek, keyVersion),
    };
  } finally {
    dek.fill(0); // §A step 8 — the unwrapped DEK never outlives this call
  }
}

/**
 * §B: decrypt one record. Throws VaultError on ANY mismatch: wrong KEK,
 * tampered wrap fields, tampered ciphertext/tag/aad, or identity fields that
 * no longer match the AAD captured at encrypt time (cross-tenant swap).
 */
export function decryptSecretRecord(
  record: EncryptedSecretFields & SecretIdentity,
  kek: Buffer,
): string {
  // The stored AAD must equal the AAD re-derived from the record's OWN identity
  // fields — otherwise a leaked-DB attacker could re-point a record at another
  // tenant/provider while keeping the (self-consistent) crypto fields intact.
  const storedAad = Buffer.from(record.aad, "base64");
  const expectedAad = buildAad(record);
  if (storedAad.length !== expectedAad.length || !timingSafeEqual(storedAad, expectedAad)) {
    throw new VaultError("AAD binding mismatch — identity fields do not match the record's AAD");
  }

  // Exact-length gate on every fixed-size field BEFORE any crypto op (see
  // b64Field — kills the truncated-tag downgrade). Ciphertext length varies.
  const iv = b64Field("iv", record.iv, IV_BYTES);
  const tag = b64Field("tag", record.tag, TAG_BYTES);
  const ciphertext = Buffer.from(record.ciphertext, "base64");

  const dek = unwrapDek(record, kek);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(storedAad);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(), // throws if ciphertext, tag, or AAD was tampered
      ]).toString("utf8");
    } catch {
      throw new VaultError("decrypt failed — ciphertext, tag, or AAD does not authenticate");
    }
  } finally {
    dek.fill(0); // §B step 4 — plaintext is returned, the DEK never escapes
  }
}

/**
 * §C: re-wrap ONE record's DEK from its current KEK version to `toVersion` —
 * the cheap half of KEK rotation. The payload is NEVER re-encrypted: the
 * WrappedDekFields type cannot even carry ciphertext/iv/tag/aad, and the
 * plaintext credential is never touched. The DEK exists unwrapped only inside
 * this call. Same-version rewrap is refused — two different KEKs claiming one
 * version would make records indistinguishable.
 */
export function rewrapDekFields(
  fields: WrappedDekFields,
  oldKek: Buffer,
  newKek: Buffer,
  toVersion: number,
): WrappedDekFields {
  if (toVersion === fields.keyVersion) {
    throw new VaultError("rewrap target version must differ from the record's current version");
  }
  const dek = unwrapDek(fields, oldKek);
  try {
    return wrapDek(dek, newKek, toVersion);
  } finally {
    dek.fill(0);
  }
}
