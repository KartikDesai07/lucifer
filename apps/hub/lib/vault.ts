import type { Types } from "mongoose";

import {
  Secret,
  type SecretClassification,
  type SecretProvider,
} from "@/models/Secret";
import { AuditLog } from "@/models/AuditLog";
import { connectDB } from "@/lib/db";
import { sweepHubUserTotp } from "@/lib/totp-rotate";
import {
  VaultError,
  currentKekVersion,
  decryptSecretRecord,
  encryptSecretRecord,
  kekForVersion,
  rewrapDekFields,
  type SecretIdentity,
} from "./vault-core";

// ─────────────────────────────────────────────────────────────────────────────
// vault — the DB half of the ONE reviewed crypto module (F3.2/F3.3,
// fed-secrets-vault.json §A–§D). The pure crypto core lives in vault-core.ts
// (re-exported below, so `@/lib/vault` stays the single import surface); this
// file is the ONLY code that touches `Secret` crypto fields. Envelope: per-record
// DEK + 12B IV, AES-256-GCM, AAD = "tenantId|provider|accountLabel", DEK stored
// ONLY wrapped under the env KEK map (never in the DB). Nothing here may log —
// plaintext creds flow through it (eslint `no-console` override + scan test).
// ─────────────────────────────────────────────────────────────────────────────

export * from "./vault-core";

export interface StoreSecretInput {
  tenantId: Types.ObjectId | string;
  provider: SecretProvider;
  accountLabel: string;
  classification: SecretClassification;
  scope?: string;
}

/** Who is acting, for the append-only audit row (§B step 4 / AuditLog). */
export interface VaultAuditContext {
  actorId: Types.ObjectId | string;
  ip: string;
}

/** §A: encrypt + persist. Returns ONLY the new Secret _id — never echoes
 * plaintext or crypto fields back. */
export async function storeSecret(
  input: StoreSecretInput,
  plaintext: string,
): Promise<Types.ObjectId> {
  await connectDB();
  // Normalize BEFORE the AAD — the schema trims accountLabel on save, and an
  // untrimmed label in the AAD would break the binding check on read.
  const accountLabel = input.accountLabel.trim();
  const identity: SecretIdentity = { tenantId: String(input.tenantId), provider: input.provider, accountLabel };
  const keyVersion = currentKekVersion();
  const kek = kekForVersion(keyVersion);
  const fields = encryptSecretRecord(identity, plaintext, kek, keyVersion);
  const doc = await Secret.create({
    tenantId: input.tenantId,
    provider: input.provider,
    accountLabel,
    classification: input.classification,
    ...(input.scope ? { scope: input.scope } : {}),
    ...fields,
  });
  return doc._id as Types.ObjectId;
}

export interface GetSecretOptions {
  /** Forensics-only escape hatch: reveal a record whose provider key was already
   * revoked (ciphertext is KEPT for audit, §D step 4). Default false — a runtime
   * path holding a stale ref must fail, not silently use a dead credential. */
  allowRevoked?: boolean;
}

/**
 * §B: reveal a secret JUST-IN-TIME. Fail-closed: the audit row is written (and
 * lastUsedAt stamped) BEFORE plaintext is returned, so an unaudited reveal is
 * impossible. Callers hold plaintext for the single op only — never re-persist/log.
 */
export async function getSecret(
  secretId: Types.ObjectId | string,
  audit: VaultAuditContext,
  options: GetSecretOptions = {},
): Promise<string> {
  await connectDB();
  const doc = await Secret.findById(secretId).lean();
  if (!doc) throw new VaultError("secret not found");
  // Legacy F3.2 rows have no status field — absent means active.
  if (doc.status === "revoked" && !options.allowRevoked) {
    throw new VaultError("secret is revoked — pass allowRevoked for a forensic reveal");
  }

  const kek = kekForVersion(doc.keyVersion);
  const plaintext = decryptSecretRecord(
    {
      tenantId: String(doc.tenantId),
      provider: doc.provider,
      accountLabel: doc.accountLabel,
      ciphertext: doc.ciphertext,
      iv: doc.iv,
      tag: doc.tag,
      aad: doc.aad,
      wrappedDek: doc.wrappedDek,
      wrapIv: doc.wrapIv,
      wrapTag: doc.wrapTag,
      keyVersion: doc.keyVersion,
    },
    kek,
  );

  await AuditLog.create({
    actorId: audit.actorId,
    action: "secret.reveal",
    targetTenantId: doc.tenantId,
    secretId: doc._id,
    ip: audit.ip,
  });
  await Secret.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } });

  return plaintext;
}

