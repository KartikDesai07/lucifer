import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pickActiveOrder,
  pickActiveOrders,
  greetingFor,
  itemNamesPreview,
  pickPopularItems,
  pickOfferItems,
  OFFER_ITEMS_MAX,
} from "../components/public/public-home-data";

// CB-6C S9 — behavioural pins for the pure Home data helpers added in
// components/public/public-home-data.ts (pickLastOrder is already pinned in
// lib/public-home-tab.test.ts; this file covers the four CB-6C additions).

// ── pickActiveOrder ──────────────────────────────────────────────────────────

test("pickActiveOrder returns the NEWEST pending/accepting row by createdAt, not array order", () => {
  const orders = [
    {
      code: "OLD1",
      data: {
        status: "pending" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        itemCount: 1,
        total: 100,
        items: [{ name: "Tea", qty: 1 }],
      },
    },
    {
      code: "NEW1",
      data: {
        status: "accepting" as const,
        createdAt: "2026-06-15T00:00:00.000Z",
        itemCount: 2,
        total: 200,
        items: [{ name: "Coffee", qty: 2 }],
      },
    },
    {
      code: "MID1",
      data: {
        status: "pending" as const,
        createdAt: "2026-03-01T00:00:00.000Z",
        itemCount: 3,
        total: 300,
        items: [{ name: "Sandwich", qty: 1 }],
      },
    },
  ] as unknown as Parameters<typeof pickActiveOrder>[0];

  const result = pickActiveOrder(orders);
  assert.ok(result !== null, "expected a resolved active order");
  assert.equal(result.code, "NEW1", "must pick the newest createdAt among active rows, not the first array element");
});

test("pickActiveOrder ignores accepted, rejected and unresolved (null data) rows", () => {
  const orders = [
    { code: "ACCEPTED1", data: { status: "accepted" as const, createdAt: "2026-06-01T00:00:00.000Z", itemCount: 1, total: 50, items: [] } },
    { code: "REJECTED1", data: { status: "rejected" as const, createdAt: "2026-06-02T00:00:00.000Z", itemCount: 1, total: 50, items: [] } },
    { code: "PENDING1", data: null },
  ] as unknown as Parameters<typeof pickActiveOrder>[0];

  assert.equal(pickActiveOrder(orders), null, "accepted/rejected/unresolved rows must never be reported as active");
});

test("pickActiveOrder returns null when given no rows at all", () => {
  assert.equal(pickActiveOrder([]), null, "an empty array must return null");
});

test("pickActiveOrder carries itemLines as {name, qty} pairs from data.items", () => {
  const orders = [
    {
      code: "A1",
      data: {
        status: "pending" as const,
        createdAt: "2026-06-01T00:00:00.000Z",
        itemCount: 2,
        total: 150,
        items: [
          { name: "Cappuccino", qty: 2, extraField: "ignored" },
          { name: "Fries", qty: 1, extraField: "ignored" },
        ],
      },
    },
  ] as unknown as Parameters<typeof pickActiveOrder>[0];

  const result = pickActiveOrder(orders);
  assert.ok(result !== null);
  assert.deepEqual(
    result.itemLines,
    [
      { name: "Cappuccino", qty: 2 },
      { name: "Fries", qty: 1 },
    ],
    "itemLines must carry only {name, qty} pairs, in the same order as data.items",
  );
});

// ── greetingFor ───────────────────────────────────────────────────────────────

test("greetingFor: boundary hours map to the documented English greetings", () => {
  const cases: Array<[number, string]> = [
    [4, "Good evening"], // small hours still read as "this evening"
    [5, "Good morning"], // morning starts at 5
    [11, "Good morning"], // still morning just before noon
    [12, "Good afternoon"], // afternoon starts at noon
    [16, "Good afternoon"], // still afternoon just before 5pm
    [17, "Good evening"], // evening starts at 5pm
    [23, "Good evening"], // late night is still evening
  ];
  for (const [hour, expected] of cases) {
    assert.equal(greetingFor(hour), expected, `hour ${hour} must greet "${expected}"`);
  }
});

// ── itemNamesPreview ─────────────────────────────────────────────────────────

test("itemNamesPreview: empty input returns an empty string", () => {
  assert.equal(itemNamesPreview([]), "");
});

test("itemNamesPreview: a single item at qty 1 shows the name only, no multiplier", () => {
  assert.equal(itemNamesPreview([{ name: "Cappuccino", qty: 1 }]), "Cappuccino");
});

test("itemNamesPreview: qty 2 adds the ×N multiplier", () => {
  assert.equal(itemNamesPreview([{ name: "Cappuccino", qty: 2 }]), "Cappuccino ×2");
});

test("itemNamesPreview: three items capped at max 2 reads 'A, B +1 more'", () => {
  const items = [
    { name: "A", qty: 1 },
    { name: "B", qty: 1 },
    { name: "C", qty: 1 },
  ];
  assert.equal(itemNamesPreview(items, 2), "A, B +1 more");
});

