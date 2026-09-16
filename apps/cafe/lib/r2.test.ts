import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deleteProductImage,
  isProductImageKey,
  presignProductImagePut,
  productImagePrefix,
  r2Config,
  type R2Config,
} from "./r2";
import {
  IMAGE_UPLOAD_TTL_SECONDS,
  MAX_IMAGE_BYTES,
} from "@/lib/constants";

// F2.11 — the R2 asset plane. These pin the grant/guard CONTRACT (URL shape,
// signed-header set, expiry, prefix scoping, determinism); signature
// correctness against the real R2 endpoint is the seeded integration pass
// (needs the owner's bucket credentials).

const CFG: R2Config = {
  accountId: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "test-secret",
  bucket: "cafe-images",
  keyPrefix: "",
};

const DATETIME = "20260705T000000Z";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    R2_ACCOUNT_ID: CFG.accountId,
    R2_ACCESS_KEY_ID: CFG.accessKeyId,
    R2_SECRET_ACCESS_KEY: CFG.secretAccessKey,
    R2_BUCKET: CFG.bucket,
    ...overrides,
  } as unknown as NodeJS.ProcessEnv;
}

test("r2Config: resolves from env; null when any required var is missing", () => {
  assert.deepEqual(r2Config(env({})), { ...CFG });
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ]) {
    assert.equal(r2Config(env({ [name]: undefined })), null, name);
    assert.equal(r2Config(env({ [name]: "" })), null, name);
  }
});

test("r2Config: normalises the optional key prefix to a trailing slash; rejects unsafe values", () => {
  assert.equal(r2Config(env({ R2_KEY_PREFIX: "tenant/x" }))?.keyPrefix, "tenant/x/");
  assert.equal(r2Config(env({ R2_KEY_PREFIX: "tenant/x/" }))?.keyPrefix, "tenant/x/");
  assert.equal(r2Config(env({ R2_KEY_PREFIX: "" }))?.keyPrefix, "");
  for (const bad of ["../up", "a//b", "sp ace", "tenant/x/.."]) {
    assert.equal(r2Config(env({ R2_KEY_PREFIX: bad })), null, bad);
  }
});

test("r2Config: fails closed on a URL-unsafe account id or bucket name", () => {
  assert.equal(r2Config(env({ R2_ACCOUNT_ID: "evil.host/path" })), null);
  assert.equal(r2Config(env({ R2_BUCKET: "Has Spaces" })), null);
  assert.equal(r2Config(env({ R2_BUCKET: "ab" })), null); // < 3 chars
});

