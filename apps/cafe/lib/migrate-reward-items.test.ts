import { test } from "node:test";
import assert from "node:assert/strict";
import { censusRewardItems, indexProductsByName } from "../scripts/migrate-reward-items";

// CB-5B D8 — the migration's DECISION TABLE, covered without a live cluster.
// The write itself is a single read-modify-write of loyaltyRules.milestones and
// is exercised by the live leg; what matters here is that the census never
// guesses: an ambiguous or unmatched name must stay unmigrated rather than
// become a reference to the wrong dish.

const index = indexProductsByName([
  { _id: "60a1b2c3d4e5f60718293a01", name: "Masala Chai" },
  { _id: "60a1b2c3d4e5f60718293a02", name: "Cold Coffee" },
  // Two active products genuinely share a name — the ambiguous case.
  { _id: "60a1b2c3d4e5f60718293a03", name: "Special" },
  { _id: "60a1b2c3d4e5f60718293a04", name: "Special" },
]);

test("census: an exact name match becomes a reference", () => {
  const c = censusRewardItems([{ at: 5, kind: "item", item: "Masala Chai" }], index);
  assert.equal(c.rows[0]!.verdict, "matched");
  assert.equal(c.rows[0]!.productId, "60a1b2c3d4e5f60718293a01");
  assert.equal(c.writable, 1);
  assert.equal(c.unresolved, 0);
});

test("census: matching is case- and whitespace-insensitive", () => {
  const c = censusRewardItems([{ at: 5, kind: "item", item: "  cold COFFEE " }], index);
  assert.equal(c.rows[0]!.verdict, "matched");
  assert.equal(c.rows[0]!.productId, "60a1b2c3d4e5f60718293a02");
});

test("census: an AMBIGUOUS name is never guessed — it is left for the owner", () => {
  const c = censusRewardItems([{ at: 8, kind: "item", item: "Special" }], index);
  assert.equal(c.rows[0]!.verdict, "ambiguous");
  assert.equal(c.rows[0]!.candidates, 2);
  assert.equal(c.writable, 0, "an ambiguous row must NOT be writable");
  assert.equal(c.unresolved, 1);
  assert.ok(!c.rows[0]!.productId, "no reference may be invented for an ambiguous name");
});

test("census: a name matching nothing is reported, not invented", () => {
  const c = censusRewardItems([{ at: 3, kind: "item", item: "Deleted Dish" }], index);
  assert.equal(c.rows[0]!.verdict, "no-match");
  assert.equal(c.unresolved, 1);
  assert.equal(c.writable, 0);
});

test("census: an ALREADY-LINKED rung is never rewritten from its name", () => {
  // The owner may have already fixed this one in the picker, possibly pointing
  // it at a dish whose name differs. Re-deriving from the name would undo that.
  const c = censusRewardItems(
    [{ at: 5, kind: "item", item: "Masala Chai", itemProductId: "60a1b2c3d4e5f60718293a09" }],
    index,
  );
  assert.equal(c.rows[0]!.verdict, "already-linked");
  assert.equal(c.rows[0]!.productId, "60a1b2c3d4e5f60718293a09", "the existing ref stands");
  assert.equal(c.writable, 0);
});

test("census: a blank name is its own verdict, and counts as needing the owner", () => {
  const c = censusRewardItems([{ at: 5, kind: "item", item: "" }], index);
  assert.equal(c.rows[0]!.verdict, "blank-name");
  assert.equal(c.unresolved, 1);
});

test("census: flat/percent rungs are ignored entirely", () => {
  const c = censusRewardItems(
    [
      { at: 3, kind: "flat", item: "" },
      { at: 5, kind: "percent", item: "Masala Chai" },
      { at: 8, kind: "item", item: "Masala Chai" },
    ],
    index,
  );
  assert.equal(c.totalMilestones, 3);
  assert.equal(c.itemMilestones, 1, "only the free-item rung is a migration candidate");
  assert.equal(c.rows.length, 1);
  // A percent rung carrying a leftover name must not be dragged into the
  // migration just because the name happens to match a product.
  assert.equal(c.rows[0]!.at, 8);
});

test("indexProductsByName: collects duplicates under one key and skips blank names", () => {
  const built = indexProductsByName([
    { _id: "a", name: "Tea" },
    { _id: "b", name: "tea" },
    { _id: "c", name: "   " },
  ]);
  assert.deepEqual(built.get("tea"), ["a", "b"]);
  assert.equal(built.size, 1, "a blank name is not indexable");
});

test("census: rows are identified by INDEX, so two rungs sharing an `at` stay distinct", () => {
  // The save-time Zod refinement rejects duplicate `at`, but a LEGACY stored
  // document predates that guarantee. Matching on `at` would hand both rungs
  // the SAME dish — silently wrong, and invisible on a green suite.
  const c = censusRewardItems(
    [
      { at: 5, kind: "item", item: "Masala Chai" },
      { at: 5, kind: "item", item: "Cold Coffee" },
    ],
    index,
  );
  assert.equal(c.rows.length, 2);
  assert.equal(c.rows[0]!.index, 0);
  assert.equal(c.rows[1]!.index, 1);
  assert.notEqual(
    c.rows[0]!.productId,
    c.rows[1]!.productId,
    "two rungs sharing an `at` must resolve to their OWN dishes",
  );
  assert.equal(c.rows[0]!.productId, "60a1b2c3d4e5f60718293a01");
  assert.equal(c.rows[1]!.productId, "60a1b2c3d4e5f60718293a02");
});

test("census: the index is the position in the FULL array, not among item rungs only", () => {
  // The apply step maps over every milestone, so an index that counted only
  // item rungs would write the reference onto the wrong row.
  const c = censusRewardItems(
    [
      { at: 2, kind: "flat" },
      { at: 3, kind: "percent" },
      { at: 5, kind: "item", item: "Masala Chai" },
    ],
    index,
  );
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0]!.index, 2, "the free-item rung sits at position 2 of the stored array");
});

test("census: a matched row carries the product's CURRENT name, not the typed one", () => {
  // Found in review (2026-09-13): writing only the reference left the ladder
  // showing the OLD typed string. A later rename then made the diner's rewards
  // tab and the printed bill disagree permanently, with no edit able to fix it.
  const names = new Map([["60a1b2c3d4e5f60718293a01", "Kadak Chai"]]);
  const c = censusRewardItems([{ at: 5, kind: "item", item: "Masala Chai" }], index, names);
  assert.equal(c.rows[0]!.verdict, "matched");
  assert.equal(c.rows[0]!.productName, "Kadak Chai", "the display name is re-read from the product");
});

test("census: with no name index, the typed name is kept rather than blanked", () => {
  // The index is optional so the pure decision table stays callable without
  // it; losing the name entirely would be worse than keeping a stale one.
  const c = censusRewardItems([{ at: 5, kind: "item", item: "Masala Chai" }], index);
  assert.equal(c.rows[0]!.productName, "Masala Chai");
});
