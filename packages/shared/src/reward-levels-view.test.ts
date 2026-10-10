import { test } from "node:test";
import assert from "node:assert/strict";
import { REWARD_NONE_LABEL_DEFAULT, optionLabel } from "./reward-levels-label";
import { ladderView, optionChances, optionCost, slotCost } from "./reward-levels-view";
import { REWARD_LABEL_MAX_LEN, type RewardLevel, type RewardOption, type RewardSlot } from "./reward-levels";

// CB-7 S1 — labels, odds, cost estimates and the diner's ladder. All derived from CONFIG, never from a roll.

const PRODUCT_ID = "0123456789abcdef01234567";
const CATEGORY_ID = "76543210fedcba9876543210";

const opt = <T extends RewardOption>(o: T): T => o;

// ── optionLabel ─────────────────────────────────────────────────────────────

test("optionLabel: every kind reads as plain English, ranges use an en dash, a fixed value is shown once", () => {
  const cases: [RewardOption, string][] = [
    [{ id: "a", weight: 1, kind: "bill-percent", min: 10, max: 10 }, "10% off the bill"],
    [{ id: "a", weight: 1, kind: "bill-percent", min: 5, max: 15 }, "5–15% off the bill"],
    [{ id: "a", weight: 1, kind: "bill-flat", min: 50, max: 50 }, "₹50 off the bill"],
    [{ id: "a", weight: 1, kind: "bill-flat", min: 20, max: 50 }, "₹20–₹50 off the bill"],
    [{ id: "a", weight: 1, kind: "product-percent", min: 10, max: 10, productId: PRODUCT_ID, productName: "Cold Coffee" }, "10% off one Cold Coffee"],
    [{ id: "a", weight: 1, kind: "category-percent", min: 10, max: 10, categoryId: CATEGORY_ID, categoryName: "Beverages" }, "10% off Beverages"],
    [{ id: "a", weight: 1, kind: "category-flat", min: 30, max: 30, categoryId: CATEGORY_ID, categoryName: "Beverages" }, "₹30 off Beverages"],
    [{ id: "a", weight: 1, kind: "free-item", productId: PRODUCT_ID, productName: "Cold Coffee", qty: 1 }, "Free Cold Coffee"],
    [{ id: "a", weight: 1, kind: "free-item", productId: PRODUCT_ID, productName: "Cold Coffee", qty: 2 }, "2 × Free Cold Coffee"],
    [{ id: "a", weight: 1, kind: "points", min: 50, max: 50 }, "50 points"],
    [{ id: "a", weight: 1, kind: "points", min: 20, max: 50 }, "20–50 points"],
    [{ id: "a", weight: 1, kind: "none" }, REWARD_NONE_LABEL_DEFAULT],
    [{ id: "a", weight: 1, kind: "none", label: "   " }, REWARD_NONE_LABEL_DEFAULT],
    [{ id: "a", weight: 1, kind: "none", label: "  Try again  " }, "Try again"],
  ];
  for (const [option, expected] of cases) assert.equal(optionLabel(option), expected, option.kind);
  assert.equal(REWARD_NONE_LABEL_DEFAULT, "Better luck next time");
});

test("optionLabel: a label longer than REWARD_LABEL_MAX_LEN is cut to exactly that length with a trailing ellipsis", () => {
  const long = optionLabel({
    id: "a",
    weight: 1,
    kind: "product-percent",
    min: 10,
    max: 10,
    productId: PRODUCT_ID,
    productName: "A".repeat(REWARD_LABEL_MAX_LEN),
  });
  assert.equal(long.length, REWARD_LABEL_MAX_LEN);
  assert.ok(long.endsWith("…"));
  const exact = optionLabel({ id: "a", weight: 1, kind: "none", label: "B".repeat(REWARD_LABEL_MAX_LEN) });
  assert.equal(exact, "B".repeat(REWARD_LABEL_MAX_LEN), "a label of exactly the limit is untouched");
});

// ── optionChances ───────────────────────────────────────────────────────────

