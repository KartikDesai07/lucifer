// firstErrorLeaf: walks react-hook-form's nested error tree to the first leaf
// that carries a message, returning the dotted registered-field path setFocus()
// expects (CB-UI1 review fix - nested appearance/promoCodes errors used to
// surface as a generic toast with no focus).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldErrors } from "react-hook-form";

import { firstErrorLeaf } from "@/lib/form-errors";

type Shape = {
  restaurantName: string;
  appearance: { presetId: string; accentOverride: string };
  promoCodes: Array<{ code: string; value: number }>;
};

test("firstErrorLeaf: a flat field error returns its own key and message", () => {
  const errors = {
    restaurantName: { type: "too_small", message: "Restaurant name is required" },
  } as unknown as FieldErrors<Shape>;
  assert.deepEqual(firstErrorLeaf(errors), { path: "restaurantName", message: "Restaurant name is required" });
});

test("firstErrorLeaf: a nested object error descends to the leaf (appearance.accentOverride), not the container", () => {
  const errors = {
    appearance: {
      accentOverride: { type: "custom", message: "Enter a 6-digit hex color, e.g. #8a4a24" },
    },
  } as unknown as FieldErrors<Shape>;
  assert.deepEqual(firstErrorLeaf(errors), {
    path: "appearance.accentOverride",
    message: "Enter a 6-digit hex color, e.g. #8a4a24",
  });
});

test("firstErrorLeaf: an array error skips holes and returns the indexed leaf path (promoCodes.1.code)", () => {
  const errors = {
    promoCodes: [undefined, { code: { type: "custom", message: "Duplicate promo code" } }],
  } as unknown as FieldErrors<Shape>;
  assert.deepEqual(firstErrorLeaf(errors), { path: "promoCodes.1.code", message: "Duplicate promo code" });
});

test("firstErrorLeaf: an array-level error parked under root keeps the array path", () => {
  const rows: unknown[] = [];
  const errors = {
    promoCodes: Object.assign(rows, { root: { type: "too_big", message: "Keep it under 20 codes" } }),
  } as unknown as FieldErrors<Shape>;
  assert.deepEqual(firstErrorLeaf(errors), { path: "promoCodes", message: "Keep it under 20 codes" });
});

test("firstErrorLeaf: no errors -> undefined; a node with neither message nor children -> path with undefined message", () => {
  assert.equal(firstErrorLeaf({} as FieldErrors<Shape>), undefined);
  const errors = { appearance: { type: "custom" } } as unknown as FieldErrors<Shape>;
  assert.deepEqual(firstErrorLeaf(errors), { path: "appearance", message: undefined });
});
