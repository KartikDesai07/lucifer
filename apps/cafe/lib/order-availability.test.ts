import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MENU_REFUSAL_NAMES_SHOWN,
  MENU_REFUSAL_STATUS,
  lineLabel,
  menuIssueAction,
  menuIssueSentences,
  menuLineIssues,
  menuRefusalMessage,
  orderLinesRefusal,
  type MenuCheckedLine,
  type MenuProductSource,
} from "./order-availability";

// order-availability is PURE: the order routes pass their lean() product rows
// and the cart passes its menu list, so these fakes stand in for both.

const TEA: MenuProductSource = { _id: "p1", name: "Tea", price: 20, discount: 0, available: true, isActive: true };
const LATTE: MenuProductSource = {
  _id: "p2",
  name: "Latte",
  price: 100,
  discount: 10,
  available: true,
  isActive: true,
  variations: [
    { name: "Small", price: 120 },
    { name: "Large", price: 150 },
  ],
};
const line = (over: Partial<MenuCheckedLine> & Pick<MenuCheckedLine, "productId">): MenuCheckedLine => ({
  name: "Tea",
  price: 20,
  ...over,
});

test("status is 409 and the names cap is a small positive number", () => {
  assert.equal(MENU_REFUSAL_STATUS, 409);
  assert.ok(Number.isInteger(MENU_REFUSAL_NAMES_SHOWN) && MENU_REFUSAL_NAMES_SHOWN >= 1);
});

test("a plain line at the menu price passes — null", () => {
  assert.deepEqual(menuLineIssues([TEA], [line({ productId: "p1" })]), []);
  assert.equal(orderLinesRefusal([TEA], [line({ productId: "p1" })]), null);
});

test("a sized, discounted line passes at the discounted SIZE price", () => {
  // 150 with 10% off = 135 — the size's own price runs through the product discount.
  const ok = line({ productId: "p2", name: "Latte", variation: "Large", price: 135 });
  assert.deepEqual(menuLineIssues([LATTE], [ok]), []);
  // The base price with the discount (90) is NOT the Large price.
  const base = line({ productId: "p2", name: "Latte", variation: "Large", price: 90 });
  assert.deepEqual(menuLineIssues([LATTE], [base]).map((i) => [i.reason, i.expectedPrice]), [["price", 135]]);
});

test("a legacy doc with no discount / available / isActive field stays sellable", () => {
  const legacy: MenuProductSource = { _id: "p9", name: "Bun", price: 30 };
  assert.deepEqual(menuLineIssues([legacy], [line({ productId: "p9", name: "Bun", price: 30 })]), []);
});

test("hidden from the QR menu is not a reason — publicVisible is never read", () => {
  const hidden = { ...TEA, publicVisible: false } as MenuProductSource;
  assert.deepEqual(menuLineIssues([hidden], [line({ productId: "p1" })]), []);
});

test("reasons, first match wins: gone > out > price > renamed", () => {
  const cases: Array<[MenuProductSource[], MenuCheckedLine, string]> = [
    [[], line({ productId: "p1" }), "gone"], // no product doc
    [[{ ...TEA, isActive: false }], line({ productId: "p1" }), "gone"], // archived
    [[{ ...TEA, isActive: false, available: false }], line({ productId: "p1", price: 1 }), "gone"],
    [[LATTE], line({ productId: "p2", name: "Latte", variation: "Huge", price: 135 }), "gone"], // size removed
    [[{ ...TEA, available: false }], line({ productId: "p1", price: 1, name: "X" }), "out"],
    [[{ ...TEA, price: 25 }], line({ productId: "p1", name: "Old tea" }), "price"],
    [[{ ...TEA, name: "Masala tea" }], line({ productId: "p1" }), "renamed"],
  ];
  for (const [products, l, reason] of cases) {
    assert.deepEqual(menuLineIssues(products, [l]).map((i) => i.reason), [reason], JSON.stringify(l));
  }
});

test("discount-only drift and a fractional client price are price issues", () => {
  assert.deepEqual(
    menuLineIssues([{ ...TEA, discount: 50 }], [line({ productId: "p1" })]).map((i) => [i.reason, i.expectedPrice]),
    [["price", 10]],
  );
  assert.equal(menuLineIssues([TEA], [line({ productId: "p1", price: 20.5 })])[0]?.reason, "price");
});

test("a rename carries the menu's current name; indexes follow the judged array", () => {
  const issues = menuLineIssues(
    [TEA, { ...LATTE, name: "Café latte" }],
    [line({ productId: "p1" }), line({ productId: "p2", name: "Latte", variation: "Small", price: 108 })],
  );
  assert.deepEqual(issues, [{ index: 1, reason: "renamed", label: "Latte (Small)", currentName: "Café latte" }]);
});

test("an ObjectId-like _id is matched by String()", () => {
  const oid = { toString: () => "abc123" };
  assert.deepEqual(menuLineIssues([{ ...TEA, _id: oid }], [line({ productId: "abc123" })]), []);
});

test("labels: name alone, or name (variation)", () => {
  assert.equal(lineLabel({ productId: "p1", name: "Tea", price: 20 }), "Tea");
  assert.equal(lineLabel({ productId: "p2", name: "Latte", price: 135, variation: "Large" }), "Latte (Large)");
});

test("sentences come in a fixed order, one per reason, names de-duplicated", () => {
  const products = [{ ...TEA, available: false }, { ...LATTE, price: 101 }];
  const lines = [
    line({ productId: "p2", name: "Latte", price: 1 }),
    line({ productId: "p1" }),
    line({ productId: "p1" }), // same item twice → named once
    line({ productId: "zz", name: "Scone" }),
  ];
  assert.deepEqual(menuIssueSentences(menuLineIssues(products, lines)), [
    "Out of stock now: Tea.",
    "No longer on the menu: Scone.",
    "Price changed: Latte.",
  ]);
});

test("names past the cap become 'and N more' (built from the constant)", () => {
  const extra = 2;
  const count = MENU_REFUSAL_NAMES_SHOWN + extra;
  const lines = Array.from({ length: count }, (_, i) => line({ productId: `x${i}`, name: `Item ${i}` }));
  const shown = Array.from({ length: MENU_REFUSAL_NAMES_SHOWN }, (_, i) => `Item ${i}`).join(", ");
  assert.deepEqual(menuIssueSentences(menuLineIssues([], lines)), [
    `No longer on the menu: ${shown} and ${extra} more.`,
  ]);
});

test("the action line fits the reasons present", () => {
  const out = menuLineIssues([{ ...TEA, available: false }], [line({ productId: "p1" })]);
  const price = menuLineIssues([{ ...TEA, price: 30 }], [line({ productId: "p1" })]);
  const renamed = menuLineIssues([{ ...TEA, name: "Chai" }], [line({ productId: "p1" })]);
  assert.equal(menuIssueAction(out), "Remove them and try again.");
  assert.equal(menuIssueAction(price), "Update them and try again.");
  assert.equal(menuIssueAction(renamed), "Update them and try again.");
  assert.equal(menuIssueAction([...out, ...price]), "Remove or update them and try again.");
});

test("the refusal message = sentences + action; null when nothing is wrong", () => {
  const products = [{ ...TEA, available: false }];
  assert.equal(
    orderLinesRefusal(products, [line({ productId: "p1" })]),
    "Out of stock now: Tea. Remove them and try again.",
  );
  assert.equal(menuRefusalMessage(menuLineIssues(products, [line({ productId: "p1" })])), orderLinesRefusal(products, [line({ productId: "p1" })]));
  assert.equal(orderLinesRefusal([TEA], []), null);
});