const slotOf = (weights: number[]): Pick<RewardSlot, "options"> => ({
  options: weights.map((weight, i) => ({ id: `o${i}`, kind: "points" as const, weight, min: 1, max: 1 })),
});

test("optionChances: largest remainder — [1,1,1] → [34,33,33], ties go to the earlier option", () => {
  assert.deepEqual(optionChances(slotOf([1, 1, 1])), [34, 33, 33]);
  assert.deepEqual(optionChances(slotOf([1, 3, 2])), [17, 50, 33]);
  assert.deepEqual(optionChances(slotOf([1, 2])), [33, 67]);
  assert.deepEqual(optionChances(slotOf([5])), [100]);
  assert.deepEqual(optionChances(slotOf([])), []);
});

test("optionChances: always sums to exactly 100 across many weight shapes", () => {
  for (let a = 1; a <= 12; a++) {
    for (let b = 1; b <= 12; b++) {
      for (const c of [1, 7, 100]) {
        const chances = optionChances(slotOf([a, b, c]));
        assert.equal(
          chances.reduce((s, n) => s + n, 0),
          100,
          `[${a},${b},${c}] → ${chances.join(",")}`,
        );
      }
    }
  }
});

// ── optionCost / slotCost ───────────────────────────────────────────────────

const PRICES: Record<string, number> = { [PRODUCT_ID]: 200 };
const ctx = { exampleBill: 500, priceOf: (id: string) => PRICES[id] };

test("optionCost: percent and flat kinds on the example bill, in rupees to 2 dp", () => {
  assert.deepEqual(optionCost(opt({ id: "a", weight: 1, kind: "bill-percent", min: 5, max: 15 }), ctx), { avg: 50, worst: 75, priceKnown: true });
  assert.deepEqual(optionCost(opt({ id: "a", weight: 1, kind: "bill-percent", min: 1, max: 1 }), { exampleBill: 333 }), { avg: 3.33, worst: 3.33, priceKnown: true });
  assert.deepEqual(optionCost(opt({ id: "a", weight: 1, kind: "bill-flat", min: 20, max: 50 }), ctx), { avg: 35, worst: 50, priceKnown: true });
  assert.deepEqual(optionCost(opt({ id: "a", weight: 1, kind: "bill-flat", min: 20, max: 50 }), { exampleBill: 30 }), { avg: 28.23, worst: 30, priceKnown: true }, "a flat amount never exceeds the bill (mean of min(v, 30) over 20..50)");
  assert.deepEqual(optionCost(opt({ id: "a", weight: 1, kind: "category-flat", min: 30, max: 30, categoryId: CATEGORY_ID, categoryName: "B" }), ctx), { avg: 30, worst: 30, priceKnown: true });
});

test("optionCost: category percent treats the whole bill as the category, capped; product percent is ONE unit, capped", () => {
  const cat = opt({ id: "a", weight: 1, kind: "category-percent", min: 10, max: 20, categoryId: CATEGORY_ID, categoryName: "B" } as const);
  assert.deepEqual(optionCost(cat, ctx), { avg: 75, worst: 100, priceKnown: true });
  assert.deepEqual(optionCost({ ...cat, capRupees: 60 }, ctx), { avg: 58.64, worst: 60, priceKnown: true }); // true mean of the capped values, not min(75, 60)
  const prod = opt({ id: "a", weight: 1, kind: "product-percent", min: 10, max: 20, productId: PRODUCT_ID, productName: "CC" } as const);
  assert.deepEqual(optionCost(prod, ctx), { avg: 30, worst: 40, priceKnown: true });
  assert.deepEqual(optionCost({ ...prod, capRupees: 15 }, ctx), { avg: 15, worst: 15, priceKnown: true });
  assert.deepEqual(optionCost({ ...prod, min: 100, max: 100 }, ctx), { avg: 200, worst: 200, priceKnown: true }, "never more than one unit's price");
});

