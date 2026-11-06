import { test } from "node:test";
import assert from "node:assert/strict";

import { brandingOf } from "@/lib/document-branding";
import { APP_NAME, BRANDING_VERSION_LEN } from "@/lib/constants";
import { DEFAULT_PRODUCT_LOGO_URL } from "@/lib/branding-default-logo";
import { productImageUrl } from "@/lib/images";

test("brandingOf: the cafe's name, trimmed", () => {
  assert.equal(brandingOf({ restaurantName: "  Blue Door  " }).title, "Blue Door", "trimmed name");
});

test("brandingOf: a blank or missing name falls back to the product's name", () => {
  assert.equal(brandingOf({ restaurantName: "   " }).title, APP_NAME, "blank name");
  assert.equal(brandingOf({}).title, APP_NAME, "no name");
  assert.equal(brandingOf(undefined).title, APP_NAME, "no settings yet");
});

test("brandingOf: no logo gives the built-in mark's URL", () => {
  assert.equal(brandingOf({}).iconHref, DEFAULT_PRODUCT_LOGO_URL, "no logo");
  assert.equal(brandingOf(undefined).iconHref, DEFAULT_PRODUCT_LOGO_URL, "no settings");
});

test("brandingOf: an uploaded logo gives its versioned URL", () => {
  const ref = `local:productLogo:${"a".repeat(BRANDING_VERSION_LEN)}`;
  const expected = productImageUrl(ref);
  assert.ok(expected, "landmark: the ref parses to a URL");
  assert.equal(brandingOf({ productLogo: ref }).iconHref, expected, "versioned logo URL");
  assert.notEqual(expected, DEFAULT_PRODUCT_LOGO_URL, "not the default");
});