// ── pickPopularItems ─────────────────────────────────────────────────────────

test("pickPopularItems: keeps the POPULAR array's order, not the items array's order", () => {
  const items = [
    { id: "b", name: "B", price: 100, available: true },
    { id: "a", name: "A", price: 100, available: true },
  ] as unknown as Parameters<typeof pickPopularItems>[0];
  const popular = ["a", "b"];
  const result = pickPopularItems(items, popular, 5);
  assert.deepEqual(
    result.map((item) => item.id),
    ["a", "b"],
    "the result must follow the popular id list's order, not the items array's order",
  );
});

test("pickPopularItems: skips unknown ids (delisted/hidden) and unavailable items", () => {
  const items = [
    { id: "a", name: "A", price: 100, available: true },
    { id: "b", name: "B", price: 100, available: false },
  ] as unknown as Parameters<typeof pickPopularItems>[0];
  const popular = ["a", "b", "ghost"];
  const result = pickPopularItems(items, popular, 5);
  assert.deepEqual(
    result.map((item) => item.id),
    ["a"],
    "an unavailable item and an unknown id must both be skipped, never backfilled",
  );
});

test("pickPopularItems: caps the result at `limit`", () => {
  const items = [
    { id: "a", name: "A", price: 100, available: true },
    { id: "b", name: "B", price: 100, available: true },
    { id: "c", name: "C", price: 100, available: true },
  ] as unknown as Parameters<typeof pickPopularItems>[0];
  const popular = ["a", "b", "c"];
  const result = pickPopularItems(items, popular, 2);
  assert.equal(result.length, 2, "the result must be capped at the given limit");
  assert.deepEqual(result.map((item) => item.id), ["a", "b"]);
});

test("pickPopularItems: returns [] for undefined items/popular, and for limit 0", () => {
  const items = [{ id: "a", name: "A", price: 100, available: true }] as unknown as Parameters<
    typeof pickPopularItems
  >[0];
  const popular = ["a"];
  assert.deepEqual(pickPopularItems(undefined, popular, 5), [], "undefined items must return []");
  assert.deepEqual(pickPopularItems(items, undefined, 5), [], "undefined popular must return []");
  assert.deepEqual(pickPopularItems(items, popular, 0), [], "limit 0 must return []");
});

// ── pickOfferItems (CB-6D-A — "Daily offers" moves Menu -> Home) ───────────

test("pickOfferItems: keeps only items that are BOTH available and discount > 0", () => {
  const items = [
    { id: "a", name: "A", price: 100, available: true, discount: 10 },
    { id: "b", name: "B", price: 100, available: false, discount: 10 },
    { id: "c", name: "C", price: 100, available: true, discount: 0 },
    { id: "d", name: "D", price: 100, available: true, discount: 20 },
  ] as unknown as Parameters<typeof pickOfferItems>[0];

  const result = pickOfferItems(items);
  assert.deepEqual(
    result.map((item) => item.id),
    ["a", "d"],
    "only available items with a positive discount must survive — unavailable and zero/undiscounted items must be dropped",
  );
});

test("pickOfferItems: preserves the items array's own order (the live menu order), not a re-sort by discount size", () => {
  const items = [
    { id: "big", name: "Big discount", price: 100, available: true, discount: 50 },
    { id: "small", name: "Small discount", price: 100, available: true, discount: 5 },
  ] as unknown as Parameters<typeof pickOfferItems>[0];

  const result = pickOfferItems(items);
  assert.deepEqual(
    result.map((item) => item.id),
    ["big", "small"],
    "pickOfferItems must not reorder by discount size — it must follow the menu's own item order, same as the old PublicMenuOffers filter",
  );
});

test(`pickOfferItems: caps the result at the given limit, defaulting to OFFER_ITEMS_MAX (${OFFER_ITEMS_MAX})`, () => {
  const items = Array.from({ length: OFFER_ITEMS_MAX + 5 }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
    price: 100,
    available: true,
    discount: 10,
  })) as unknown as Parameters<typeof pickOfferItems>[0];

  const defaultResult = pickOfferItems(items);
  assert.equal(
    defaultResult.length,
    OFFER_ITEMS_MAX,
    `pickOfferItems with no explicit limit must cap at OFFER_ITEMS_MAX (${OFFER_ITEMS_MAX}), a phone-width scroller must never show the whole discounted list`,
  );

  const explicitResult = pickOfferItems(items, 3);
  assert.equal(explicitResult.length, 3, "an explicit limit must override the OFFER_ITEMS_MAX default");
});

