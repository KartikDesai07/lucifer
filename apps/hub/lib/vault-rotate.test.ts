import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  currentKekVersion,
  decryptSecretRecord,
  encryptSecretRecord,
  kekForVersion,
  rewrapDekFields,
  type SecretIdentity,
} from "./vault"; // via the re-export — proves `@/lib/vault` stays one surface

// DB-free tests for the F3.3 rotation core (fed-secrets-vault.json §C): the
// {v1,v2} KEK map (currentKekVersion/kekForVersion) and rewrapDekFields. The
// DB layer (rotateKEK sweep, rotateCred orchestration, Secret.status) is
// proven by scripts/verify-vault-rotation-live.ts on the scratch M0.

const KEK1 = randomBytes(32);
const KEK2 = randomBytes(32);
const IDENTITY: SecretIdentity = {
  tenantId: "665f1f77bcf86cd799439011",
  provider: "atlas",
  accountLabel: "atlas-1",
};
const PLAINTEXT = "mongodb+srv://user:rot4te-me@cluster0.abcde.mongodb.net/pos";

const KEK_ENV_VARS = ["HUB_KEK", "HUB_KEK_VERSION", "HUB_KEK_V1", "HUB_KEK_V2", "HUB_KEK_V3"];

/** Run fn with a clean, then-restored KEK env (map tests mutate process.env). */
function withKekEnv(fn: () => void): void {
  const saved = KEK_ENV_VARS.map((k) => [k, process.env[k]] as const);
  for (const [k] of saved) delete process.env[k];
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function encryptedV1() {
  return { ...IDENTITY, ...encryptSecretRecord(IDENTITY, PLAINTEXT, KEK1, 1) };
}

test("rotate: currentKekVersion — unset/blank ⇒ 1, integer accepted, junk rejected", () => {
  withKekEnv(() => {
    assert.equal(currentKekVersion(), 1, "unset defaults to 1");
    process.env.HUB_KEK_VERSION = "  ";
    assert.equal(currentKekVersion(), 1, "blank defaults to 1");
    process.env.HUB_KEK_VERSION = "2";
    assert.equal(currentKekVersion(), 2);
    for (const junk of ["0", "-1", "1.5", "abc", "1e3x"]) {
      process.env.HUB_KEK_VERSION = junk;
      assert.throws(() => currentKekVersion(), /positive integer/, `junk '${junk}'`);
    }
  });
});

test("rotate: the {v1,v2} key map — current from HUB_KEK, retired from HUB_KEK_V<n>", () => {
  withKekEnv(() => {
    process.env.HUB_KEK = KEK2.toString("base64");
    process.env.HUB_KEK_VERSION = "2";
    process.env.HUB_KEK_V1 = KEK1.toString("hex"); // hex accepted per-version too
    assert.deepEqual(kekForVersion(2), KEK2, "current version reads HUB_KEK");
    assert.deepEqual(kekForVersion(1), KEK1, "retired version reads HUB_KEK_V1");
    assert.throws(() => kekForVersion(3), /unknown KEK version 3/);
    assert.throws(() => kekForVersion(0), /invalid KEK version/);

    delete process.env.HUB_KEK_V1;
    assert.throws(() => kekForVersion(1), /unknown KEK version 1/, "retired KEK dropped");

    process.env.HUB_KEK_V1 = "not-a-key";
    assert.throws(() => kekForVersion(1), /HUB_KEK_V1 must decode to exactly 32 bytes/);
  });
});

test("rotate: conflict guard — HUB_KEK_V<current> disagreeing with HUB_KEK fails closed", () => {
  withKekEnv(() => {
    process.env.HUB_KEK = KEK2.toString("base64");
    process.env.HUB_KEK_VERSION = "2";
    process.env.HUB_KEK_V2 = KEK1.toString("base64"); // a DIFFERENT key claims v2
    assert.throws(() => kekForVersion(2), /HUB_KEK_V2 conflicts with HUB_KEK/);

    process.env.HUB_KEK_V2 = KEK2.toString("base64"); // same key ⇒ harmless
    assert.deepEqual(kekForVersion(2), KEK2);
  });
});

test("rotate: rewrapDekFields — decrypts under the NEW KEK only; payload untouched", () => {
  const rec = encryptedV1();
  const rewrapped = rewrapDekFields(rec, KEK1, KEK2, 2);

  // §C invariant: ONLY the wrap moved — payload fields are byte-identical.
  assert.equal(rewrapped.keyVersion, 2);
  assert.notEqual(rewrapped.wrappedDek, rec.wrappedDek);
  assert.notEqual(rewrapped.wrapIv, rec.wrapIv);
  assert.notEqual(rewrapped.wrapTag, rec.wrapTag);
  const migrated = { ...rec, ...rewrapped };
  assert.equal(migrated.ciphertext, rec.ciphertext, "ciphertext never re-encrypted");
  assert.equal(migrated.iv, rec.iv);
  assert.equal(migrated.tag, rec.tag);
  assert.equal(migrated.aad, rec.aad);

  assert.equal(decryptSecretRecord(migrated, KEK2), PLAINTEXT, "new KEK decrypts");
  assert.throws(() => decryptSecretRecord(migrated, KEK1), /DEK unwrap failed/, "old KEK is out");
  // The AAD binding survives the rewrap — identity swap still throws.
  assert.throws(
    () => decryptSecretRecord({ ...migrated, tenantId: "0000000000000000000000ff" }, KEK2),
    /AAD binding mismatch/,
  );
});

test("rotate: rewrapDekFields — wrong old KEK / tampered or truncated wrap fields throw", () => {
  const rec = encryptedV1();
  assert.throws(() => rewrapDekFields(rec, KEK2, KEK1, 2), /DEK unwrap failed/, "wrong old KEK");

  const tampered = { ...rec };
  const buf = Buffer.from(tampered.wrapTag, "base64");
  buf[4] ^= 0xff;
  tampered.wrapTag = buf.toString("base64");
  assert.throws(() => rewrapDekFields(tampered, KEK1, KEK2, 2), /DEK unwrap failed/);

  const truncated = { ...rec, wrapTag: Buffer.from(rec.wrapTag, "base64").subarray(0, 8).toString("base64") };
  assert.throws(() => rewrapDekFields(truncated, KEK1, KEK2, 2), /wrong length/, "8B tag gated");
});

test("rotate: rewrapDekFields refuses a same-version target", () => {
  const rec = encryptedV1();
  assert.throws(() => rewrapDekFields(rec, KEK1, KEK2, 1), /must differ/);
});

test("rotate: zero-downtime — mixed-version records both decrypt through the map", () => {
  withKekEnv(() => {
    // Mid-rotation env: v2 is current, v1 retired-but-readable.
    process.env.HUB_KEK = KEK2.toString("base64");
    process.env.HUB_KEK_VERSION = "2";
    process.env.HUB_KEK_V1 = KEK1.toString("base64");

    const oldRec = encryptedV1(); // stored before the flip
    const newRec = { ...IDENTITY, ...encryptSecretRecord(IDENTITY, PLAINTEXT, KEK2, 2) };
    // The getSecret path: resolve each record's KEK from ITS OWN keyVersion.
    assert.equal(decryptSecretRecord(oldRec, kekForVersion(oldRec.keyVersion)), PLAINTEXT);
    assert.equal(decryptSecretRecord(newRec, kekForVersion(newRec.keyVersion)), PLAINTEXT);
  });
});
