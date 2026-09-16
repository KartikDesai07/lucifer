import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  brandingVersion,
  isSupportedBrandingType,
  hasMatchingSignature,
  DEFAULT_PRODUCT_LOGO,
} from "./branding";
import { BRANDING_VERSION_LEN } from "@/lib/constants";

// F3 branding store — pure surface only (brandingVersion, the content-type +
// signature gate, the built-in default mark). putBrandingAsset/getBrandingBytes/
// getBrandingMeta/resolveActiveVersion touch Mongo and are covered by a live
// leg, not here.

// ── brandingVersion ──────────────────────────────────────────────────────────

test("brandingVersion: stable for identical bytes", () => {
  const bytes = Buffer.from("same-bytes-in-both-calls", "utf8");
  assert.equal(
    brandingVersion(bytes),
    brandingVersion(Buffer.from(bytes)),
    "identical uploaded bytes must produce the same version — otherwise re-uploading the same logo would mint a new cache-busting URL for no reason",
  );
});

test("brandingVersion: different bytes produce different versions", () => {
  const a = Buffer.from("logo-bytes-a", "utf8");
  const b = Buffer.from("logo-bytes-b", "utf8");
  assert.notEqual(
    brandingVersion(a),
    brandingVersion(b),
    "two different logos must not share a version — a collision would leave a browser holding an immutable URL that never refreshes to the new bytes",
  );
});

test("brandingVersion: exactly BRANDING_VERSION_LEN lowercase hex chars", () => {
  const version = brandingVersion(Buffer.from("some-arbitrary-payload", "utf8"));
  assert.equal(
    version.length,
    BRANDING_VERSION_LEN,
    "a version of the wrong length would break the fixed-width VERSION_PATTERN in lib/images.ts and every local: ref would fail to parse",
  );
  assert.match(
    version,
    /^[0-9a-f]+$/,
    "uppercase or non-hex chars would fail the images.ts VERSION_PATTERN and the ref would parse to null (placeholder) forever",
  );
});

test("brandingVersion: matches an independently computed sha256 (catches a changed hash algorithm)", () => {
  const bytes = Buffer.from("independently-hashed-payload", "utf8");
  const expected = createHash("sha256").update(bytes).digest("hex").slice(0, BRANDING_VERSION_LEN);
  assert.equal(
    brandingVersion(bytes),
    expected,
    "if the implementation silently switched hash algorithms this pin — computed independently of branding.ts — would catch it",
  );
});

// ── isSupportedBrandingType ──────────────────────────────────────────────────

test("isSupportedBrandingType: true for the three raster types", () => {
  assert.equal(isSupportedBrandingType("image/png"), true);
  assert.equal(isSupportedBrandingType("image/jpeg"), true);
  assert.equal(isSupportedBrandingType("image/webp"), true);
});

test("isSupportedBrandingType: false for image/svg+xml — SVG bytes served from our own origin with no CSP would be script execution on the app's domain", () => {
  assert.equal(
    isSupportedBrandingType("image/svg+xml"),
    false,
    "there is no Content-Security-Policy on this app, so a stored SVG served back from /api/branding/<slot> would execute arbitrary <script> on the app's own domain — this gate is the only thing stopping that",
  );
});

test("isSupportedBrandingType: false for image/gif, text/html, empty string, and a mixed-case spelling", () => {
  assert.equal(isSupportedBrandingType("image/gif"), false, "gif is not in the raster allow-list");
  assert.equal(isSupportedBrandingType("text/html"), false, "html must never be accepted as a branding asset");
  assert.equal(isSupportedBrandingType(""), false, "an empty content type must not slip through as supported");
  assert.equal(
    isSupportedBrandingType("Image/PNG"),
    false,
    "content-type matching is case-sensitive here — a mixed-case spelling must not silently pass and skip the signature check",
  );
});

