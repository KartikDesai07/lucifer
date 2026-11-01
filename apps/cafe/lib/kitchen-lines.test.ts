import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KITCHEN_CATEGORY_OFF_HINT,
  KITCHEN_CATEGORY_SWITCH_LABEL,
  KITCHEN_ITEM_ALWAYS_LABEL,
  KITCHEN_ITEM_NEVER_LABEL,
  KITCHEN_ITEM_SELECT_LABEL,
  KITCHEN_NO_KOT_TAG,
  KITCHEN_NOTHING_TO_SEND_MESSAGE,
  KITCHEN_PRINTER_SETUP_NOTE,
  KITCHEN_TOKEN_HINT,
  kitchenItemSameLabel,
  kitchenLinesOf,
  kitchenOrderOf,
  lineSkipsByMenu,
  orderSkipsKitchen,
  roundSkipsKitchen,
  skipsKitchenTicket,
  stampKitchenFlags,
  withKotRank,
  withNoKot,
  type ProductKitchenFacts,
} from "./kitchen-lines";

// Skip-KOT: the pure, client-safe reading and write-time resolution of the `noKot` stamp.

interface Line {
  productId: string;
  name: string;
  kotRound?: number;
  noKot?: boolean;
  reward?: boolean;
}
const burger = (over: Partial<Line> = {}): Line => ({ productId: "p-burger", name: "Burger", kotRound: 1, ...over });
const water = (over: Partial<Line> = {}): Line => ({ productId: "p-water", name: "Water", kotRound: 1, noKot: true, ...over });

// ── skipsKitchenTicket / withNoKot ───────────────────────────────────────────

test("skipsKitchenTicket: only an explicit true skips (absent, false and null read as a kitchen line)", () => {
  assert.equal(skipsKitchenTicket({ noKot: true }), true);
  assert.equal(skipsKitchenTicket({}), false);
  assert.equal(skipsKitchenTicket({ noKot: false }), false);
  assert.equal(skipsKitchenTicket({ noKot: null as unknown as boolean }), false);
});

test("withNoKot: skip stamps true; a kitchen line never carries the key; no-op cases return the same object", () => {
  const stamped = withNoKot(burger(), true);
  assert.equal(stamped.noKot, true);
  assert.equal(stamped.name, "Burger", "landmark: the other fields ride along");
  const already = water();
  assert.equal(withNoKot(already, true), already, "already stamped: same reference");
  const plain = burger();
  assert.equal(withNoKot(plain, false), plain, "a kitchen line with no key: same reference");
  const cleared = withNoKot(water(), false);
  assert.ok(!("noKot" in cleared), "clearing removes the key (omit-empty), never leaves false");
  assert.equal(cleared.name, "Water");
  const falsy = withNoKot({ ...burger(), noKot: false }, false);
  assert.ok(!("noKot" in falsy), "a stray false is dropped too");
});

// ── roundSkipsKitchen ────────────────────────────────────────────────────────

test("roundSkipsKitchen: true only when the round has lines and ALL of them skip", () => {
  assert.equal(roundSkipsKitchen([water({ kotRound: 1 }), water({ kotRound: 1 })], 1), true);
  assert.equal(roundSkipsKitchen([water({ kotRound: 1 }), burger({ kotRound: 1 })], 1), false, "one kitchen line = a KOT");
  assert.equal(roundSkipsKitchen([burger({ kotRound: 1 })], 1), false);
});

test("roundSkipsKitchen: only that round lines count; an empty round is NOT 'all skip'", () => {
  const items = [burger({ kotRound: 1 }), water({ kotRound: 2 })];
  assert.equal(roundSkipsKitchen(items, 2), true, "round 2 is water only");
  assert.equal(roundSkipsKitchen(items, 1), false, "round 1 is a burger");
  assert.equal(roundSkipsKitchen(items, 3), false, "no lines in round 3: nothing to skip, not a skip");
  assert.equal(roundSkipsKitchen([], 1), false, "no lines at all");
  assert.equal(roundSkipsKitchen([water({ kotRound: 0 })], 1), false, "an unfired line is not in round 1");
});

// ── orderSkipsKitchen ────────────────────────────────────────────────────────

test("orderSkipsKitchen: true only with at least one fired line and every fired line skipping", () => {
  assert.equal(orderSkipsKitchen({ items: [water(), water({ kotRound: 2 })] }), true);
  assert.equal(orderSkipsKitchen({ items: [water(), burger({ kotRound: 2 })] }), false);
  assert.equal(orderSkipsKitchen({ items: [burger()] }), false);
  assert.equal(orderSkipsKitchen({ items: [] }), false, "no lines");
  assert.equal(orderSkipsKitchen({ items: [water({ kotRound: 0 })] }), false, "nothing fired yet: not decided");
  assert.equal(orderSkipsKitchen({ items: [{ noKot: true }] }), false, "a legacy line without kotRound is unfired");
});

