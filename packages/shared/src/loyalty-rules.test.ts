import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMilestones,
  ladderOf,
  ladderProgress,
  mintedPromoCodes,
  type LoyaltyMilestoneLike,
} from "./loyalty-rules";

// CB-5A S1 — the loyaltyRules PURE math contract. DB-free unit tests over
// loyalty-rules.ts's own normalize/ladder/progress/level functions, mirroring
// public-diner.test.ts's "PURE math proven DB-free" split.

function milestone(at: number, overrides: Partial<LoyaltyMilestoneLike> = {}): LoyaltyMilestoneLike {
  return { at, kind: "flat", value: 50, item: "", ...overrides };
}

// ── normalizeMilestones ──────────────────────────────────────────────────────

test("normalizeMilestones: sorts ascending by `at`", () => {
  const rows = [milestone(10), milestone(5), milestone(8)];
  const result = normalizeMilestones(rows);
  assert.deepEqual(result.map((m) => m.at), [5, 8, 10]);
});

test("normalizeMilestones: drops `at` 0 and negative", () => {
  const rows = [milestone(0), milestone(-3), milestone(5)];
  const result = normalizeMilestones(rows);
  assert.deepEqual(result.map((m) => m.at), [5]);
});

test("normalizeMilestones: drops a non-integer `at`", () => {
  const rows = [milestone(5.5), milestone(5)];
  const result = normalizeMilestones(rows);
  assert.deepEqual(result.map((m) => m.at), [5]);
});

test("normalizeMilestones: duplicate `at` keeps the FIRST row in caller order", () => {
  const rows = [milestone(5, { item: "first" }), milestone(5, { item: "second" })];
  const result = normalizeMilestones(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.item, "first");
});

test("normalizeMilestones: minBill defaults to null when absent", () => {
  const result = normalizeMilestones([milestone(5)]);
  assert.equal(result[0]!.minBill, null);
});

test("normalizeMilestones: empty input yields empty output, no throw", () => {
  assert.deepEqual(normalizeMilestones([]), []);
});

// ── ladderOf ──────────────────────────────────────────────────────────────────

test("ladderOf: 0 milestones has cycleLength 0", () => {
  const ladder = ladderOf([]);
  assert.equal(ladder.cycleLength, 0);
  assert.deepEqual(ladder.milestones, []);
});

test("ladderOf: cycleLength is the LAST (highest) milestone's `at`, unsorted input included", () => {
  const ladder = ladderOf([milestone(10), milestone(5), milestone(8)]);
  assert.equal(ladder.cycleLength, 10);
});

// ── ladderProgress ────────────────────────────────────────────────────────────

test("ladderProgress: 0 milestones => every number 0, nextAt null, no NaN", () => {
  const ladder = ladderOf([]);
  const progress = ladderProgress(18, ladder);
  assert.deepEqual(progress, {
    cyclePosition: 0,
    completedCycles: 0,
    nextAt: null,
    toNext: 0,
    reachedThisCycle: 0,
  });
});

test("ladderProgress: 1 milestone at 8, stamps 18 => cycleLength 8, cyclePosition 2, completedCycles 2", () => {
  const ladder = ladderOf([milestone(8)]);
  assert.equal(ladder.cycleLength, 8);
  const progress = ladderProgress(18, ladder);
  assert.equal(progress.cyclePosition, 2);
  assert.equal(progress.completedCycles, 2);
});

test("ladderProgress: ladder [5,8,10] at stamps 7 => cyclePosition 7, reachedThisCycle 1, nextAt 8, toNext 1", () => {
  const ladder = ladderOf([milestone(5), milestone(8), milestone(10)]);
  const progress = ladderProgress(7, ladder);
  assert.equal(progress.cyclePosition, 7);
  assert.equal(progress.reachedThisCycle, 1);
  assert.equal(progress.nextAt, 8);
  assert.equal(progress.toNext, 1);
});

