import { test } from "node:test";
import assert from "node:assert/strict";

import { PRODUCT_ICON_KEYS } from "@pos/shared/product-icons";
import { productIconComponent } from "./product-icon-map";

test("productIconComponent: every PRODUCT_ICON_KEYS entry maps to a component", () => {
  assert.ok(PRODUCT_ICON_KEYS.length > 0, "vision guard: the catalogue must not be empty");
  for (const key of PRODUCT_ICON_KEYS) {
    const Icon = productIconComponent(key);
    assert.ok(Icon, `${key} must map to a lucide component`);
    assert.ok(
      typeof Icon === "function" || typeof Icon === "object",
      `${key}'s mapped value must be a component (function or forwardRef object), got ${typeof Icon}`,
    );
  }
});

test("productIconComponent: an unknown or prototype-polluting key returns null, never throws", () => {
  assert.equal(productIconComponent("constructor"), null);
  assert.equal(productIconComponent("toString"), null);
  assert.equal(productIconComponent("__proto__"), null);
  assert.equal(productIconComponent("not-a-real-icon"), null);
  assert.equal(productIconComponent(undefined), null);
  assert.equal(productIconComponent(""), null);
});