// ── F3.3 §C — KEK rotation ───────────────────────────────────────────────────

export interface RotateKekResult {
  toVersion: number;
  scanned: number; // records found off the current version
  rotated: number; // DEKs re-wrapped by THIS run
  failed: Array<{ secretId: string; keyVersion: number; error: string }>;
  remaining: number; // still off-version after the sweep; 0 ⇒ old KEKs retirable
}

/**
 * §C: migrate every record to the CURRENT KEK version by re-wrapping its DEK
 * only — payloads are never re-encrypted (rewrapDekFields cannot even see
 * them), and no plaintext credential is ever decrypted. Zero-downtime: run
 * AFTER the env flip (HUB_KEK=new, HUB_KEK_VERSION=n+1, HUB_KEK_V<n>=old) —
 * reads keep resolving old records through the key map while this sweeps.
 * Idempotent + resumable: matches `keyVersion != current`, each write is guarded
 * on the record's pre-image, per-record failure is reported not thrown. Retire
 * HUB_KEK_V<n> only when `remaining` is 0. Fleet-sized N — sequential is well
 * inside the 8s rule.
 */
export async function rotateKEK(audit: VaultAuditContext): Promise<RotateKekResult> {
  await connectDB();
  const toVersion = currentKekVersion();
  const newKek = kekForVersion(toVersion); // fail fast before touching any record

  // Sweep EVERY off-version record regardless of status — revoked ciphertext
  // is kept for audit (§D) and must stay decryptable after the old KEK retires.
  const docs = await Secret.find({ keyVersion: { $ne: toVersion } })
    .select("wrappedDek wrapIv wrapTag keyVersion")
    .lean();

  let rotated = 0;
  const failed: RotateKekResult["failed"] = [];
  for (const doc of docs) {
    try {
      const oldKek = kekForVersion(doc.keyVersion);
      const rewrapped = rewrapDekFields(
        {
          wrappedDek: doc.wrappedDek,
          wrapIv: doc.wrapIv,
          wrapTag: doc.wrapTag,
          keyVersion: doc.keyVersion,
        },
        oldKek,
        newKek,
        toVersion,
      );
      // Guarded on the pre-image: a concurrent rotation of the same record
      // loses the race cleanly (matchedCount 0) — never a mixed wrap.
      const res = await Secret.updateOne(
        { _id: doc._id, keyVersion: doc.keyVersion, wrapTag: doc.wrapTag },
        { $set: { ...rewrapped, rotatedAt: new Date() } },
      );
      if (res.matchedCount === 1) rotated += 1;
    } catch (err) {
      failed.push({
        secretId: String(doc._id),
        keyVersion: doc.keyVersion,
        // VaultError messages never carry key material; anything else is
        // reduced to a generic line rather than echoed.
        error: err instanceof VaultError ? err.message : "re-wrap failed",
      });
    }
  }

  const remaining = await Secret.countDocuments({ keyVersion: { $ne: toVersion } });

  // ALSO sweep the owner's inline TOTP secret — KEK-wrapped under the same map
  // but OUTSIDE `Secret`, so excluding it makes `remaining===0` a false
  // "retirable" signal. Folded into the counts (lib/totp-rotate.ts) to stay honest.
  const t = await sweepHubUserTotp(toVersion);
  await AuditLog.create({ actorId: audit.actorId, action: "kek.rotate", ip: audit.ip });
  return {
    toVersion,
    scanned: docs.length + t.scanned,
    rotated: rotated + t.rotated,
    failed: [...failed, ...t.failed],
    remaining: remaining + t.remaining,
  };
}