test("orderSkipsKitchen: an unfired kitchen line does not stop an all-skip fired order from skipping", () => {
  assert.equal(orderSkipsKitchen({ items: [water({ kotRound: 1 }), burger({ kotRound: 0 })] }), true);
});

// ── kitchenLinesOf / kitchenOrderOf ──────────────────────────────────────────

test("kitchenLinesOf: drops skip lines, keeps order, and returns the SAME array when nothing is dropped", () => {
  const lines = [burger(), water(), burger({ productId: "p-fries", name: "Fries" })];
  const kept = kitchenLinesOf(lines);
  assert.deepEqual(kept.map((l) => l.name), ["Burger", "Fries"]);
  const clean = [burger(), burger({ name: "Fries" })];
  assert.equal(kitchenLinesOf(clean), clean, "same reference");
  assert.deepEqual(kitchenLinesOf([water()]), [], "all skip: empty");
  const none: Line[] = [];
  assert.equal(kitchenLinesOf(none), none, "empty in, same empty array out");
});

test("kitchenOrderOf: removes skip lines from items, keeps every other key, never mutates the input", () => {
  const order = { orderId: "ORD-1", total: 90, items: [burger(), water()] };
  const out = kitchenOrderOf(order);
  assert.notEqual(out, order);
  assert.deepEqual(out.items.map((l) => l.name), ["Burger"]);
  assert.equal(out.orderId, "ORD-1");
  assert.equal(out.total, 90);
  assert.equal(order.items.length, 2, "the input order is untouched");
});

test("kitchenOrderOf: returns the SAME object reference when nothing is dropped", () => {
  const order = { orderId: "ORD-2", items: [burger(), burger({ name: "Fries" })] };
  assert.equal(kitchenOrderOf(order), order);
  const empty = { orderId: "ORD-3", items: [] as Line[] };
  assert.equal(kitchenOrderOf(empty), empty);
});

test("kitchenOrderOf: an all-skip order comes back with no lines", () => {
  const out = kitchenOrderOf({ orderId: "ORD-4", items: [water(), water({ name: "Soda" })] });
  assert.deepEqual(out.items, []);
});

// ── write-time resolution: (product.noKot ?? category) === true ──────────────

const SKIP_CAT = "cat-bev";
const KITCHEN_CAT = "cat-food";
const menu = new Map<string, ProductKitchenFacts>([
  ["p-burger", { categoryId: KITCHEN_CAT }],
  ["p-water", { categoryId: SKIP_CAT }], // no choice: follows its skipping category
  ["p-coffee", { categoryId: SKIP_CAT, noKot: false }], // "always send" beats the category
  ["p-sealed", { categoryId: KITCHEN_CAT, noKot: true }], // "no kitchen ticket" in a kitchen category
  ["p-orphan", {}], // no category recorded
]);
const skipCats = new Set([SKIP_CAT]);

test("lineSkipsByMenu: the item own choice wins, only an item with no choice follows its category", () => {
  assert.equal(lineSkipsByMenu("p-burger", menu, skipCats), false);
  assert.equal(lineSkipsByMenu("p-water", menu, skipCats), true, "category skips, item has no choice");
  assert.equal(lineSkipsByMenu("p-coffee", menu, skipCats), false, "item false overrides a skipping category");
  assert.equal(lineSkipsByMenu("p-sealed", menu, skipCats), true, "item true in a kitchen category");
  assert.equal(lineSkipsByMenu("p-orphan", menu, skipCats), false);
});

test("lineSkipsByMenu: an unknown or invalid product id is a kitchen line", () => {
  assert.equal(lineSkipsByMenu("p-ghost", menu, skipCats), false);
  assert.equal(lineSkipsByMenu("not-an-id", new Map(), skipCats), false);
  assert.equal(lineSkipsByMenu({ toString: () => "p-water" }, menu, skipCats), true, "an ObjectId-like id is stringified");
});

test("stampKitchenFlags: skip lines get noKot:true, kitchen lines carry NO key, kitchen reports a left-over kitchen line", () => {
  const lines: Line[] = [
    { productId: "p-burger", name: "Burger" },
    { productId: "p-water", name: "Water" },
    { productId: "p-coffee", name: "Coffee" },
    { productId: "p-sealed", name: "Sealed" },
  ];
  const r = stampKitchenFlags(lines, menu, skipCats);
  assert.deepEqual(
    r.lines.map((l) => [l.name, l.noKot]),
    [
      ["Burger", undefined],
      ["Water", true],
      ["Coffee", undefined],
      ["Sealed", true],
    ],
  );
  assert.ok(!("noKot" in r.lines[0]) && !("noKot" in r.lines[2]), "kitchen lines never get the key");
  assert.equal(r.kitchen, true);
  assert.ok(!("noKot" in lines[1]), "the input lines are not mutated");
});

