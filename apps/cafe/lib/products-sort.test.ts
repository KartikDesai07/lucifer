import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  DEFAULT_PRODUCT_SORT,
  nextProductSort,
  sortPriceOf,
  sortProducts,
} from "@/lib/products-sort";
import { ALERT_DASHBOARD_PATH, alertBarSuppressedForPath, alertDetailForPath } from "@/lib/alert-bar-scope";
import type { Category, Product } from "@/types";

// CB-UI2 (owner request 2026-09-23) — the Menu list's column sorting and the
// staff band's per-route collapse. Both rules are pure modules precisely so
// they can be pinned here rather than asserted through a rendered table.

const CATEGORIES = new Map<string, Category>([
  ["c1", { _id: "c1", name: "Brew" } as Category],
  ["c2", { _id: "c2", name: "Balls" } as Category],
]);

function product(over: Partial<Product> & { _id: string; name: string }): Product {
  return {
    price: 100,
    categoryId: "c1",
    discount: 0,
    available: true,
    ...over,
  } as Product;
}

const AERO = product({ _id: "1", name: "Aero Press", price: 250, categoryId: "c1" });
const COLD = product({ _id: "2", name: "Cold Brew", price: 250, categoryId: "c1" });
const VANILLA = product({ _id: "3", name: "Vanilla Balls", price: 30, categoryId: "c2", available: false });
const ROWS = [COLD, VANILLA, AERO];

const names = (rows: Product[]): string[] => rows.map((p) => p.name);

test("products-sort: the DEFAULT is the pre-existing shipped order — category name, then product name", () => {
  // Mutation this catches: changing the default seed, which would silently
  // re-order every operator's Menu screen on first paint.
  assert.deepEqual(DEFAULT_PRODUCT_SORT, { key: "category", dir: "asc" });
  assert.deepEqual(names(sortProducts(ROWS, DEFAULT_PRODUCT_SORT, CATEGORIES)), [
    "Vanilla Balls", // Balls
    "Aero Press", // Brew
    "Cold Brew",
  ]);
});

test("products-sort: name ascending and descending", () => {
  assert.deepEqual(names(sortProducts(ROWS, { key: "name", dir: "asc" }, CATEGORIES)), [
    "Aero Press",
    "Cold Brew",
    "Vanilla Balls",
  ]);
  assert.deepEqual(names(sortProducts(ROWS, { key: "name", dir: "desc" }, CATEGORIES)), [
    "Vanilla Balls",
    "Cold Brew",
    "Aero Press",
  ]);
});

test("products-sort: equal keys keep a stable A→Z name tiebreak, and the tiebreak is NOT inverted by desc", () => {
  // Aero and Cold are both ₹250 — price desc must still read A→Z between them,
  // which is what an operator scanning one price level expects.
  assert.deepEqual(names(sortProducts(ROWS, { key: "price", dir: "desc" }, CATEGORIES)), [
    "Aero Press",
    "Cold Brew",
    "Vanilla Balls",
  ]);
});

test("products-sort: a variations product sorts on its CHEAPEST variation — the number the row actually prints", () => {
  const sized = product({
    _id: "4",
    name: "Latte",
    price: 999,
    variations: [
      { name: "Large", price: 180 },
      { name: "Small", price: 120 },
    ],
  } as Partial<Product> & { _id: string; name: string });
  assert.equal(sortPriceOf(sized), 120, "must key on the minimum variation price, never the ignored base price");
  assert.deepEqual(names(sortProducts([AERO, sized], { key: "price", dir: "asc" }, CATEGORIES)), [
    "Latte",
    "Aero Press",
  ]);
});

test("products-sort: availability sorts unavailable first ascending, and absent `available` counts as available", () => {
  const absent = product({ _id: "5", name: "Zeta" });
  delete (absent as { available?: boolean }).available;
  const rows = sortProducts([absent, VANILLA], { key: "available", dir: "asc" }, CATEGORIES);
  assert.deepEqual(names(rows), ["Vanilla Balls", "Zeta"], "only an explicit false is 'out'");
});

test("products-sort: sortProducts never mutates the caller's array (a TanStack cache array must survive)", () => {
  const input = [COLD, VANILLA, AERO];
  const snapshot = names(input);
  sortProducts(input, { key: "name", dir: "desc" }, CATEGORIES);
  assert.deepEqual(names(input), snapshot);
});

test("products-sort: tapping a new column starts ascending; tapping the active one flips", () => {
  assert.deepEqual(nextProductSort({ key: "category", dir: "asc" }, "price"), { key: "price", dir: "asc" });
  assert.deepEqual(nextProductSort({ key: "price", dir: "asc" }, "price"), { key: "price", dir: "desc" });
  assert.deepEqual(nextProductSort({ key: "price", dir: "desc" }, "price"), { key: "price", dir: "asc" });
});

// ── the staff band's print-host block is DASHBOARD-ONLY ─────────────────────
// Owner, 2026-09-23: "muje all pages me nahi chahiye, muje only wo dashboard
// pe chahiye". The band's OTHER parts (open requests, unprinted self-orders)
// still render everywhere — only this block is scoped.

test("alert-bar-scope: the dashboard index shows the print-host block", () => {
  assert.equal(ALERT_DASHBOARD_PATH, "/");
  assert.equal(alertDetailForPath("/"), true);
});

test("alert-bar-scope: every other screen renders none of it — including the printing screens it used to show on", () => {
  // Mutation this catches: matching "/" as a PREFIX, which would make every
  // route in the app "the dashboard" and re-open the owner-reported bug where
  // the warning ate half a phone viewport on unrelated screens.
  for (const path of [
    "/products",
    "/reports",
    "/settings",
    "/settings/printing",
    "/pos",
    "/requests",
    "/orders",
    "/orders/abc123",
    "/customers",
  ]) {
    assert.equal(alertDetailForPath(path), false, `${path} must NOT render the print-host block`);
  }
});

test("alert-bar-scope: the POS terminal suppresses the WHOLE band — owner 2026-09-23 \"New Order me wo yellow line chahiye hi nahi\"", () => {
  // Mutation this catches: dropping the suppression (the band returns above
  // the terminal and pushes the cart down mid-order), or a prefix so loose it
  // silences unrelated routes and hides a real order-request alert.
  assert.equal(alertBarSuppressedForPath("/pos"), true);
  assert.equal(alertBarSuppressedForPath("/pos/anything"), true);
  for (const path of ["/", "/orders", "/requests", "/products", "/reports", "/positions"]) {
    assert.equal(alertBarSuppressedForPath(path), false, `${path} must still be able to show the band`);
  }
});

test("alert-bar-scope: the POS suppression is folded into `visible`, so the band's published height is dropped too", () => {
  // A band that renders null but keeps --pos-alert-h set would leave a blank
  // strip above the terminal — the layout effect keys off `visible`, so the
  // suppression must live THERE, not in the JSX.
  const src = readFileSync(
    path.join(fileURLToPath(new URL("../../../", import.meta.url)), "apps/cafe/components/orders/RequestAlertBar.tsx"),
    "utf8",
  );
  const visibleLine = src.match(/const visible = (.+);/);
  assert.ok(visibleLine, "positive landmark: a `const visible = ...;` line must exist");
  assert.match(
    visibleLine![1],
    /alertBarSuppressedForPath\(pathname\)/,
    "the POS suppression must be part of `visible` so removeProperty(POS_ALERT_HEIGHT_VAR) runs",
  );
});
