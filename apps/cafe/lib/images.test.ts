import { test } from "node:test";
import assert from "node:assert/strict";

import {
  brandingUrl,
  localRef,
  parseImageRef,
  productImageUrl,
  r2Ref,
} from "./images";

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

// ── local: ref scheme (F3 branding — logos stored in the cafe's own DB) ─────

const V = "0123456789ab"; // BRANDING_VERSION_LEN(12) lowercase hex

test("localRef/parseImageRef: round-trips a productLogo ref to {store:'local', ref:'productLogo', version}", () => {
  assert.deepEqual(
    parseImageRef(localRef("productLogo", V)),
    { store: "local", ref: "productLogo", version: V },
    "if this round-trip breaks, every productLogo-referencing URL fails to parse and the tab icon/login screen fall back to the placeholder",
  );
});

test("localRef/parseImageRef: round-trips a logo ref to {store:'local', ref:'logo', version}", () => {
  assert.deepEqual(
    parseImageRef(localRef("logo", V)),
    { store: "local", ref: "logo", version: V },
    "if this round-trip breaks, a cafe's own restaurant logo fails to parse on bills/kitchen tickets/sidebar",
  );
});

test("productImageUrl: a local ref renders /api/branding/<slot>?v=<version>, unaffected by R2/Cloudinary env being absent", () => {
  withEnv(
    {
      NEXT_PUBLIC_R2_PUBLIC_BASE_URL: undefined,
      NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: undefined,
    },
    () => {
      assert.equal(
        productImageUrl(localRef("productLogo", V)),
        `/api/branding/productLogo?v=${V}`,
        "this is the entire point of the feature: a logo must render with ZERO asset-plane config — no R2 bucket, no Cloudinary account",
      );
      assert.equal(
        productImageUrl(localRef("logo", V)),
        `/api/branding/logo?v=${V}`,
        "the restaurant logo must render with zero asset-plane config the same way the product logo does",
      );
    },
  );
});

test("productImageUrl: size and {fit:true} do not change a local URL — bytes are pre-sized client-side, there is no transform tier for local refs", () => {
  const bare = productImageUrl(localRef("productLogo", V));
  assert.equal(
    productImageUrl(localRef("productLogo", V), 80),
    bare,
    "a size param must not alter a local branding URL — there is nothing on the server to transform against, unlike Cloudinary",
  );
  assert.equal(
    productImageUrl(localRef("productLogo", V), 300, { fit: true }),
    bare,
    "fit:true must not alter a local branding URL — a differing URL per option would defeat the immutable cache on the branding route",
  );
});

test("parseImageRef: malformed local refs are null (→ placeholder), never a URL that 404s on every screen", () => {
  const cases: Array<[string, string]> = [
    ["local:", "empty slot and version"],
    ["local:productLogo", "no version at all"],
    ["local:productLogo:", "empty version"],
    ["local:nosuchslot:0123456789ab", "slot outside BRANDING_SLOTS"],
    ["local:productLogo:0123456789a", "version one char short of BRANDING_VERSION_LEN"],
    ["local:productLogo:0123456789ag", "non-hex character in the version"],
    ["local:productLogo:0123456789AB", "uppercase hex — VERSION_PATTERN is lowercase-only"],
    ["local:productLogo:0123456789ab:extra", "a trailing extra segment after the version"],
  ];
  for (const [ref, why] of cases) {
    assert.equal(
      parseImageRef(ref),
      null,
      `"${ref}" (${why}) must parse to null — building a URL from it would 404 every time this ref renders`,
    );
  }
});

test("brandingUrl: the unversioned route path for a slot (login screen / favicon probe, which have no session to read a version from)", () => {
  assert.equal(
    brandingUrl("logo"),
    "/api/branding/logo",
    "the public, unversioned branding route must be exactly this path — the login page and the browser's automatic /favicon.ico probe both depend on it",
  );
});

test("regression: legacy refs still resolve correctly now that a third (local) scheme exists", () => {
  withEnv(
    { NEXT_PUBLIC_R2_PUBLIC_BASE_URL: R2_BASE, NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: CLOUD },
    () => {
      assert.deepEqual(
        parseImageRef("pos/products/legacy123"),
        { store: "cloudinary", ref: "pos/products/legacy123" },
        "a v1 bare public_id must still be recognised as legacy Cloudinary after adding the local: scheme",
      );
      assert.equal(
        productImageUrl("pos/products/legacy123", 300),
        `https://res.cloudinary.com/${CLOUD}/image/upload/w_300,h_300,c_fill,f_auto,q_auto/pos/products/legacy123`,
        "a v1 product image must keep rendering from Cloudinary — the local scheme must not swallow refs that aren't its own prefix",
      );
      assert.deepEqual(
        parseImageRef(r2Ref("products/new1.webp")),
        { store: "r2", ref: "products/new1.webp" },
        "an r2: ref must still be recognised as R2 after adding the local: scheme",
      );
      assert.equal(
        productImageUrl("r2:products/new1.webp"),
        `${R2_BASE}/products/new1.webp`,
        "an R2 product image must keep rendering from the R2 public base — the local scheme must not swallow r2: refs",
      );
    },
  );
});
