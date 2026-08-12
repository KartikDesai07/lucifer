// Cloudflare R2 asset plane (F2 §3.7, Step F2.11) — the cafe's OWN free R2
// bucket holds its product images; this module owns the runtime upload/render/
// delete path. Upload mirrors v1's signed-Cloudinary pattern: the server issues
// a short-lived presigned PUT (SigV4 query auth via aws4fetch, the client
// Cloudflare's own R2 docs use) and the browser PUTs the bytes directly, so no
// image ever passes through an API route. Deletes are signed server-side and
// scoped to the cafe's product prefix — DB backups etc. in the same bucket are
// unreachable from this path. Server-only (credentials): never import from a
// client component; rendering uses lib/images.ts instead.

import { randomBytes } from "node:crypto";

import { AwsV4Signer } from "aws4fetch";

import {
  IMAGE_CONTENT_TYPES,
  IMAGE_UPLOAD_TTL_SECONDS,
  MAX_IMAGE_BYTES,
} from "@/lib/constants";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  // "" (own-bucket-per-cafe, the shipped Tier-B shape) or "tenant/<id>/" when a
  // future shared bucket scopes cafes by prefix (F2 §3.7). Always "" or "…/".
  keyPrefix: string;
}

// All product images live under this folder within the cafe's prefix — the R2
// twin of CLOUDINARY_FOLDER, and the boundary `isProductImageKey` enforces.
// The Settings logo (CR1.5) intentionally reuses this same prefix rather than
// getting its own "branding/" folder: the logo has no DELETE caller anywhere
// in the app (Settings just overwrites the stored ref), so a second prefix
// would only add a scope a real deletion path never needs — while forcing
// presign, isProductImageKey, and the upload route's delete dispatcher to all
// learn about it together for no behavioral gain.
export const PRODUCT_IMAGE_FOLDER = "products";

// Conservative object-key bound: our generated keys are ~40 chars + prefix.
const MAX_KEY_LENGTH = 200;

// Keys are server-generated (hex + a known extension), so the guard can be
// strict: a conservative charset, no empty segments, no dot-dot lookalikes.
const KEY_CHARSET = /^[A-Za-z0-9._/-]+$/;

// R2 account ids are 32-hex; accept any single hostname label defensively.
const ACCOUNT_ID_CHARSET = /^[a-z0-9]+$/i;

// S3/R2 bucket naming: lowercase letters, digits, dots, hyphens, 3-63 chars.
const BUCKET_CHARSET = /^[a-z0-9.-]{3,63}$/;

// Resolve the R2 target from server-only env. Returns null when unset (the
// upload route answers "not configured") or when a value could not form a safe
// URL — misconfiguration must fail closed, never sign for a mangled target.
export function r2Config(
  env: NodeJS.ProcessEnv = process.env,
): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  if (!ACCOUNT_ID_CHARSET.test(accountId) || !BUCKET_CHARSET.test(bucket)) {
    return null;
  }

  let keyPrefix = env.R2_KEY_PREFIX ?? "";
  if (keyPrefix && !keyPrefix.endsWith("/")) keyPrefix += "/";
  if (
    keyPrefix &&
    !(KEY_CHARSET.test(keyPrefix) && !keyPrefix.includes("..") && !keyPrefix.includes("//"))
  ) {
    return null;
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, keyPrefix };
}

// The cafe-scoped folder every product-image key must live under.
export function productImagePrefix(cfg: R2Config): string {
  return `${cfg.keyPrefix}${PRODUCT_IMAGE_FOLDER}/`;
}

// The delete-scope guard (F2.11 "prefix-scoped delete"): true only for keys
// inside THIS cafe's product-image folder, in the exact shape we generate.
export function isProductImageKey(key: string, cfg: R2Config): boolean {
  const prefix = productImagePrefix(cfg);
  return (
    key.startsWith(prefix) &&
    key.length > prefix.length &&
    key.length <= MAX_KEY_LENGTH &&
    KEY_CHARSET.test(key) &&
    !key.includes("..") &&
    !key.includes("//")
  );
}

// S3-compatible path-style object URL on the cafe's own R2 endpoint. Key
// segments are RFC3986-encoded per segment (aws4fetch re-canonicalises the
// path identically when computing the signature).
function objectUrl(cfg: R2Config, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${encodedKey}`;
}

function signer(
  cfg: R2Config,
  init: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    signQuery?: boolean;
    datetime?: string;
  },
): AwsV4Signer {
  return new AwsV4Signer({
    ...init,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto", // R2's fixed SigV4 region
    // content-type/content-length sit in aws4fetch's UNSIGNABLE_HEADERS set and
    // would be silently DROPPED from the signature without this (verified in
    // aws4fetch@1.0.20 source) — and pinning them is the whole point: the PUT
    // grant must bind the exact bytes+type the client declared.
    allHeaders: true,
  });
}

export interface ProductImagePutGrant {
  key: string;
  uploadUrl: string;
  // Headers the browser must send verbatim on the PUT (Content-Length is
  // browser-set from the body and therefore not listed, but it IS signed).
  headers: Record<string, string>;
}

// Issue a presigned PUT for one new product image. The signature pins method,
// key, Content-Type, and Content-Length, and expires in IMAGE_UPLOAD_TTL_SECONDS
// — a grant can't be reused to place different bytes, a different type, or a
// bigger object. `datetime`/`randomHex` are injection seams for deterministic
// tests only.
export async function presignProductImagePut(
  contentType: string,
  size: number,
  cfg: R2Config,
  opts: { datetime?: string; randomHex?: string } = {},
): Promise<ProductImagePutGrant> {
  const ext = IMAGE_CONTENT_TYPES[contentType];
  if (!ext) throw new Error(`Unsupported image content type: ${contentType}`);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    throw new Error(`Image size out of range: ${size}`);
  }

  const hex = opts.randomHex ?? randomBytes(16).toString("hex");
  const key = `${productImagePrefix(cfg)}${hex}.${ext}`;

  const url = new URL(objectUrl(cfg, key));
  // aws4fetch defaults a query-signed S3 URL to 24h validity — pin it short.
  url.searchParams.set("X-Amz-Expires", String(IMAGE_UPLOAD_TTL_SECONDS));

  const signed = await signer(cfg, {
    method: "PUT",
    url: url.toString(),
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
    },
    signQuery: true,
    datetime: opts.datetime,
  }).sign();

  return {
    key,
    uploadUrl: signed.url.toString(),
    headers: { "Content-Type": contentType },
  };
}

// Delete one product image, refusing any key outside the cafe's product prefix
// (defense in depth — the route guards with isProductImageKey first). S3
// DeleteObject is idempotent: 204 for deleted AND already-absent keys; a 404
// (some S3 impls) is treated the same, anything else is a real failure.
export async function deleteProductImage(
  key: string,
  cfg: R2Config,
  opts: { fetchImpl?: typeof fetch; datetime?: string } = {},
): Promise<void> {
  if (!isProductImageKey(key, cfg)) {
    throw new Error("Image key is outside the product image prefix");
  }

  const signed = await signer(cfg, {
    method: "DELETE",
    url: objectUrl(cfg, key),
    datetime: opts.datetime,
  }).sign();

  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(signed.url.toString(), {
    method: "DELETE",
    headers: signed.headers,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed with status ${res.status}`);
  }
}