// ── hasMatchingSignature ─────────────────────────────────────────────────────

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // chunk size, irrelevant to the check
  Buffer.from("WEBP", "latin1"),
]);
const HTML_BYTES = Buffer.from("<!doctype html><script>alert(1)</script>", "utf8");

test("hasMatchingSignature: a real PNG signature matches image/png and fails jpeg/webp", () => {
  assert.equal(hasMatchingSignature(PNG_BYTES, "image/png"), true, "a real PNG signature must be accepted as image/png");
  assert.equal(
    hasMatchingSignature(PNG_BYTES, "image/jpeg"),
    false,
    "PNG bytes declared as jpeg must be rejected — otherwise the stored content-type would lie about what's actually served",
  );
  assert.equal(
    hasMatchingSignature(PNG_BYTES, "image/webp"),
    false,
    "PNG bytes declared as webp must be rejected",
  );
});

test("hasMatchingSignature: a JPEG SOI prefix matches image/jpeg and fails png/webp", () => {
  assert.equal(hasMatchingSignature(JPEG_BYTES, "image/jpeg"), true, "a real JPEG SOI marker must be accepted as image/jpeg");
  assert.equal(hasMatchingSignature(JPEG_BYTES, "image/png"), false, "JPEG bytes declared as png must be rejected");
  assert.equal(hasMatchingSignature(JPEG_BYTES, "image/webp"), false, "JPEG bytes declared as webp must be rejected");
});

test("hasMatchingSignature: a RIFF....WEBP header matches image/webp and fails png/jpeg", () => {
  assert.equal(hasMatchingSignature(WEBP_BYTES, "image/webp"), true, "a real WEBP RIFF header must be accepted as image/webp");
  assert.equal(hasMatchingSignature(WEBP_BYTES, "image/png"), false, "WEBP bytes declared as png must be rejected");
  assert.equal(hasMatchingSignature(WEBP_BYTES, "image/jpeg"), false, "WEBP bytes declared as jpeg must be rejected");
});

test("hasMatchingSignature: a truncated header fails its own content type", () => {
  assert.equal(
    hasMatchingSignature(PNG_BYTES.subarray(0, 4), "image/png"),
    false,
    "a truncated PNG signature must not pass — an admin could otherwise park a half-written/corrupt blob behind a valid content-type",
  );
  assert.equal(
    hasMatchingSignature(WEBP_BYTES.subarray(0, 8), "image/webp"),
    false,
    "a WEBP header truncated before the WEBP tag (RIFF + size only) must fail",
  );
});

test("hasMatchingSignature: an empty buffer fails every content type", () => {
  const empty = Buffer.alloc(0);
  assert.equal(hasMatchingSignature(empty, "image/png"), false, "empty bytes must never pass as a stored logo");
  assert.equal(hasMatchingSignature(empty, "image/jpeg"), false, "empty bytes must never pass as a stored logo");
  assert.equal(hasMatchingSignature(empty, "image/webp"), false, "empty bytes must never pass as a stored logo");
});

test("hasMatchingSignature: HTML bytes declared as image/png fail — this is the actual attack this gate exists to stop", () => {
  assert.equal(
    hasMatchingSignature(HTML_BYTES, "image/png"),
    false,
    "an admin (or a compromised admin session) claiming Content-Type: image/png over an HTML/script payload must be rejected by the byte signature, not trusted from the header",
  );
});

// ── Inherited-key bypass (CONFIRMED security finding, verified by probe) ────
//
// Both allow-list maps (IMAGE_CONTENT_TYPES in packages/shared and the
// module-local SIGNATURE_CHECKS in branding.ts) are plain object literals, so
// before the fix `"constructor" in IMAGE_CONTENT_TYPES` was true and
// `SIGNATURE_CHECKS["constructor"]` was the `Object` function — callable,
// returning a truthy value — so `Content-Type: constructor` passed BOTH the
// type allow-list and the file-signature gate. These pins fail against the
// old `in`-based implementation.

