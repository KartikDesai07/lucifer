import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SECRET_CLASSIFICATIONS,
  SECRET_PROVIDERS,
  Secret,
  secretSchema,
} from "./Secret";

// DB-free schema guards for the F3.2 vault record (phase-F3 §3.2 sketch).

test("Secret: identity + every crypto field is required", () => {
  const err = new Secret({}).validateSync();
  assert.ok(err, "expected a ValidationError");
  for (const path of [
    "tenantId",
    "provider",
    "accountLabel",
    "classification",
    "ciphertext",
    "iv",
    "tag",
    "aad",
    "wrappedDek",
    "wrapIv",
    "wrapTag",
    "keyVersion",
  ]) {
    assert.ok(err.errors[path], `${path} required`);
  }
});

test("Secret: provider/classification enums match the pool-doc providers", () => {
  assert.deepEqual([...SECRET_PROVIDERS], ["atlas", "vercel", "cloudinary", "r2"]);
  assert.deepEqual([...SECRET_CLASSIFICATIONS], ["dbUri", "apiKey", "apiSecret", "token"]);
  const bad = new Secret({ provider: "aws", classification: "password" }).validateSync();
  assert.ok(bad?.errors.provider, "unknown provider rejected");
  assert.ok(bad?.errors.classification, "unknown classification rejected");
});

test("Secret: tenantId is an ObjectId ref; crypto fields are String paths", () => {
  assert.equal(secretSchema.path("tenantId").instance, "ObjectId");
  for (const path of ["ciphertext", "iv", "tag", "aad", "wrappedDek", "wrapIv", "wrapTag"]) {
    assert.equal(secretSchema.path(path).instance, "String", path);
  }
  assert.equal(secretSchema.path("keyVersion").instance, "Number");
});

test("Secret: index {tenantId:1, provider:1, accountLabel:1} (§3.4), non-unique", () => {
  const idx = secretSchema
    .indexes()
    .find(([k]) => k.tenantId === 1 && k.provider === 1 && k.accountLabel === 1);
  assert.ok(idx, "registry lookup index present");
  assert.notEqual(idx?.[1]?.unique, true, "apiKey+apiSecret share a label — not unique");
});

test("Secret: timestamps on; lastUsedAt defaults null; rotatedAt optional (F3.3)", () => {
  assert.equal(secretSchema.path("createdAt")?.instance, "Date");
  assert.equal(secretSchema.path("updatedAt")?.instance, "Date");
  assert.equal(secretSchema.path("rotatedAt")?.instance, "Date");
  const doc = new Secret({});
  assert.equal(doc.lastUsedAt, null, "lastUsedAt starts null (§A step 9)");
});

test("Secret: accountLabel is trimmed on set (vault trims BEFORE the AAD too)", () => {
  const doc = new Secret({ accountLabel: "  atlas-1  " });
  assert.equal(doc.accountLabel, "atlas-1");
});
