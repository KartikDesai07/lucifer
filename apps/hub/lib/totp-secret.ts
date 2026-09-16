import {
  currentKekVersion,
  decryptSecretRecord,
  encryptSecretRecord,
  kekForVersion,
  rewrapDekFields,
  VaultError,
  type EncryptedSecretFields,
  type SecretIdentity,
  type WrappedDekFields,
} from "@/lib/vault-core";

// ─────────────────────────────────────────────────────────────────────────────
// TOTP-secret at-rest crypto (F3.4). The owner's TOTP shared secret is the seed
// to the panel's primary 2FA — it must never sit in the registry as plaintext.
// It is NOT a tenant cloud credential, so it does NOT live in the `Secret`
// collection; it is stored inline on `HubUser.totpSecretEnc` (select:false).
// But it reuses the SAME reviewed envelope crypto (lib/vault-core): a fresh DEK
// per record, DEK wrapped under the env KEK map, AAD binding.
//
// AAD identity binds the ciphertext to THIS user + purpose:
//   tenantId    = the HubUser _id (hex)   — a cross-user swap fails the binding
//   provider    = 'hub-totp'              — a swap with a tenant Secret fails it
//   accountLabel= 'owner'
// A leaked-DB attacker who copies user A's totpSecretEnc onto user B cannot
// decrypt it against B's identity (decryptSecretRecord re-derives + checks AAD).
//
// This module NEVER logs — the base32 TOTP seed flows through it (eslint
// no-console override + source-scan test, like the vault).
// ─────────────────────────────────────────────────────────────────────────────

const TOTP_PROVIDER = "hub-totp";
const TOTP_LABEL = "owner";

/** The serialized on-disk shape of an encrypted TOTP secret (all base64 + the
 * KEK version). Stored as a JSON string in HubUser.totpSecretEnc. */
type StoredTotpSecret = EncryptedSecretFields;

function identityFor(hubUserId: string): SecretIdentity {
  if (!hubUserId) throw new VaultError("hubUserId is required to bind the TOTP secret");
  return { tenantId: hubUserId, provider: TOTP_PROVIDER, accountLabel: TOTP_LABEL };
}

/** Encrypt a base32 TOTP seed for storage on the given HubUser. Returns the
 * JSON string to persist in `totpSecretEnc`. */
export function encryptTotpSecret(hubUserId: string, secretBase32: string): string {
  const keyVersion = currentKekVersion();
  const kek = kekForVersion(keyVersion);
  const fields = encryptSecretRecord(identityFor(hubUserId), secretBase32, kek, keyVersion);
  return JSON.stringify(fields);
}

/** Decrypt the stored TOTP secret back to its base32 seed. Throws VaultError on
 * a wrong KEK, a tampered record, or an identity mismatch (cross-user swap). */
export function decryptTotpSecret(hubUserId: string, stored: string): string {
  let fields: StoredTotpSecret;
  try {
    fields = JSON.parse(stored) as StoredTotpSecret;
  } catch {
    throw new VaultError("stored TOTP secret is not valid JSON — record corrupted");
  }
  const kek = kekForVersion(fields.keyVersion);
  return decryptSecretRecord({ ...fields, ...identityFor(hubUserId) }, kek);
}

/**
 * If the stored secret was wrapped under a now-retired KEK version, re-wrap its
 * DEK under the CURRENT version and return the new JSON string; otherwise return
 * null (no change needed). Mirrors the vault's rotateKEK but for the single
 * inline TOTP field, so `rotateKEK` (which sweeps only `Secret`) does not strand
 * the owner's 2FA on an old KEK. The caller persists the result with a
 * pre-image guard. Payload fields are NEVER re-encrypted (rewrapDekFields).
 */
export function rewrapTotpSecretIfStale(stored: string): string | null {
  const fields = JSON.parse(stored) as StoredTotpSecret;
  const current = currentKekVersion();
  if (fields.keyVersion === current) return null;

  const oldKek = kekForVersion(fields.keyVersion);
  const newKek = kekForVersion(current);
  const wrapOnly: WrappedDekFields = {
    wrappedDek: fields.wrappedDek,
    wrapIv: fields.wrapIv,
    wrapTag: fields.wrapTag,
    keyVersion: fields.keyVersion,
  };
  const rewrapped = rewrapDekFields(wrapOnly, oldKek, newKek, current);
  return JSON.stringify({ ...fields, ...rewrapped });
}