test("optionCost: the average is the true mean of the CAPPED values, not min(midpoint, cap)", () => {
  // ₹500 bill, 10–20%, cap ₹60: 10%→50, 11%→55, 12..20%→60 (capped) → (50 + 55 + 9×60) / 11 = 58.64
  const cat: RewardOption = { id: "a", weight: 1, kind: "category-percent", min: 10, max: 20, categoryId: CATEGORY_ID, categoryName: "B", capRupees: 60 };
  assert.deepEqual(optionCost(cat, ctx), { avg: 58.64, worst: 60, priceKnown: true });
  // The same arithmetic through bill-percent-style uncapped ranges still lands on the midpoint.
  assert.deepEqual(optionCost({ ...cat, capRupees: undefined }, ctx), { avg: 75, worst: 100, priceKnown: true });
  // product-percent: one unit at ₹200, 10–20%, cap ₹30 → 20,22,24,26,28 then 30 × 6 → (120 + 180) / 11 = 27.27
  const prod: RewardOption = { id: "a", weight: 1, kind: "product-percent", min: 10, max: 20, productId: PRODUCT_ID, productName: "CC", capRupees: 30 };
  assert.deepEqual(optionCost(prod, ctx), { avg: 27.27, worst: 30, priceKnown: true });
});

test("optionCost: a flat range on a small bill averages min(v, bill) exactly (closed form)", () => {
  // ₹40 bill, ₹20–₹60: v = 20..40 → 20..40 (sum 630, 21 values), v = 41..60 → 40 (20 values) → (630 + 800) / 41 = 34.878
  const flat: RewardOption = { id: "a", weight: 1, kind: "bill-flat", min: 20, max: 60 };
  assert.deepEqual(optionCost(flat, { exampleBill: 40 }), { avg: 34.88, worst: 40, priceKnown: true });
  assert.deepEqual(optionCost({ ...flat, kind: "category-flat", categoryId: CATEGORY_ID, categoryName: "B" } as RewardOption, { exampleBill: 40 }), { avg: 34.88, worst: 40, priceKnown: true });
  assert.deepEqual(optionCost(flat, { exampleBill: 500 }), { avg: 40, worst: 60, priceKnown: true }, "bill above the range: the midpoint");
  assert.deepEqual(optionCost(flat, { exampleBill: 20 }), { avg: 20, worst: 20, priceKnown: true }, "bill at the low end: always the bill");
  assert.deepEqual(optionCost(flat, { exampleBill: 10 }), { avg: 10, worst: 10, priceKnown: true }, "bill below the range");
  assert.deepEqual(optionCost(flat, { exampleBill: 40.5 }), { avg: 35.12, worst: 40.5, priceKnown: true }, "a fractional bill splits on its whole part");
});

test("optionCost: a huge flat range is computed in closed form, instantly", () => {
  const huge: RewardOption = { id: "a", weight: 1, kind: "bill-flat", min: 1, max: 100_000 };
  const started = Date.now();
  const cost = optionCost(huge, { exampleBill: 50 });
  assert.ok(Date.now() - started < 50, "no per-value loop over 100 000 values");
  // v = 1..50 → sum 1275; v = 51..100000 → 50 × 99 950 = 4 997 500; total 4 998 775 / 100 000 = 49.98775
  assert.deepEqual(cost, { avg: 49.99, worst: 50, priceKnown: true });
});

test("optionCost: unknown price costs 0 and is flagged; free-item = price × qty; points and none", () => {
  const prod = opt({ id: "a", weight: 1, kind: "product-percent", min: 10, max: 20, productId: PRODUCT_ID, productName: "CC" } as const);
  assert.deepEqual(optionCost(prod, { exampleBill: 500 }), { avg: 0, worst: 0, priceKnown: false }, "no priceOf at all");
  assert.deepEqual(optionCost(prod, { exampleBill: 500, priceOf: () => undefined }), { avg: 0, worst: 0, priceKnown: false });
  const free = opt({ id: "a", weight: 1, kind: "free-item", productId: PRODUCT_ID, productName: "CC", qty: 2 } as const);
  assert.deepEqual(optionCost(free, ctx), { avg: 400, worst: 400, priceKnown: true });
  assert.deepEqual(optionCost(free, { exampleBill: 500 }), { avg: 0, worst: 0, priceKnown: false });
  assert.deepEqual(optionCost({ id: "a", weight: 1, kind: "points", min: 20, max: 50 }, ctx), { avg: 35, worst: 50, priceKnown: true });
  assert.deepEqual(optionCost({ id: "a", weight: 1, kind: "none" }, ctx), { avg: 0, worst: 0, priceKnown: true });
});

