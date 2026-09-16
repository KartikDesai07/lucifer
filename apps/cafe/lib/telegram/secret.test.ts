import { test } from "node:test";
import assert from "node:assert/strict";

import { sealSecret, openSecret } from "./secret";

// CR2.3b §21.2 #1 — DB-free crypto tests for the token-at-rest envelope.
// Every test sets process.env explicitly (via withEnv) and restores it in a
// `finally`, so this suite never depends on — or leaks into — the real
// AUTH_SECRET/NEXTAUTH_SECRET the process may already carry.

function withEnv(env: { AUTH_SECRET?: string; NEXTAUTH_SECRET?: string }, fn: () => void): void {
  const prevAuth = process.env.AUTH_SECRET;
  const prevNextAuth = process.env.NEXTAUTH_SECRET;
  if (env.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = env.AUTH_SECRET;
  if (env.NEXTAUTH_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = env.NEXTAUTH_SECRET;
  try {
    fn();
  } finally {
    if (prevAuth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevAuth;
    if (prevNextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = prevNextAuth;
  }
}

const TEST_SECRET = "test-auth-secret-value-32bytes!!";

test("seal -> open roundtrip for both purposes", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    for (const purpose of ["bot-token", "webhook-secret"] as const) {
      const sealed = sealSecret("super-secret-plaintext", purpose);
      assert.ok(sealed, `sealSecret must succeed for ${purpose}`);
      assert.equal(openSecret(sealed as string, purpose), "super-secret-plaintext");
    }
  });
});

test("opening under the WRONG purpose fails (AAD binding)", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    const sealed = sealSecret("plaintext", "bot-token") as string;
    assert.ok(sealed);
    assert.equal(openSecret(sealed, "webhook-secret"), null);
  });
});

for (const truncatedLen of [4, 8, 12] as const) {
  test(`a ${truncatedLen}-byte truncated auth tag is rejected before any decrypt`, () => {
    withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
      const sealed = sealSecret("plaintext", "bot-token") as string;
      const [version, ivB64, tagB64, ctB64] = sealed.split(":");
      const truncatedTag = Buffer.from(tagB64, "base64").subarray(0, truncatedLen).toString("base64");
      const forged = [version, ivB64, truncatedTag, ctB64].join(":");
      assert.equal(openSecret(forged, "bot-token"), null);
    });
  });
}

test("tampered ciphertext is rejected", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    const sealed = sealSecret("plaintext", "bot-token") as string;
    const [version, ivB64, tagB64, ctB64] = sealed.split(":");
    const ct = Buffer.from(ctB64, "base64");
    ct[0] = ct[0] ^ 0xff; // flip a byte
    const forged = [version, ivB64, tagB64, ct.toString("base64")].join(":");
    assert.equal(openSecret(forged, "bot-token"), null);
  });
});

test("a bad version literal ('v2') is rejected", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    const sealed = sealSecret("plaintext", "bot-token") as string;
    const rest = sealed.split(":").slice(1).join(":");
    assert.equal(openSecret(`v2:${rest}`, "bot-token"), null);
  });
});

test("garbage input with no envelope shape is rejected", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    assert.equal(openSecret("garbage", "bot-token"), null);
  });
});

test("wrong part-count (too few / too many colon-separated parts) is rejected", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    assert.equal(openSecret("v1:onlytwoparts", "bot-token"), null);
    assert.equal(openSecret("v1:a:b:c:d", "bot-token"), null);
  });
});

test("missing BOTH AUTH_SECRET and NEXTAUTH_SECRET disables seal AND open", () => {
  withEnv({}, () => {
    assert.equal(sealSecret("plaintext", "bot-token"), null);
    assert.equal(openSecret("v1:aa:bb:cc", "bot-token"), null);
  });
});

test("AUTH_SECRET wins over NEXTAUTH_SECRET — concrete precedence proof", () => {
  let sealed: string | null = null;
  withEnv({ AUTH_SECRET: "secret-a-value-here", NEXTAUTH_SECRET: "secret-b-value-here" }, () => {
    sealed = sealSecret("plaintext", "bot-token");
  });
  assert.ok(sealed, "seal must succeed");

  // Opening under NEXTAUTH_SECRET="secret-a..." ALONE reproduces the SAME ikm
  // the seal actually used, proving AUTH_SECRET (not NEXTAUTH_SECRET) drove
  // the derivation at seal time.
  withEnv({ NEXTAUTH_SECRET: "secret-a-value-here" }, () => {
    assert.equal(openSecret(sealed as string, "bot-token"), "plaintext");
  });

  // Opening under NEXTAUTH_SECRET="secret-b..." ALONE — the value that WOULD
  // have been used had NEXTAUTH_SECRET taken precedence — must fail.
  withEnv({ NEXTAUTH_SECRET: "secret-b-value-here" }, () => {
    assert.equal(openSecret(sealed as string, "bot-token"), null);
  });
});

test("two seals of the same plaintext differ (IV uniqueness) and both open", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    const sealedA = sealSecret("plaintext", "bot-token") as string;
    const sealedB = sealSecret("plaintext", "bot-token") as string;
    assert.notEqual(sealedA, sealedB);
    assert.equal(openSecret(sealedA, "bot-token"), "plaintext");
    assert.equal(openSecret(sealedB, "bot-token"), "plaintext");
  });
});

test("openSecret never throws on any junk input (fuzz)", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    const junkInputs = [
      "",
      "v1",
      "v1:",
      "v1::::",
      "v1:not-base64!!:not-base64!!:not-base64!!",
      "🙂:🙂:🙂:🙂",
      `v1:${"a".repeat(1000)}:${"b".repeat(1000)}:${"c".repeat(1000)}`,
    ];
    for (const junk of junkInputs) {
      assert.doesNotThrow(() => openSecret(junk, "bot-token"));
      assert.equal(openSecret(junk, "bot-token"), null);
    }
  });
});

// A hand-edited Settings doc has no static type guarantee — `envelope` is
// typed `string` but the runtime value read off the doc might not be one.
// Cast each junk value through the public signature (same seam a real
// Mongoose lean() read would hand openSecret) and confirm the pre-try guard
// catches it before `.split(":")` would otherwise throw.
test("openSecret never throws on a NON-STRING stored value (fuzz)", () => {
  withEnv({ AUTH_SECRET: TEST_SECRET }, () => {
    const nonStringInputs: unknown[] = [null, undefined, 42, {}, [], true];
    for (const junk of nonStringInputs) {
      assert.doesNotThrow(() => openSecret(junk as string, "bot-token"));
      assert.equal(openSecret(junk as string, "bot-token"), null);
    }
  });
});