test("presign: URL targets the cafe's own endpoint/bucket, key is products/<32hex>.<ext>", async () => {
  const grant = await presignProductImagePut("image/webp", 1234, CFG, {
    datetime: DATETIME,
  });
  assert.match(grant.key, /^products\/[0-9a-f]{32}\.webp$/);
  const url = new URL(grant.uploadUrl);
  assert.equal(url.hostname, `${CFG.accountId}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, `/${CFG.bucket}/${grant.key}`);
  assert.deepEqual(grant.headers, { "Content-Type": "image/webp" });
});

test("presign: signs the SigV4 query contract — short expiry, content-length+content-type pinned", async () => {
  const grant = await presignProductImagePut("image/jpeg", 4096, CFG, {
    datetime: DATETIME,
  });
  const q = new URL(grant.uploadUrl).searchParams;
  assert.equal(q.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  // NOT aws4fetch's 24h default — the grant must go stale fast.
  assert.equal(q.get("X-Amz-Expires"), String(IMAGE_UPLOAD_TTL_SECONDS));
  assert.equal(q.get("X-Amz-Date"), DATETIME);
  // R2's fixed SigV4 scope: <date>/auto/s3/aws4_request
  assert.equal(
    q.get("X-Amz-Credential"),
    `${CFG.accessKeyId}/20260705/auto/s3/aws4_request`,
  );
  // The whole point of the grant: the byte count and type are in the signature
  // (aws4fetch drops both as "unsignable" unless allHeaders is set — pinned here
  // so a refactor losing that flag fails loudly).
  assert.equal(
    q.get("X-Amz-SignedHeaders"),
    "content-length;content-type;host",
  );
  assert.match(q.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

test("presign: deterministic for fixed inputs; secret/size/type all shift the signature", async () => {
  const opts = { datetime: DATETIME, randomHex: "0".repeat(32) };
  const a = await presignProductImagePut("image/png", 1000, CFG, opts);
  const b = await presignProductImagePut("image/png", 1000, CFG, opts);
  assert.equal(a.uploadUrl, b.uploadUrl);

  const sig = (g: { uploadUrl: string }) =>
    new URL(g.uploadUrl).searchParams.get("X-Amz-Signature");
  const otherSecret = await presignProductImagePut("image/png", 1000, {
    ...CFG,
    secretAccessKey: "other",
  }, opts);
  assert.notEqual(sig(otherSecret), sig(a));
  const otherSize = await presignProductImagePut("image/png", 1001, CFG, opts);
  assert.notEqual(sig(otherSize), sig(a));
  const otherType = await presignProductImagePut("image/webp", 1000, CFG, opts);
  assert.notEqual(sig(otherType), sig(a));
});

test("presign: honours the tenant key prefix", async () => {
  const cfg = { ...CFG, keyPrefix: "tenant/x/" };
  const grant = await presignProductImagePut("image/webp", 10, cfg, {
    datetime: DATETIME,
  });
  assert.match(grant.key, /^tenant\/x\/products\/[0-9a-f]{32}\.webp$/);
});

test("presign: refuses non-allowlisted types and out-of-range sizes", async () => {
  await assert.rejects(
    () => presignProductImagePut("image/svg+xml", 100, CFG),
    /Unsupported image content type/,
  );
  for (const size of [0, -5, 1.5, MAX_IMAGE_BYTES + 1]) {
    await assert.rejects(
      () => presignProductImagePut("image/png", size, CFG),
      /size out of range/,
      String(size),
    );
  }
  // the boundary itself is fine
  await assert.doesNotReject(() =>
    presignProductImagePut("image/png", MAX_IMAGE_BYTES, CFG),
  );
});

test("isProductImageKey: accepts only this cafe's product-image folder", () => {
  assert.equal(isProductImageKey("products/abc.webp", CFG), true);
  // other objects in the same bucket (e.g. DB backups) are out of scope
  assert.equal(isProductImageKey("backups/core-20260705.gz.enc", CFG), false);
  assert.equal(isProductImageKey("products/../backups/x", CFG), false);
  assert.equal(isProductImageKey("products//x.webp", CFG), false);
  assert.equal(isProductImageKey("products/", CFG), false);
  assert.equal(isProductImageKey("", CFG), false);
  assert.equal(isProductImageKey("products/" + "a".repeat(300), CFG), false);
  assert.equal(isProductImageKey("products/we ird.webp", CFG), false);

  const scoped = { ...CFG, keyPrefix: "tenant/me/" };
  assert.equal(productImagePrefix(scoped), "tenant/me/products/");
  assert.equal(isProductImageKey("tenant/me/products/a.webp", scoped), true);
  // another cafe's prefix in a shared bucket is unreachable
  assert.equal(isProductImageKey("tenant/other/products/a.webp", scoped), false);
  assert.equal(isProductImageKey("products/a.webp", scoped), false);
});

test("deleteProductImage: sends a SigV4-signed DELETE for the exact object", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as unknown as typeof fetch;

  await deleteProductImage("products/abc.webp", CFG, {
    fetchImpl,
    datetime: DATETIME,
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://${CFG.accountId}.r2.cloudflarestorage.com/${CFG.bucket}/products/abc.webp`,
  );
  assert.equal(calls[0].init.method, "DELETE");
  const headers = new Headers(calls[0].init.headers);
  const auth = headers.get("Authorization") ?? "";
  assert.match(auth, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260705\/auto\/s3\/aws4_request/);
  assert.match(auth, /SignedHeaders=[^,]*host/);
  assert.equal(headers.get("X-Amz-Content-Sha256"), "UNSIGNED-PAYLOAD");
});

test("deleteProductImage: refuses out-of-prefix keys BEFORE any network call", async () => {
  const fetchImpl = (() => {
    throw new Error("network must not be reached");
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => deleteProductImage("backups/dump.gz", CFG, { fetchImpl }),
    /outside the product image prefix/,
  );
});

test("deleteProductImage: 204/404 are success (idempotent); other statuses throw", async () => {
  const respond = (status: number) =>
    ((async () => new Response(null, { status })) as unknown) as typeof fetch;
  await assert.doesNotReject(() =>
    deleteProductImage("products/a.webp", CFG, { fetchImpl: respond(204) }),
  );
  await assert.doesNotReject(() =>
    deleteProductImage("products/a.webp", CFG, { fetchImpl: respond(404) }),
  );
  await assert.rejects(
    () => deleteProductImage("products/a.webp", CFG, { fetchImpl: respond(403) }),
    /failed with status 403/,
  );
});
