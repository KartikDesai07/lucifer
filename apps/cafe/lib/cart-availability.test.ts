import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cartMenuActions,
  cartMenuIssues,
  changedRowText,
  changedRowsShown,
  reAddOptsOf,
} from "./cart-availability";
import {
  MENU_REFUSAL_NAMES_SHOWN,
  menuLineIssues,
  menuRefusalMessage,
} from "./order-availability";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectivePrice, type CartItem, type UseCart } from "@/hooks/use-cart";
import { stripComments } from "./source-pin-utils";
import type { Product } from "@/types";

// Menu B2 - the cart-side verdict. Pure: fixtures stand in for the cart and
// the products list. The rule itself is tested in order-availability.test.ts.

const product = (over: Partial<Product> & Pick<Product, "_id" | "name" | "price">): Product => ({
  categoryId: "c1",
  discount: 0,
  available: true,
  image: "",
  modifiers: [],
  isActive: true,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const TEA = product({ _id: "p1", name: "Tea", price: 20 });
const LATTE = product({
  _id: "p2",
  name: "Latte",
  price: 100,
  variations: [
    { name: "Small", price: 120 },
    { name: "Large", price: 160 },
  ],
});

const line = (over: Partial<CartItem> & Pick<CartItem, "lineId" | "productId" | "name" | "price">): CartItem => ({
  qty: 1,
  modifiers: [],
  instructions: "",
  kotRound: 0,
  ...over,
});

const teaLine = line({ lineId: "p1|||", productId: "p1", name: "Tea", price: 20 });
const largeLatte = line({
  lineId: "p2|||Large",
  productId: "p2",
  name: "Latte",
  price: 150,
  variation: "Large",
  qty: 3,
  modifiers: ["oat milk", "extra shot"],
  removedModifiers: ["sugar"],
  instructions: "  less ice ",
});

test("no menu yet (undefined) or an empty list is never a verdict", () => {
  assert.equal(cartMenuIssues([teaLine]), null);
  assert.equal(cartMenuIssues([teaLine], undefined), null);
  assert.equal(cartMenuIssues([teaLine], []), null);
});

test("null when every unsent line is still sellable as it is", () => {
  assert.equal(cartMenuIssues([teaLine], [TEA, LATTE]), null);
  assert.equal(cartMenuIssues([], [TEA]), null);
});

test("sent lines and reward lines are never flagged, even when their item is gone", () => {
  const sent = line({ lineId: "#0:p1", productId: "p1", name: "Tea", price: 20, kotRound: 1 });
  const reward = line({ lineId: "#1:p9", productId: "p9", name: "Free cake", price: 90, kotRound: 1, reward: true });
  const unsentReward = line({ lineId: "p9||", productId: "p9", name: "Free cake", price: 90, reward: true });
  const offTea = { ...TEA, available: false };
  assert.equal(cartMenuIssues([sent, reward, unsentReward], [offTea]), null);
  // ...while an unsent plain line in the same cart still is.
  const notice = cartMenuIssues([sent, reward, teaLine], [offTea]);
  assert.deepEqual(notice?.unavailable, [{ lineId: "p1|||", label: "Tea" }]);
});

test("an out-of-stock, archived-and-absent or size-less line is unavailable", () => {
  const out = cartMenuIssues([teaLine], [{ ...TEA, available: false }]);
  assert.deepEqual(out?.unavailable, [{ lineId: "p1|||", label: "Tea" }]);
  assert.deepEqual(out?.changed, []);
  assert.deepEqual(out?.sentences, ["Out of stock now: Tea."]);
  assert.equal(out?.action, "Remove them and try again.");

  const gone = cartMenuIssues([teaLine], [LATTE]);
  assert.deepEqual(gone?.sentences, ["No longer on the menu: Tea."]);

  const noSize = cartMenuIssues([largeLatte], [{ ...LATTE, variations: [{ name: "Small", price: 120 }] }]);
  assert.deepEqual(noSize?.unavailable, [{ lineId: "p2|||Large", label: "Latte (Large)" }]);
});

test("a repriced line is a change with old -> new, and a rename carries the new name", () => {
  const priced = cartMenuIssues([largeLatte], [TEA, LATTE]);
  assert.equal(priced?.unavailable.length, 0);
  assert.equal(priced?.changed.length, 1);
  const row = priced!.changed[0];
  assert.equal(row.fromPrice, 150);
  assert.equal(row.toPrice, 160);
  assert.equal(row.toName, undefined);
  assert.equal(row.product, LATTE);
  assert.equal(changedRowText(row), "Latte (Large): ₹150 → ₹160");
  assert.equal(priced?.action, "Update them and try again.");

  const cold = line({ lineId: "p1|||", productId: "p1", name: "Cold Coffee", price: 20 });
  const renamed = cartMenuIssues([cold], [TEA]);
  assert.equal(changedRowText(renamed!.changed[0]), "Cold Coffee → Tea");
  assert.equal(renamed!.changed[0].toPrice, undefined);

  const both = line({ lineId: "p1|||", productId: "p1", name: "Cold Coffee", price: 15 });
  assert.equal(changedRowText(cartMenuIssues([both], [TEA])!.changed[0]), "Cold Coffee → Tea: ₹15 → ₹20");
});

test("two lines for one product are judged one by one", () => {
  const smallLatte = line({ lineId: "p2|||Small", productId: "p2", name: "Latte", price: 120, variation: "Small" });
  const notice = cartMenuIssues([smallLatte, largeLatte], [LATTE]);
  assert.deepEqual(
    notice?.changed.map((c) => c.lineId),
    ["p2|||Large"],
    "only the drifting size is flagged",
  );
});

test("the notice says exactly what the server's 409 says (one sentence builder)", () => {
  const offTea = { ...TEA, available: false };
  const cart = [teaLine, largeLatte];
  const menu = [offTea, LATTE];
  const notice = cartMenuIssues(cart, menu)!;
  const serverText = menuRefusalMessage(menuLineIssues(menu, cart));
  assert.equal([...notice.sentences, notice.action].join(" "), serverText);
  assert.equal(notice.action, "Remove or update them and try again.");
});

test("reAddOptsOf keeps qty, size, modifiers, removed modifiers and instructions exactly", () => {
  assert.deepEqual(reAddOptsOf(largeLatte), {
    qty: 3,
    variation: "Large",
    modifiers: ["oat milk", "extra shot"],
    removedModifiers: ["sugar"],
    instructions: "  less ice ",
  });
  assert.deepEqual(reAddOptsOf(teaLine), {
    qty: 1,
    variation: undefined,
    modifiers: [],
    removedModifiers: undefined,
    instructions: "",
  });
});

test("Remove them removes exactly the flagged unsent lines and touches nothing else", () => {
  const sentTea = line({ lineId: "#0:p1", productId: "p1", name: "Tea", price: 20, kotRound: 1 });
  const notice = cartMenuIssues([sentTea, teaLine, largeLatte], [{ ...TEA, available: false }, LATTE])!;
  const calls: string[] = [];
  const actions = cartMenuActions(notice, {
    removeFromCart: (id) => calls.push(`remove ${id}`),
    addToCart: () => calls.push("add"),
  });
  actions.onRemoveUnavailable();
  assert.deepEqual(calls, ["remove p1|||"], "the sent Tea and the repriced Latte stay");
});

// A fake cart that MODELS hooks/use-cart.ts: addToCart merges into an UNSENT line whose
// lineId === the add key and keeps that line's price, else appends a line at the product's
// price. The pin below ties the merge rule to the real source.
function fakeCart(initial: CartItem[]) {
  let lines = [...initial];
  const keyOf = (p: Product, o: { modifiers?: string[]; instructions?: string; variation?: string; removedModifiers?: string[] }) =>
    [p._id, [...(o.modifiers ?? [])].sort().join(","), (o.instructions ?? "").trim(), o.variation ?? ""].join("|") +
    (o.removedModifiers?.length ? "\u001e" + [...o.removedModifiers].sort().join("\u001f") : "");
  const editor: Pick<UseCart, "removeFromCart" | "addToCart"> = {
    removeFromCart: (id) => {
      lines = lines.filter((ci) => !(ci.lineId === id && ci.kotRound === 0));
    },
    addToCart: (p, opts = {}) => {
      const key = keyOf(p, opts);
      const qty = opts.qty ?? 1;
      const idx = lines.findIndex((ci) => ci.lineId === key && ci.kotRound === 0);
      if (idx >= 0) {
        lines = lines.map((ci, i) => (i === idx ? { ...ci, qty: ci.qty + qty } : ci));
        return;
      }
      const v = opts.variation ? p.variations?.find((x) => x.name === opts.variation) : undefined;
      const price = v ? effectivePrice({ price: v.price, discount: p.discount }) : effectivePrice(p);
      lines = [
        ...lines,
        {
          lineId: key, productId: p._id, name: p.name, price, qty, variation: opts.variation,
          modifiers: opts.modifiers ?? [], instructions: opts.instructions ?? "", kotRound: 0,
          ...(opts.removedModifiers?.length ? { removedModifiers: opts.removedModifiers } : {}),
        },
      ];
    },
  };
  return { editor, get lines() { return lines; } };
}

test("the fake cart's merge rule is the real one (use-cart.ts)", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("../hooks/use-cart.ts", import.meta.url)), "utf8"));
  assert.ok(src.includes("ci.lineId === key && ci.kotRound === 0"), "addToCart merges by lineId === key, unsent only");
  assert.ok(src.includes("next[idx] = { ...next[idx], qty: next[idx].qty + addQty };"), "a merge keeps the old line's price");
  assert.match(src, /lineId: key,\s*productId: product\._id,\s*name: product\.name,\s*price,\s*qty: addQty,/, "a new line is keyed by the key at the product's price");
  // Removals-first (G2) relies on remove dropping exactly the ONE unsent line with that lineId.
  assert.ok(src.includes("prev.filter((ci) => !(ci.lineId === lineId && ci.kotRound === 0)),"), "removeFromCart drops only the unsent line with that lineId");
});

