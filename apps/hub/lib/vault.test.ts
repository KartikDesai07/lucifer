import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  VaultError,
  buildAad,
  decryptSecretRecord,
  encryptSecretRecord,
  kekForVersion,
  type EncryptedSecretFields,
  type SecretIdentity,
} from "./vault";

// The version fresh records get with no rotation env set (currentKekVersion()
// defaults to 1). Rotation/key-map coverage lives in vault-rotate.test.ts.
const KEY_VERSION = 1;

// DB-free tests for the F3.2 vault crypto core (fed-secrets-vault.json §A/§B).
// The DB layer (storeSecret/getSecret incl. the audit row + lastUsedAt stamp)
// is proven by the live scratch-M0 round-trip, per the hub verify protocol.

const KEK = randomBytes(32);
const IDENTITY: SecretIdentity = {
  tenantId: "665f1f77bcf86cd799439011",
  provider: "atlas",
  accountLabel: "atlas-1",
};
const PLAINTEXT = "mongodb+srv://user:sup3r-secret@cluster0.abcde.mongodb.net/pos";

function encrypted(
  overrides: Partial<SecretIdentity> = {},
): EncryptedSecretFields & SecretIdentity {
  const identity = { ...IDENTITY, ...overrides };
  return { ...identity, ...encryptSecretRecord(identity, PLAINTEXT, KEK, KEY_VERSION) };
}

/** Flip one byte in the middle of a base64 field. */
function corrupt(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[Math.floor(buf.length / 2)] ^= 0xff;
  return buf.toString("base64");
}

test("vault: encrypt → decrypt round-trips (incl. non-ASCII plaintext)", () => {
  assert.equal(decryptSecretRecord(encrypted(), KEK), PLAINTEXT);
  const odd = "p@ss|w0rd — ₹ ünïcode 🔐";
  const rec = { ...IDENTITY, ...encryptSecretRecord(IDENTITY, odd, KEK, 1) };
  assert.equal(decryptSecretRecord(rec, KEK), odd);
});

test("vault: every record gets a fresh DEK + IVs (no reuse across records)", () => {
  const a = encrypted();
  const b = encrypted();
  assert.notEqual(a.ciphertext, b.ciphertext, "same plaintext, different ciphertext");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.wrappedDek, b.wrappedDek, "fresh DEK per record");
  assert.notEqual(a.wrapIv, b.wrapIv);
});

test("vault: field shapes — 12B IVs, 16B tags, 32B wrapped DEK, AAD = identity", () => {
  const rec = encrypted();
  assert.equal(Buffer.from(rec.iv, "base64").length, 12);
  assert.equal(Buffer.from(rec.wrapIv, "base64").length, 12);
  assert.equal(Buffer.from(rec.tag, "base64").length, 16);
  assert.equal(Buffer.from(rec.wrapTag, "base64").length, 16);
  assert.equal(Buffer.from(rec.wrappedDek, "base64").length, 32);
  assert.equal(
    Buffer.from(rec.aad, "base64").toString("utf8"),
    "665f1f77bcf86cd799439011|atlas|atlas-1",
  );
  assert.equal(rec.keyVersion, KEY_VERSION);
});

test("vault: no stored field contains the plaintext (raw or decoded)", () => {
  const rec = encrypted();
  const ptBuf = Buffer.from(PLAINTEXT, "utf8");
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value !== "string") continue;
    assert.ok(!value.includes(PLAINTEXT), `${key} echoes plaintext raw`);
    assert.ok(!Buffer.from(value, "base64").includes(ptBuf), `${key} embeds plaintext bytes`);
  }
});

test("vault: tampered ciphertext throws", () => {
  const rec = encrypted();
  rec.ciphertext = corrupt(rec.ciphertext);
  assert.throws(() => decryptSecretRecord(rec, KEK), VaultError);
});

test("vault: tampered tag throws", () => {
  const rec = encrypted();
  rec.tag = corrupt(rec.tag);
  assert.throws(() => decryptSecretRecord(rec, KEK), VaultError);
});

test("vault: tampered stored AAD throws (binding check)", () => {
  const rec = encrypted();
  rec.aad = corrupt(rec.aad);
  assert.throws(() => decryptSecretRecord(rec, KEK), /AAD binding mismatch/);
});

test("vault: identity-field swap throws (record re-pointed at another tenant)", () => {
  const rec = encrypted();
  rec.tenantId = "0000000000000000000000ff"; // aad still names the real tenant
  assert.throws(() => decryptSecretRecord(rec, KEK), /AAD binding mismatch/);
});

test("vault: TANDEM identity+AAD rewrite still throws — AAD is GCM-authenticated", () => {
  // A leaked-DB attacker rewrites tenantId AND the stored aad consistently, so
  // the binding recompute passes — but GCM authenticated the ORIGINAL aad.
  const rec = encrypted();
  rec.tenantId = "0000000000000000000000ff";
  rec.aad = buildAad(rec).toString("base64");
  assert.throws(() => decryptSecretRecord(rec, KEK), /does not authenticate/);
});