test("ladderProgress: ladder [5,8,10] at stamps 10 => completedCycles 1, cyclePosition 0, nextAt 5", () => {
  const ladder = ladderOf([milestone(5), milestone(8), milestone(10)]);
  const progress = ladderProgress(10, ladder);
  assert.equal(progress.completedCycles, 1);
  assert.equal(progress.cyclePosition, 0);
  assert.equal(progress.nextAt, 5);
});

test("ladderProgress: negative stamps clamp to 0, never NaN", () => {
  const ladder = ladderOf([milestone(5), milestone(8)]);
  const progress = ladderProgress(-5, ladder);
  assert.equal(progress.cyclePosition, 0);
  assert.equal(progress.completedCycles, 0);
  assert.equal(Number.isNaN(progress.cyclePosition), false);
});

test("ladderProgress: NaN stamps clamp to 0, never NaN out", () => {
  const ladder = ladderOf([milestone(5), milestone(8)]);
  const progress = ladderProgress(Number.NaN, ladder);
  assert.equal(progress.cyclePosition, 0);
  assert.equal(progress.completedCycles, 0);
});

test("D11: an absent qty normalizes to 1, never 0", () => {
  const [row] = normalizeMilestones([{ at: 5, kind: "item", value: 0, item: "Chai" }]);
  assert.equal(row!.qty, 1, "a pre-D11 row must still grant one dish");
});

test("D11: a configured qty is carried through unchanged", () => {
  const [row] = normalizeMilestones([{ at: 5, kind: "item", value: 0, item: "Chai", qty: 3 }]);
  assert.equal(row!.qty, 3);
});

test("D11: a broken stored qty (0, negative, fractional, null) falls back to 1", () => {
  const broken = [0, -2, 1.5, null] as const;
  broken.forEach((qty) => {
    const [row] = normalizeMilestones([{ at: 5, kind: "item", value: 0, item: "Chai", qty }]);
    assert.equal(row!.qty, 1, `qty ${String(qty)} must normalize to the identity, not to 0`);
  });
});

test("D8: itemProductId is carried through, and its absence resolves to null", () => {
  const [withRef] = normalizeMilestones([
    { at: 5, kind: "item", value: 0, item: "Chai", itemProductId: "60a1b2c3d4e5f60718293a4b" },
  ]);
  assert.equal(withRef!.itemProductId, "60a1b2c3d4e5f60718293a4b");
  const [noRef] = normalizeMilestones([{ at: 5, kind: "item", value: 0, item: "Chai" }]);
  assert.equal(noRef!.itemProductId, null, "a pre-D8 row is NOT resolvable, and must say so");
});

// ── mintedPromoCodes (CB-5D part 2 FINAL) ────────────────────────────────────
// SINGLE-HOMED derivation of "which codes did a milestone ladder mint" —
// resolvePromoDiscount (public-promo.ts) takes this as its mintedCodes
// argument so a milestone-minted code fences once-per-customer whether or
// not its Settings row is ticked.

test("mintedPromoCodes: skips rows with no promoCode configured (most milestones mint nothing)", () => {
  const rows = [milestone(5), milestone(10, { promoCode: null })];
  assert.deepEqual(mintedPromoCodes(rows), []);
});

test("mintedPromoCodes: collects a configured promoCode, normalized", () => {
  const rows = [milestone(5, { promoCode: " save10 " })];
  assert.deepEqual(mintedPromoCodes(rows), ["SAVE10"]);
});

test("mintedPromoCodes: dedupes when more than one rung mints the same code (case/space-insensitive)", () => {
  const rows = [milestone(5, { promoCode: "SAVE10" }), milestone(10, { promoCode: " save10 " })];
  assert.deepEqual(mintedPromoCodes(rows), ["SAVE10"]);
});

test("mintedPromoCodes: undefined/empty input is TOTAL — returns an empty array, never throws", () => {
  assert.deepEqual(mintedPromoCodes(undefined), []);
  assert.deepEqual(mintedPromoCodes([]), []);
});