test("pickOfferItems: returns [] for undefined items, and for limit 0", () => {
  const items = [{ id: "a", name: "A", price: 100, available: true, discount: 10 }] as unknown as Parameters<
    typeof pickOfferItems
  >[0];

  assert.deepEqual(pickOfferItems(undefined), [], "undefined items must return []");
  assert.deepEqual(pickOfferItems(items, 0), [], "limit 0 must return []");
});

// ── pickActiveOrders (CB-6D-B — Orders tab "Live now" can show MORE THAN ONE
// active order, unlike Home's single pickActiveOrder card) ─────────────────

test("pickActiveOrders: returns every pending/accepting row, sorted NEWEST first by createdAt", () => {
  const orders = [
    {
      code: "OLDACTIVE1",
      data: { status: "pending" as const, createdAt: "2026-01-01T00:00:00.000Z", itemCount: 1, total: 100, items: [{ name: "Tea", qty: 1 }] },
    },
    {
      code: "NEWACTIVE1",
      data: { status: "accepting" as const, createdAt: "2026-06-15T00:00:00.000Z", itemCount: 2, total: 200, items: [{ name: "Coffee", qty: 2 }] },
    },
    {
      code: "MIDACTIVE1",
      data: { status: "pending" as const, createdAt: "2026-03-01T00:00:00.000Z", itemCount: 3, total: 300, items: [{ name: "Sandwich", qty: 1 }] },
    },
  ] as unknown as Parameters<typeof pickActiveOrders>[0];

  const result = pickActiveOrders(orders);
  assert.deepEqual(
    result.map((o) => o.code),
    ["NEWACTIVE1", "MIDACTIVE1", "OLDACTIVE1"],
    "must return ALL active rows, sorted newest-first by createdAt — not just the single newest one",
  );
});

test("pickActiveOrders: ignores accepted, rejected and unresolved (null data) rows", () => {
  const orders = [
    { code: "ACCEPTED2", data: { status: "accepted" as const, createdAt: "2026-06-01T00:00:00.000Z", itemCount: 1, total: 50, items: [] } },
    { code: "REJECTED2", data: { status: "rejected" as const, createdAt: "2026-06-02T00:00:00.000Z", itemCount: 1, total: 50, items: [] } },
    { code: "PENDING2", data: null },
  ] as unknown as Parameters<typeof pickActiveOrders>[0];

  assert.deepEqual(pickActiveOrders(orders), [], "accepted/rejected/unresolved rows must never appear in the active list");
});

test("pickActiveOrders: returns [] when given no rows at all", () => {
  assert.deepEqual(pickActiveOrders([]), []);
});

// CB-6D-B contract: "pickActiveOrder(orders) becomes pickActiveOrders(orders)[0]
// ?? null (its existing behaviour pins ... must stay green — same newest-wins
// semantics; ties keep the FIRST seen ... use a stable sort)". This pins that
// EQUIVALENCE directly against a MIXED fixture (active + settled + null rows,
// out-of-chronological-order input) so a future edit that makes the two
// functions diverge (e.g. pickActiveOrder re-deriving its own filter/sort
// instead of delegating) fails here, not just in a behavioural coincidence.
test("pickActiveOrder(x) deep-equals pickActiveOrders(x)[0] ?? null on a mixed fixture (active + settled + null rows, out-of-order input)", () => {
  const orders = [
    { code: "MIX_SETTLED", data: { status: "accepted" as const, createdAt: "2026-05-01T00:00:00.000Z", itemCount: 1, total: 10, items: [] } },
    { code: "MIX_NULL", data: null },
    {
      code: "MIX_OLD_ACTIVE",
      data: { status: "pending" as const, createdAt: "2026-01-01T00:00:00.000Z", itemCount: 1, total: 10, items: [{ name: "A", qty: 1 }] },
    },
    {
      code: "MIX_NEW_ACTIVE",
      data: { status: "accepting" as const, createdAt: "2026-06-01T00:00:00.000Z", itemCount: 1, total: 10, items: [{ name: "B", qty: 1 }] },
    },
    { code: "MIX_REJECTED", data: { status: "rejected" as const, createdAt: "2026-06-02T00:00:00.000Z", itemCount: 1, total: 10, items: [] } },
  ] as unknown as Parameters<typeof pickActiveOrders>[0];

  const single = pickActiveOrder(orders);
  const plural = pickActiveOrders(orders);
  assert.deepEqual(single, plural[0] ?? null, "pickActiveOrder must equal pickActiveOrders(x)[0] ?? null on the same input");
  assert.ok(single !== null, "sanity: the mixed fixture must actually have an active row");
  assert.equal(single!.code, "MIX_NEW_ACTIVE", "sanity: the newest active row must win, matching pre-CB-6D-B newest-wins semantics");
});

test("pickActiveOrder([]) deep-equals pickActiveOrders([])[0] ?? null (both null)", () => {
  assert.deepEqual(pickActiveOrder([]), pickActiveOrders([])[0] ?? null);
  assert.equal(pickActiveOrder([]), null);
});
