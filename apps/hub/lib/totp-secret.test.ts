import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  decryptTotpSecret,
  encryptTotpSecret,
  rewrapTotpSecretIfStale,
} from "./totp-secret";
import { generateTotpSecret } from "./totp";
import { VaultError } from "./vault-core";

// DB-free tests for the F3.4 TOTP-secret at-rest crypto (reuses lib/vault-core).
// KEK env is mutated per test, so save/restore around each case.

const KEK_ENV = ["HUB_KEK", "HUB_KEK_VERSION", "HUB_KEK_V1", "HUB_KEK_V2"];
function withKek<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = KEK_ENV.map((k) => [k, process.env[k]] as const);
  for (const [k] of saved) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const KEK1 = randomBytes(32).toString("base64");
const KEK2 = randomBytes(32).toString("base64");
const USER_A = "665f1f77bcf86cd799439011";
const USER_B = "665f1f77bcf86cd799439012";

test("round-trips a TOTP secret and never stores plaintext", () => {
  withKek({ HUB_KEK: KEK1 }, () => {
    const secret = generateTotpSecret();
    const stored = encryptTotpSecret(USER_A, secret);
    assert.ok(!stored.includes(secret), "the base32 seed does not appear in the ciphertext blob");
    assert.equal(decryptTotpSecret(USER_A, stored), secret);
  });
});

test("a cross-user swap fails the AAD binding", () => {
  withKek({ HUB_KEK: KEK1 }, () => {
    const stored = encryptTotpSecret(USER_A, generateTotpSecret());
    assert.throws(() => decryptTotpSecret(USER_B, stored), VaultError);
  });
});

test("a wrong KEK cannot decrypt", () => {
  const stored = withKek({ HUB_KEK: KEK1 }, () => encryptTotpSecret(USER_A, generateTotpSecret()));
  withKek({ HUB_KEK: KEK2 }, () => {
    assert.throws(() => decryptTotpSecret(USER_A, stored), VaultError);
  });
});

test("tampering with the ciphertext blob is rejected", () => {
  withKek({ HUB_KEK: KEK1 }, () => {
    const stored = encryptTotpSecret(USER_A, generateTotpSecret());
    const parsed = JSON.parse(stored);
    const buf = Buffer.from(parsed.ciphertext, "base64");
    buf[0] ^= 0xff;
    parsed.ciphertext = buf.toString("base64");
    assert.throws(() => decryptTotpSecret(USER_A, JSON.stringify(parsed)), VaultError);
  });
});

test("non-JSON / corrupt stored value throws a clean VaultError", () => {
  withKek({ HUB_KEK: KEK1 }, () => {
    assert.throws(() => decryptTotpSecret(USER_A, "not-json"), VaultError);
  });
});

test("rewrapTotpSecretIfStale: no-op at the current version", () => {
  withKek({ HUB_KEK: KEK1, HUB_KEK_VERSION: "1" }, () => {
    const stored = encryptTotpSecret(USER_A, generateTotpSecret());
    assert.equal(rewrapTotpSecretIfStale(stored), null);
  });
});

test("rewrapTotpSecretIfStale: re-wraps a stale version, still decrypts, payload byte-identical", () => {
  const secret = generateTotpSecret();
  // Encrypt under v1.
  const v1Stored = withKek({ HUB_KEK: KEK1, HUB_KEK_VERSION: "1" }, () =>
    encryptTotpSecret(USER_A, secret),
  );
  // Now the env has advanced: HUB_KEK=KEK2 is v2, KEK1 retired as HUB_KEK_V1.
  withKek({ HUB_KEK: KEK2, HUB_KEK_VERSION: "2", HUB_KEK_V1: KEK1 }, () => {
    const rewrapped = rewrapTotpSecretIfStale(v1Stored);
    assert.ok(rewrapped, "a stale record is re-wrapped");
    const before = JSON.parse(v1Stored);
    const after = JSON.parse(rewrapped as string);
    assert.equal(after.keyVersion, 2, "now wrapped under v2");
    // Payload fields are NEVER re-encrypted — only the DEK wrap changes.
    assert.equal(after.ciphertext, before.ciphertext);
    assert.equal(after.iv, before.iv);
    assert.equal(after.tag, before.tag);
    assert.equal(after.aad, before.aad);
    assert.notEqual(after.wrappedDek, before.wrappedDek);
    // And it decrypts to the same secret under the new KEK.
    assert.equal(decryptTotpSecret(USER_A, rewrapped as string), secret);
  });
});

test("F3.4 grep gate — no console.* in the TOTP / owner-auth / gate modules", () => {
  const guarded = [
    "./totp.ts",
    "./totp-secret.ts",
    "./totp-rotate.ts",
    "./owner-totp.ts",
    "./auth.ts",
    "./panel-gate.ts",
    "./panel-gate-core.ts",
  ];
  for (const rel of guarded) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/\bconsole\s*\./.test(src), `${rel} must never log (secret/seed flows through)`);
  }
});