test("slotCost: weight-averaged avg, the dearest worst, priceKnown only if every option's is", () => {
  const options: RewardOption[] = [
    { id: "a", weight: 1, kind: "bill-percent", min: 5, max: 15 }, // avg 50, worst 75
    { id: "b", weight: 3, kind: "none" },
  ];
  assert.deepEqual(slotCost({ options }, ctx), { avg: 12.5, worst: 75, priceKnown: true });
  const withFree: RewardOption[] = [...options, { id: "c", weight: 1, kind: "free-item", productId: PRODUCT_ID, productName: "CC", qty: 1 }];
  assert.deepEqual(slotCost({ options: withFree }, ctx), { avg: 50, worst: 200, priceKnown: true }); // (50×1 + 0×3 + 200×1) / 5
  assert.equal(slotCost({ options: withFree }, { exampleBill: 500 }).priceKnown, false);
  assert.deepEqual(slotCost({ options: [] }, ctx), { avg: 0, worst: 0, priceKnown: true });
});

// ── ladderView ──────────────────────────────────────────────────────────────

const box = (step: number): RewardSlot => ({
  step,
  scratchDays: 3,
  useDays: 7,
  options: [
    { id: "a", kind: "bill-percent", weight: 1, min: 5, max: 15 },
    { id: "b", kind: "none", weight: 1 },
  ],
});
const level = (size: number, steps: number[]): RewardLevel => ({ size, slots: steps.map(box) });

test("ladderView: position, filled and the bills left until the next card — through levels and the repeating last level", () => {
  const levels = [level(3, [3]), level(2, [1, 2])];
  const at = (done: number) => {
    const v = ladderView({ levels }, done);
    return [v.position?.levelIndex, v.position?.step, v.position?.repeat, v.filled, v.stepsToNextCard];
  };
  assert.deepEqual(at(0), [0, 1, 0, 0, 3]);
  assert.deepEqual(at(2), [0, 3, 0, 2, 1]);
  assert.deepEqual(at(3), [1, 1, 0, 0, 1]);
  assert.deepEqual(at(5), [1, 1, 1, 0, 1], "past the end the last level repeats");
  assert.deepEqual(at(6), [1, 2, 1, 1, 1]);
});

test("ladderView: lists every level and box in step order with labels and chances", () => {
  const v = ladderView({ levels: [{ size: 3, slots: [box(3), box(1)] }] }, 0);
  assert.equal(v.levels.length, 1);
  assert.equal(v.levels[0].size, 3);
  assert.deepEqual(
    v.levels[0].slots.map((s) => s.step),
    [1, 3],
  );
  assert.deepEqual(v.levels[0].slots[0], { step: 1, labels: ["5–15% off the bill", REWARD_NONE_LABEL_DEFAULT], chances: [50, 50] });
});

test("ladderView: a level with no boxes is skipped when counting; no boxes anywhere / no levels → null", () => {
  assert.equal(ladderView({ levels: [level(2, []), level(2, [2])] }, 0).stepsToNextCard, 4);
  assert.equal(ladderView({ levels: [level(3, [])] }, 0).stepsToNextCard, null);
  const none = ladderView({ levels: [] }, 4);
  assert.deepEqual([none.position, none.filled, none.levels, none.stepsToNextCard], [null, 0, [], null]);
  // the search is bounded: a lone box far in the repeat still resolves within one extra lap
  assert.equal(ladderView({ levels: [level(30, [30])] }, 0).stepsToNextCard, 30);
  assert.equal(ladderView({ levels: [level(30, [1])] }, 1).stepsToNextCard, 30, "the same box on the next lap");
});