test("stampKitchenFlags: all-skip -> kitchen:false; empty list -> kitchen:true; unknown product -> kitchen line", () => {
  const allSkip = stampKitchenFlags<Line>(
    [
      { productId: "p-water", name: "Water" },
      { productId: "p-sealed", name: "Sealed" },
    ],
    menu,
    skipCats,
  );
  assert.equal(allSkip.kitchen, false);
  assert.equal(allSkip.lines.every((l) => l.noKot === true), true, "landmark: both stamped");
  const empty = stampKitchenFlags([], menu, skipCats);
  assert.deepEqual(empty, { lines: [], kitchen: true });
  const ghost = stampKitchenFlags<Line>(
    [
      { productId: "p-ghost", name: "Mystery" },
      { productId: "p-water", name: "Water" },
    ],
    menu,
    skipCats,
  );
  assert.equal(ghost.kitchen, true);
  assert.ok(!("noKot" in ghost.lines[0]));
  assert.equal(ghost.lines[1].noKot, true, "landmark: the water beside it is still stamped");
});

test("stampKitchenFlags: a reward line follows its product like any other line, and keeps its reward flag", () => {
  const r = stampKitchenFlags<Line>([{ productId: "p-water", name: "Water", reward: true }], menu, skipCats);
  assert.equal(r.lines[0].noKot, true);
  assert.equal(r.lines[0].reward, true);
  assert.equal(r.kitchen, false);
});

test("stampKitchenFlags: re-stamping clears a stale flag when the menu now says kitchen", () => {
  const r = stampKitchenFlags([{ productId: "p-burger", name: "Burger", noKot: true }], menu, skipCats);
  assert.ok(!("noKot" in r.lines[0]));
  assert.equal(r.kitchen, true);
});

// ── KOT kitchen order: the category rank stamp and the in-round sort ─────────

interface RankedLine extends Line {
  kotRank?: number;
}
const dish = (name: string, kotRank: number | undefined, kotRound = 1, over: Partial<RankedLine> = {}): RankedLine => ({
  productId: `p-${name}`,
  name,
  kotRound,
  ...(kotRank !== undefined ? { kotRank } : {}),
  ...over,
});
const names = (lines: readonly RankedLine[]) => lines.map((l) => l.name);

test("withKotRank: stamps a rank, clears a stray key, and returns the SAME object when nothing changes", () => {
  const plain: RankedLine = burger();
  assert.equal(withKotRank(plain, undefined), plain, "no rank, no key: same object");
  const ranked = withKotRank(plain, 2);
  assert.equal(ranked.kotRank, 2);
  assert.ok(!("kotRank" in plain), "the input is not mutated");
  assert.equal(withKotRank(ranked, 2), ranked, "same rank: same object");
  assert.equal(withKotRank(ranked, 0).kotRank, 0, "rank 0 is a real rank (the first placed category)");
  const cleared = withKotRank(ranked, undefined);
  assert.ok(!("kotRank" in cleared), "a rank the menu no longer gives is removed, not set to undefined");
});

test("kitchenLinesOf: no line carries a rank -> the SAME array (every order before this feature prints as today)", () => {
  const lines = [dish("Soup", undefined), dish("Naan", undefined), dish("Tea", undefined)];
  assert.equal(kitchenLinesOf(lines), lines);
});

test("kitchenLinesOf: one round ranks [3,1,-,1] -> 1,1,3,- (ties and unplaced in the order added)", () => {
  const lines = [dish("Dessert", 3), dish("Starter", 1), dish("Unplaced", undefined), dish("Soup", 1)];
  assert.deepEqual(names(kitchenLinesOf(lines)), ["Starter", "Soup", "Dessert", "Unplaced"]);
  assert.deepEqual(names(lines), ["Dessert", "Starter", "Unplaced", "Soup"], "the input array is not reordered");
});

test("kitchenLinesOf: ranked lines already in order -> the SAME array (nothing moves, nothing allocated)", () => {
  const lines = [dish("Starter", 0), dish("Main", 1), dish("Unplaced", undefined)];
  assert.equal(kitchenLinesOf(lines), lines);
});

test("kitchenLinesOf: rounds stay together in the order they first appear; the sort is inside each round", () => {
  const lines = [dish("R1-Dessert", 2, 1), dish("R1-Starter", 0, 1), dish("R2-Main", 1, 2), dish("R2-Starter", 0, 2)];
  assert.deepEqual(names(kitchenLinesOf(lines)), ["R1-Starter", "R1-Dessert", "R2-Starter", "R2-Main"]);
});

