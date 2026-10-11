import { test } from "node:test";
import assert from "node:assert/strict";

import { boxStateOf } from "@/components/public/rewards/ladder-state";
import type { DinerLevelProgress } from "@pos/shared/public-diner-cards";

function progress(over: Partial<DinerLevelProgress>): DinerLevelProgress {
  return { level: 1, levelCount: 2, round: 0, size: 8, filled: 2, stepsToNextCard: 2, nextBox: { level: 1, step: 4 }, ...over };
}

test("boxStateOf: boxes on steps 4 and 8 with 2 done: box 4 is next, box 8 is locked (the next box is not step filled+1)", () => {
  const p = progress({});
  assert.equal(boxStateOf(1, 4, p), "next");
  assert.equal(boxStateOf(1, 8, p), "locked");
});

test("boxStateOf: boxes up to the filled count are done, earlier levels are done, later levels are locked", () => {
  const p = progress({});
  assert.equal(boxStateOf(1, 1, p), "done");
  assert.equal(boxStateOf(1, 2, p), "done");
  assert.equal(boxStateOf(1, 3, p), "locked");
  const second = progress({ level: 2, filled: 1, nextBox: { level: 2, step: 3 } });
  assert.equal(boxStateOf(1, 8, second), "done");
  assert.equal(boxStateOf(2, 1, second), "done");
  assert.equal(boxStateOf(2, 3, second), "next");
  assert.equal(boxStateOf(3, 1, second), "locked");
});

test("boxStateOf: the next box can sit in a LATER level than the one the diner is in", () => {
  const p = progress({ filled: 8, nextBox: { level: 2, step: 2 } });
  assert.equal(boxStateOf(1, 8, p), "done");
  assert.equal(boxStateOf(2, 2, p), "next");
  assert.equal(boxStateOf(2, 4, p), "locked");
});

test("boxStateOf: a repeat of the last level (F5) marks the next box even at a step already counted as filled", () => {
  const p = progress({ level: 2, round: 1, filled: 5, nextBox: { level: 2, step: 3 } });
  assert.equal(boxStateOf(2, 3, p), "next", "next takes precedence over done");
  assert.equal(boxStateOf(2, 2, p), "done");
  assert.equal(boxStateOf(2, 6, p), "locked");
});

test("boxStateOf: no next box means no Next mark; no progress means plain rows", () => {
  const p = progress({ nextBox: null });
  assert.equal(boxStateOf(1, 4, p), "locked");
  assert.equal(boxStateOf(1, 1, p), "done");
  assert.equal(boxStateOf(1, 1, null), "plain");
});