test("vault: wrong KEK throws at unwrap", () => {
  assert.throws(() => decryptSecretRecord(encrypted(), randomBytes(32)), /DEK unwrap failed/);
});

test("vault: tampered wrapTag / wrapIv / wrappedDek throw at unwrap", () => {
  for (const field of ["wrapTag", "wrapIv", "wrappedDek"] as const) {
    const rec = encrypted();
    rec[field] = corrupt(rec[field]);
    assert.throws(() => decryptSecretRecord(rec, KEK), /DEK unwrap failed/, field);
  }
});

test("vault: TRUNCATED tags are rejected (GCM tag-downgrade defense)", () => {
  // Node accepts 4/8/12-byte GCM tags when authTagLength isn't pinned (proven
  // by live probe on v22.13.1) — pre-fix, an 8-byte truncation DECRYPTED FINE,
  // cutting forgery cost to 2^32. The length gate must reject it instead.
  for (const field of ["tag", "wrapTag"] as const) {
    for (const bytes of [12, 8, 4]) {
      const rec = encrypted();
      rec[field] = Buffer.from(rec[field], "base64").subarray(0, bytes).toString("base64");
      assert.throws(() => decryptSecretRecord(rec, KEK), /wrong length/, `${field}@${bytes}B`);
    }
  }
});

test("vault: truncated/oversized iv, wrappedDek, and oversized tag are rejected", () => {
  const cases: Array<["iv" | "wrapIv" | "wrappedDek" | "tag", number]> = [
    ["iv", 8],
    ["wrapIv", 8],
    ["wrappedDek", 16],
    ["tag", 24],
  ];
  for (const [field, bytes] of cases) {
    const rec = encrypted();
    const cut = Buffer.concat([Buffer.from(rec[field], "base64"), Buffer.alloc(24)]).subarray(0, bytes);
    rec[field] = cut.toString("base64");
    assert.throws(() => decryptSecretRecord(rec, KEK), /wrong length/, `${field}@${bytes}B`);
  }
});

test("vault: keyVersion is authenticated — bumping it breaks the wrap AAD", () => {
  const rec = encrypted();
  rec.keyVersion = 2;
  assert.throws(() => decryptSecretRecord(rec, KEK), /DEK unwrap failed/);
});

test("vault: empty plaintext / empty or |-smuggled identity are rejected", () => {
  assert.throws(() => encryptSecretRecord(IDENTITY, "", KEK, 1), /empty secret/);
  assert.throws(() => buildAad({ ...IDENTITY, accountLabel: "" }), /non-empty/);
  assert.throws(() => buildAad({ ...IDENTITY, provider: "atlas|x" }), /"\|"/);
  assert.throws(() => buildAad({ ...IDENTITY, tenantId: "a|b" }), /"\|"/);
  // accountLabel is the LAST AAD component, so "|" there is unambiguous — allowed.
  const rec = { ...IDENTITY, accountLabel: "a|b" };
  const enc = { ...rec, ...encryptSecretRecord(rec, PLAINTEXT, KEK, 1) };
  assert.equal(decryptSecretRecord(enc, KEK), PLAINTEXT);
});

test("vault: kekForVersion reads HUB_KEK (base64 + hex), validates 32 bytes", () => {
  // Hermetic against ambient rotation env — HUB_KEK_VERSION / HUB_KEK_V<n>
  // shift which branch of the F3.3 key map version 1 resolves through.
  const vars = ["HUB_KEK", "HUB_KEK_VERSION", "HUB_KEK_V1", "HUB_KEK_V2"];
  const saved = vars.map((k) => [k, process.env[k]] as const);
  try {
    for (const [k] of saved) delete process.env[k];
    assert.throws(() => kekForVersion(1), /HUB_KEK environment variable is not set/);

    const kek = randomBytes(32);
    process.env.HUB_KEK = kek.toString("base64");
    assert.deepEqual(kekForVersion(1), kek, "base64 accepted");

    process.env.HUB_KEK = kek.toString("hex");
    assert.deepEqual(kekForVersion(1), kek, "hex accepted");

    process.env.HUB_KEK = randomBytes(16).toString("base64");
    assert.throws(() => kekForVersion(1), /exactly 32 bytes/);

    process.env.HUB_KEK = "not-a-key";
    assert.throws(() => kekForVersion(1), /exactly 32 bytes/);

    process.env.HUB_KEK = kek.toString("base64");
    assert.throws(() => kekForVersion(2), /unknown KEK version/);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("vault: grep gate — no console.* in vault.ts, vault-core.ts, or models/Secret.ts", () => {
  for (const rel of ["./vault.ts", "./vault-core.ts", "../models/Secret.ts"]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/\bconsole\s*\./.test(src), `${rel} must never log (plaintext flows through)`);
  }
});