test("kitchenLinesOf: skip lines are dropped, then the kitchen lines are sorted", () => {
  const lines = [dish("Dessert", 2), water(), dish("Starter", 0)];
  assert.deepEqual(names(kitchenLinesOf(lines)), ["Starter", "Dessert"]);
});

test("kitchenOrderOf: a ranked order comes back sorted (new object), every other key kept; unranked -> SAME object", () => {
  const order = { orderId: "ORD-9", total: 300, items: [dish("Dessert", 2), dish("Starter", 0)] };
  const out = kitchenOrderOf(order);
  assert.notEqual(out, order);
  assert.deepEqual(names(out.items), ["Starter", "Dessert"]);
  assert.equal(out.total, 300);
  assert.deepEqual(names(order.items), ["Dessert", "Starter"], "the input order is untouched");
  const plain = { orderId: "ORD-10", items: [dish("A", undefined), dish("B", undefined)] };
  assert.equal(kitchenOrderOf(plain), plain);
});

const RANK_STARTER = 0;
const RANK_MAIN = 1;
const ranks = new Map<string, number>([
  [KITCHEN_CAT, RANK_MAIN],
  [SKIP_CAT, RANK_STARTER], // a ranked category that skips: its skip lines still never get a rank
  ["cat-starter", RANK_STARTER],
]);
const rankedMenu = new Map<string, ProductKitchenFacts>([...menu, ["p-samosa", { categoryId: "cat-starter" }]]);

test("stampKitchenFlags: kitchen lines get their category rank, unranked/unknown get no key, skip lines never a rank", () => {
  const lines: RankedLine[] = [
    { productId: "p-burger", name: "Burger" },
    { productId: "p-samosa", name: "Samosa" },
    { productId: "p-water", name: "Water" },
    { productId: "p-coffee", name: "Coffee" }, // in the skipping category but "always send": a kitchen line, ranked
    { productId: "p-orphan", name: "Orphan" },
    { productId: "p-ghost", name: "Ghost" },
  ];
  const r = stampKitchenFlags(lines, rankedMenu, skipCats, ranks);
  assert.deepEqual(
    r.lines.map((l) => [l.name, l.kotRank]),
    [
      ["Burger", RANK_MAIN],
      ["Samosa", RANK_STARTER],
      ["Water", undefined],
      ["Coffee", RANK_STARTER],
      ["Orphan", undefined],
      ["Ghost", undefined],
    ],
  );
  assert.ok(!("kotRank" in r.lines[2]) && !("kotRank" in r.lines[4]) && !("kotRank" in r.lines[5]), "omit-empty");
  assert.equal(r.lines[2].noKot, true, "landmark: the water is still a skip line");
});

test("stampKitchenFlags: with no rank map (no kitchen order set) no line gets a key; a stray client rank is cleared", () => {
  const r = stampKitchenFlags<RankedLine>([{ productId: "p-burger", name: "Burger", kotRank: 7 }], menu, skipCats);
  assert.ok(!("kotRank" in r.lines[0]), "the server's stamp overwrites whatever the line carried");
  const unset = stampKitchenFlags<RankedLine>([{ productId: "p-burger", name: "Burger" }], menu, skipCats);
  assert.ok(!("kotRank" in unset.lines[0]));
});

// ── copy ─────────────────────────────────────────────────────────────────────

test("copy: every string is non-empty plain English, and the same-as-category label names the category choice", () => {
  const copy = [
    KITCHEN_CATEGORY_SWITCH_LABEL,
    KITCHEN_CATEGORY_OFF_HINT,
    KITCHEN_ITEM_SELECT_LABEL,
    KITCHEN_ITEM_ALWAYS_LABEL,
    KITCHEN_ITEM_NEVER_LABEL,
    KITCHEN_PRINTER_SETUP_NOTE,
    KITCHEN_TOKEN_HINT,
    KITCHEN_NO_KOT_TAG,
    KITCHEN_NOTHING_TO_SEND_MESSAGE,
  ];
  for (const s of copy) assert.ok(s.length > 0 && s === s.trim(), `non-empty, trimmed: ${s}`);
  assert.equal(KITCHEN_NO_KOT_TAG, "No KOT");
  assert.equal(KITCHEN_CATEGORY_SWITCH_LABEL, "Send to the kitchen (KOT)");
  assert.match(KITCHEN_CATEGORY_OFF_HINT, /bill/);
  assert.match(KITCHEN_NOTHING_TO_SEND_MESSAGE, /Nothing to send to the kitchen/);
  assert.equal(kitchenItemSameLabel(true), "Same as its category (no kitchen ticket)");
  assert.equal(kitchenItemSameLabel(false), "Same as its category (sent to the kitchen)");
});