const INHERITED_KEYS = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"];

for (const key of INHERITED_KEYS) {
  test(`isSupportedBrandingType: false for inherited key "${key}" — an "in" check would let it host arbitrary content on the restaurant's own domain`, () => {
    assert.equal(
      isSupportedBrandingType(key),
      false,
      `Content-Type: "${key}" must not pass the allow-list — the old "in"-based check treated Object.prototype members as supported types, letting an admin store arbitrary bytes served from our own origin to unauthenticated callers`,
    );
  });

  test(`hasMatchingSignature: false (and never throws) for inherited key "${key}" — an unguarded call threw for __proto__/valueOf, turning a bad upload into a 500`, () => {
    const anyBytes = Buffer.from("arbitrary-upload-bytes", "utf8");
    assert.doesNotThrow(
      () => hasMatchingSignature(anyBytes, key),
      `hasMatchingSignature must not throw for "${key}" — the old code did SIGNATURE_CHECKS[key](bytes) unguarded, and __proto__/valueOf resolve to non-function Object.prototype members that throw when called, turning a malicious upload into a 500 instead of a clean 400`,
    );
    assert.equal(
      hasMatchingSignature(anyBytes, key),
      false,
      `"${key}" must never report a matching signature — SIGNATURE_CHECKS["constructor"] resolves to the Object function, which is callable and returns a truthy value, so an "in"-based lookup would let arbitrary bytes pass as a "verified" upload and then get served from the app's own origin to unauthenticated callers`,
    );
  });
}

// ── DEFAULT_PRODUCT_LOGO ─────────────────────────────────────────────────────

test("DEFAULT_PRODUCT_LOGO: non-empty bytes with contentType image/svg+xml", () => {
  assert.ok(
    DEFAULT_PRODUCT_LOGO.bytes.length > 0,
    "the built-in mark must have actual bytes — an empty default would make /api/branding/productLogo serve nothing when no logo has been uploaded",
  );
  assert.equal(
    DEFAULT_PRODUCT_LOGO.contentType,
    "image/svg+xml",
    "the browser tab icon route depends on this content-type being svg for the built-in mark",
  );
});

test("DEFAULT_PRODUCT_LOGO: version matches brandingVersion of its own bytes", () => {
  assert.equal(
    DEFAULT_PRODUCT_LOGO.version,
    brandingVersion(DEFAULT_PRODUCT_LOGO.bytes),
    "the shipped version must be derived from the actual shipped bytes, or a cached immutable URL for the default mark could point at the wrong content",
  );
});

test("DEFAULT_PRODUCT_LOGO: the SVG is inert — no <script>, no onload, no href/xlink:href", () => {
  const svg = DEFAULT_PRODUCT_LOGO.bytes.toString("utf8");
  assert.doesNotMatch(
    svg,
    /<script/i,
    "the default mark is served from our own origin with no CSP — a <script> tag here would be self-inflicted script execution on the app's domain",
  );
  assert.doesNotMatch(
    svg,
    /\bonload\s*=/i,
    "an onload handler in the built-in SVG would run script on our own origin the moment the icon loads",
  );
  assert.doesNotMatch(
    svg,
    /(?:xlink:)?href\s*=/i,
    "href/xlink:href on an inline SVG can reference external resources or javascript: URIs — the built-in mark must carry none",
  );
});

test("DEFAULT_PRODUCT_LOGO: contains no restaurant-specific text — the product mark must stay generic", () => {
  const svg = DEFAULT_PRODUCT_LOGO.bytes.toString("utf8");
  assert.doesNotMatch(
    svg,
    /<text/i,
    "the built-in mark must be pure geometry with no <text> element — any text risks baking in a cafe's own name into the generic product default (CLAUDE.md: never hardcode a cafe's identity)",
  );
  assert.doesNotMatch(
    svg,
    /lucifer/i,
    "the generic product default must never carry this deployment's own cafe name",
  );
});