// ── F3.3 §D — tenant-credential rotation ─────────────────────────────────────

/** Provider/registry actions rotateCred orchestrates. The real implementations
 * arrive with the F3.5 provider clients (atlas/vercel/imagestore) + the F3.8
 * registry pointer flip; the vault owns only the ORDER and the Secret rows. */
export interface RotateCredHooks {
  /** §D.1 — mint the NEW scoped provider key (Atlas project key / image key /
   * Vercel token). */
  createKey(): Promise<{ plaintext: string; scope?: string }>;
  /** §D.3 — point the registry's active ref (the Tenant pool doc's *Ref) at
   * this Secret. Called with the NEW id on adoption — and back with the OLD id
   * if health-verify fails. */
  setActivePointer(secretId: Types.ObjectId): Promise<void>;
  /** §D.3 — probe the provider with the NEW credential (connect / GET usage).
   * Throw on failure. Hold the plaintext for the probe only — never persist or
   * log it. */
  healthVerify(plaintext: string): Promise<void>;
  /** §D.4 — revoke the OLD key at the provider. */
  revokeOldKey(): Promise<void>;
}

export interface RotateCredResult {
  newSecretId: Types.ObjectId;
  /** false ⇒ provider revocation failed: the old record is 'retired' (not
   * 'revoked') and the provider key must be revoked by retry/hand. */
  oldKeyRevoked: boolean;
}

/**
 * §D: create-new-scoped-key → storeSecret → flip active pointer → health-verify
 * → revoke-old. Old ciphertext is ALWAYS kept for audit (status → 'revoked'/
 * 'retired', never deleted). Health-verify failure flips the pointer BACK and
 * marks the never-adopted new record revoked (the caller owns revoking its
 * provider key). If only old-key revocation fails, the rotation still succeeded:
 * old → 'retired', reported. If storeSecret throws, the new key is orphaned —
 * the caller should revoke it.
 */
export async function rotateCred(
  oldSecretId: Types.ObjectId | string,
  hooks: RotateCredHooks,
  audit: VaultAuditContext,
): Promise<RotateCredResult> {
  await connectDB();
  const old = await Secret.findById(oldSecretId).lean();
  if (!old) throw new VaultError("secret not found");
  if (old.status === "revoked") throw new VaultError("cannot rotate a revoked secret");

  // §D.1–2: mint the new scoped key, store it under the SAME identity.
  const { plaintext, scope } = await hooks.createKey();
  const newSecretId = await storeSecret(
    {
      tenantId: old.tenantId,
      provider: old.provider,
      accountLabel: old.accountLabel,
      classification: old.classification,
      ...(scope ? { scope } : {}),
    },
    plaintext,
  );

  // §D.3: flip the active pointer, then health-verify THROUGH the new cred.
  await hooks.setActivePointer(newSecretId);
  try {
    await hooks.healthVerify(plaintext);
  } catch {
    await hooks.setActivePointer(old._id);
    await Secret.updateOne({ _id: newSecretId }, { $set: { status: "revoked" } });
    throw new VaultError(
      "health-verify failed with the new credential — active pointer rolled back to the old one",
    );
  }

  // §D.4: revoke the OLD provider key; keep its ciphertext for audit.
  let oldKeyRevoked = true;
  try {
    await hooks.revokeOldKey();
    await Secret.updateOne({ _id: old._id }, { $set: { status: "revoked" } });
  } catch {
    oldKeyRevoked = false;
    await Secret.updateOne({ _id: old._id }, { $set: { status: "retired" } });
  }

  await AuditLog.create({
    actorId: audit.actorId,
    action: "cred.rotate",
    targetTenantId: old.tenantId,
    secretId: old._id,
    ip: audit.ip,
  });
  return { newSecretId, oldKeyRevoked };
}
