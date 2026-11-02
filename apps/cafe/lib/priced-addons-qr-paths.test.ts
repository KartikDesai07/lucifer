import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { toStatusItems } from "@/lib/order-request-edit";
import { buildRequestDoc } from "@/lib/order-request-intake";
import { orderRequestSchema, type IOrderRequestItem } from "@/models/OrderRequest";

// Priced add-ons (owner, 2026-11-02), QR side. Without `modifierPrices` in a
// pricing product read every amount silently reads as free, so each of the
// five product reads is pinned here; the stamp's carry points are pinned
// behaviorally (toStatusItems, buildRequestDoc, the model path).

const CAFE_ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

// Every pricing read of Product on the QR paths: [file, a landmark proving the
// pin is looking at the right .select(...)].
const PRODUCT_SELECTS: ReadonlyArray<[string, string]> = [
  ["app/api/public/order-request/route.ts", "modifiersPreselected"],
  ["app/api/public/order-request/[shortCode]/route.ts", "modifiersPreselected"],
  ["lib/order-request-create.ts", "modifiersPreselected"],
  ["lib/order-request-accept.ts", "modifiersPreselected"],
  ["app/api/public/menu/route.ts", "modifiersPreselected"],
];

for (const [file, landmark] of PRODUCT_SELECTS) {
  test(`PIN: ${file} selects modifierPrices on its Product read`, () => {
    const src = readSrc(file);
    const sel = src.match(/\.select\("([^"]*\bmodifiers\b[^"]*)"\)/);
    assert.ok(sel, "positive landmark: the Product .select(...) naming modifiers exists");
    assert.ok(sel[1].includes(landmark), `positive landmark: that select carries ${landmark}`);
    assert.ok(/\bmodifierPrices\b/.test(sel[1]), "the select must carry modifierPrices");
  });
}

const REQUEST_ITEM: IOrderRequestItem = {
  productId: "64f000000000000000000003" as unknown as IOrderRequestItem["productId"],
  name: "Pizza",
  price: 325,
  qty: 1,
  modifiers: ["Cheese Burst"],
  instructions: "",
};

test("toStatusItems carries the add-on stamp as fresh entries, omit-empty", () => {
  const priced = toStatusItems([{ ...REQUEST_ITEM, modifierPrices: [{ name: "Cheese Burst", price: 100 }] }]);
  assert.deepEqual(priced[0].modifierPrices, [{ name: "Cheese Burst", price: 100 }]);
  const plain = toStatusItems([REQUEST_ITEM]);
  assert.equal(plain[0].name, "Pizza", "positive landmark");
  assert.equal("modifierPrices" in plain[0], false);
  const empty = toStatusItems([{ ...REQUEST_ITEM, modifierPrices: [] }]);
  assert.equal("modifierPrices" in empty[0], false);
});

test("buildRequestDoc stores the stamp on a priced line and nothing on an unpriced one", () => {
  const input = {
    target: { kind: "parcel" },
    mobile: "9999999999",
    name: "Asha",
    items: [],
  } as unknown as Parameters<typeof buildRequestDoc>[0];
  const doc = buildRequestDoc(
    input,
    [
      { productId: "64f000000000000000000003", name: "Pizza", price: 325, qty: 1, modifiers: ["Cheese Burst"], modifierPrices: [{ name: "Cheese Burst", price: 100 }] },
      { productId: "64f000000000000000000004", name: "Coffee", price: 40, qty: 1, modifiers: [] },
    ],
    null,
    null,
    false,
  );
  assert.deepEqual(doc.items[0].modifierPrices, [{ name: "Cheese Burst", price: 100 }]);
  assert.equal(doc.items[1].name, "Coffee", "positive landmark");
  assert.equal("modifierPrices" in doc.items[1], false);
});

test("the OrderRequest item schema DECLARES modifierPrices (strict mode drops an undeclared path)", () => {
  const items = orderRequestSchema.path("items") as unknown as { schema: { path(p: string): unknown } };
  assert.ok(items.schema.path("removedModifiers"), "positive landmark: a sibling omit-empty path");
  assert.ok(items.schema.path("modifierPrices"), "modifierPrices path must be declared");
});

test("PIN: accept's drift check compares the add-on stamp, and its items copy carries it", () => {
  const src = readSrc("lib/order-request-accept.ts");
  assert.match(src, /PRICE_DRIFT_ERROR/, "positive landmark: the drift reject");
  assert.match(src, /sameModifierPrices\(/, "drift must compare the stamp");
  assert.match(src, /modifierPricesPart\(it\.modifierPrices\)/, "the written order line must carry the stamp");
});
