import { test } from "node:test";
import assert from "node:assert/strict";

import { parseImageRef, productImageUrl, r2Ref } from "./images";

// F2.11 — the opaque image ref. Everything outside lib/images.ts treats the
// stored string as opaque; these pin the ONLY interpretation point: the
// "r2:"-prefix discrimination (legacy bare public_ids stay Cloudinary) and the
// per-ref render dispatch. NOTE: under node --test the NEXT_PUBLIC_ vars are
// plain process.env reads (no build-time inlining), so tests set them directly.

const R2_BASE = "https://pub-abc123.r2.dev";
const CLOUD = "demo-cloud";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("parseImageRef: r2-prefixed refs parse to {store:'r2', key}; round-trips r2Ref", () => {
  assert.deepEqual(parseImageRef(r2Ref("products/a1.webp")), {
    store: "r2",
    ref: "products/a1.webp",
  });
  assert.deepEqual(parseImageRef("r2:tenant/x/products/b.png"), {
    store: "r2",
    ref: "tenant/x/products/b.png",
  });
});

test("parseImageRef: a bare string is a legacy Cloudinary public_id", () => {
  assert.deepEqual(parseImageRef("pos/products/abc123"), {
    store: "cloudinary",
    ref: "pos/products/abc123",
  });
});

test("parseImageRef: empty/degenerate refs are null (→ placeholder)", () => {
  assert.equal(parseImageRef(""), null);
  assert.equal(parseImageRef(undefined), null);
  assert.equal(parseImageRef(null), null);
  assert.equal(parseImageRef("r2:"), null); // prefix with no key
});

test("productImageUrl: r2 refs render from the public base, size param not applicable", () => {
  withEnv({ NEXT_PUBLIC_R2_PUBLIC_BASE_URL: R2_BASE }, () => {
    assert.equal(
      productImageUrl("r2:products/a1.webp", 300),
      `${R2_BASE}/products/a1.webp`,
    );
    // pre-sized at upload — the same URL regardless of requested size
    assert.equal(
      productImageUrl("r2:products/a1.webp", 80),
      `${R2_BASE}/products/a1.webp`,
    );
  });
});

test("productImageUrl: r2 base URL trailing slashes are normalised; key segments encoded", () => {
  withEnv({ NEXT_PUBLIC_R2_PUBLIC_BASE_URL: `${R2_BASE}/` }, () => {
    assert.equal(
      productImageUrl("r2:products/a b.webp"),
      `${R2_BASE}/products/a%20b.webp`,
    );
  });
});

test("productImageUrl: r2 ref with no configured base → null (placeholder)", () => {
  withEnv({ NEXT_PUBLIC_R2_PUBLIC_BASE_URL: undefined }, () => {
    assert.equal(productImageUrl("r2:products/a1.webp"), null);
  });
});

test("productImageUrl: legacy Cloudinary refs keep the sized transform URL", () => {
  withEnv({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: CLOUD }, () => {
    assert.equal(
      productImageUrl("pos/products/abc123", 300),
      `https://res.cloudinary.com/${CLOUD}/image/upload/w_300,h_300,c_fill,f_auto,q_auto/pos/products/abc123`,
    );
    assert.match(productImageUrl("pos/products/abc123", 80) ?? "", /w_80,h_80/);
  });
});

test("productImageUrl: fit:true switches the Cloudinary crop to c_fit (a wide logo isn't square-cropped); default/fit:false stays c_fill", () => {
  withEnv({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: CLOUD }, () => {
    assert.match(
      productImageUrl("pos/products/abc123", 300, { fit: true }) ?? "",
      /c_fit/,
    );
    assert.doesNotMatch(
      productImageUrl("pos/products/abc123", 300, { fit: true }) ?? "",
      /c_fill/,
    );
    assert.match(
      productImageUrl("pos/products/abc123", 300) ?? "",
      /c_fill/,
    );
  });
});

test("productImageUrl: an r2 ref ignores the fit option (pre-sized at upload, no transform)", () => {
  withEnv({ NEXT_PUBLIC_R2_PUBLIC_BASE_URL: R2_BASE }, () => {
    assert.equal(
      productImageUrl("r2:products/a1.webp", 300, { fit: true }),
      `${R2_BASE}/products/a1.webp`,
    );
  });
});

test("productImageUrl: cloudinary ref with no cloud name → null; empty ref → null", () => {
  withEnv({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: undefined }, () => {
    assert.equal(productImageUrl("pos/products/abc123"), null);
  });
  assert.equal(productImageUrl(undefined), null);
  assert.equal(productImageUrl(""), null);
});