test("Update them re-adds each changed line from the fresh product and keeps every option", () => {
  const sent = line({ lineId: "#0:p2|||Large", productId: "p2", name: "Latte", price: 150, variation: "Large", kotRound: 1 });
  const cart = fakeCart([teaLine, largeLatte, sent]);
  const notice = cartMenuIssues(cart.lines, [TEA, LATTE])!;
  cartMenuActions(notice, cart.editor).onUpdateChanged();
  const unsent = cart.lines.filter((l) => l.kotRound === 0 && l.productId === "p2");
  assert.equal(unsent.length, 1);
  const { lineId: _id, ...rest } = unsent[0];
  assert.deepEqual(rest, {
    productId: "p2", name: "Latte", price: 160, qty: 3, variation: "Large",
    modifiers: ["oat milk", "extra shot"], removedModifiers: ["sugar"], instructions: "  less ice ", kotRound: 0,
  });
  assert.deepEqual(cart.lines.filter((l) => l.kotRound === 1), [sent], "the sent line is untouched");
  assert.ok(cart.lines.includes(teaLine), "an unaffected line is untouched");
});

test("Update them cannot merge a legacy line into a local one mid-loop: qty is kept and the price is the new one", () => {
  const key = "p2|||Large";
  for (const order of ["legacy first", "local first"]) {
    const legacy = line({ lineId: `#0:${key}`, productId: "p2", name: "Latte", price: 150, variation: "Large", qty: 2 });
    const local = line({ lineId: key, productId: "p2", name: "Latte", price: 150, variation: "Large", qty: 1 });
    const cart = fakeCart(order === "legacy first" ? [legacy, local] : [local, legacy]);
    const notice = cartMenuIssues(cart.lines, [LATTE])!;
    assert.equal(notice.changed.length, 2, order);
    cartMenuActions(notice, cart.editor).onUpdateChanged();
    assert.equal(cart.lines.reduce((n, l) => n + l.qty, 0), 3, `${order}: no quantity lost`);
    assert.ok(cart.lines.every((l) => l.price === 160), `${order}: every line at the new price`);
  }
});

test("the notice lists at most the shared names cap of changed rows, then says how many more", () => {
  const many = Array.from({ length: MENU_REFUSAL_NAMES_SHOWN + 2 }, (_, i) => i);
  const products = many.map((i) => product({ _id: `q${i}`, name: `Item${i}`, price: 50 }));
  const lines = many.map((i) => line({ lineId: `q${i}||`, productId: `q${i}`, name: `Item${i}`, price: 40 }));
  const notice = cartMenuIssues(lines, products)!;
  const { shown, more } = changedRowsShown(notice.changed);
  assert.equal(shown.length, MENU_REFUSAL_NAMES_SHOWN);
  assert.equal(more, 2);
  assert.equal(changedRowsShown([]).more, 0);
});
