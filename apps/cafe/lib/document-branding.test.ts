import { test } from "node:test";
import assert from "node:assert/strict";

import { TITLE_PREFIX_RE, brandedTitle, brandingOf } from "@/lib/document-branding";
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

test("brandedTitle: no open-request prefix gives the cafe's title as it is", () => {
  assert.equal(brandedTitle("Sandbee POS", "Baseline Cafe"), "Baseline Cafe", "no prefix");
  assert.equal(brandedTitle("", "Baseline Cafe"), "Baseline Cafe", "an empty title");
});

test("brandedTitle: the pulse's (N) prefix on the current title is kept ahead of the cafe's title", () => {
  assert.equal(brandedTitle("(2) Sandbee POS", "Baseline Cafe"), "(2) Baseline Cafe", "the open-request count stays");
  assert.equal(brandedTitle("(12) Sandbee POS", "Baseline Cafe"), "(12) Baseline Cafe", "a two-digit count");
});

test("brandedTitle: an already branded title is unchanged (so a quiet screen writes nothing)", () => {
  assert.equal(brandedTitle("(2) Baseline Cafe", "Baseline Cafe"), "(2) Baseline Cafe", "with the prefix");
  assert.equal(brandedTitle("Baseline Cafe", "Baseline Cafe"), "Baseline Cafe", "without");
});

test("TITLE_PREFIX_RE: only a leading (digits) and a space is the pulse's prefix", () => {
  assert.ok(TITLE_PREFIX_RE.test("(3) Cafe"), "the pulse's prefix");
  assert.ok(!TITLE_PREFIX_RE.test("Cafe (3) "), "not in the middle");
  assert.ok(!TITLE_PREFIX_RE.test("(3)Cafe"), "not without the space");
  assert.equal(brandedTitle("(Beta) Old", "Cafe"), "Cafe", "a cafe name in brackets is not a count");
});
