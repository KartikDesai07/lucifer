import { test } from "node:test";
import assert from "node:assert/strict";
import { billLinesOf } from "./bill-lines";
import type { OrderItem } from "@/types";

// Bill line grouping (owner, 2026-11-02): the same item ordered in different rounds is ONE line on the bill (and the
// Orders page detail), qty summed. "The same" = everything a bill line prints: name, variation, add-ons, "NO ..."
// removals, instructions, unit price, and the reward flag with its note. Anything different stays its own line.

const line = (over: Partial<OrderItem> = {}): OrderItem => ({
  productId: "p-coke",
  name: "Cold Drink",
  price: 40,
  qty: 1,
  modifiers: [],
  instructions: "",
  kotRound: 1,
  ...over,
});
const view = (lines: readonly OrderItem[]) => lines.map((l) => `${l.name}${l.variation ? ` (${l.variation})` : ""} x${l.qty} @${l.price}`);

test("no repeated line -> the SAME array (every bill without a repeat prints exactly as before)", () => {
  const items = [line(), line({ productId: "p-burger", name: "Burger", price: 120 })];
  assert.equal(billLinesOf(items), items);
  const none: OrderItem[] = [];
  assert.equal(billLinesOf(none), none);
});

test("the same cold drink in two rounds -> one line, qty summed, at the first line's place", () => {
  const items = [line({ kotRound: 1 }), line({ productId: "p-burger", name: "Burger", price: 120 }), line({ kotRound: 2 })];
  assert.deepEqual(view(billLinesOf(items)), ["Cold Drink x2 @40", "Burger x1 @120"]);
  assert.deepEqual(view(items), ["Cold Drink x1 @40", "Burger x1 @120", "Cold Drink x1 @40"], "the input is not changed");
  assert.equal(items[0].qty, 1, "the first line object is not mutated");
});

test("interleaved repeats keep first-appearance order and add every qty", () => {
  const burger = (qty: number) => line({ productId: "p-burger", name: "Burger", price: 120, qty });
  const items = [line({ qty: 2 }), burger(1), line({ qty: 3, kotRound: 2 }), line({ productId: "p-fries", name: "Fries", price: 90 }), burger(2)];
  assert.deepEqual(view(billLinesOf(items)), ["Cold Drink x5 @40", "Burger x3 @120", "Fries x1 @90"]);
});

test("same name but a different price, variation, instructions or removal stays its own line", () => {
  const cases: Array<[string, Partial<OrderItem>]> = [
    ["price", { price: 50 }],
    ["variation", { variation: "500 ml" }],
    ["instructions", { instructions: "No ice" }],
    ["removal", { removedModifiers: ["Ice"] }],
    ["add-on", { modifiers: ["Lemon"] }],
  ];
  for (const [what, over] of cases) {
    const items = [line(), line({ kotRound: 2, ...over })];
    assert.equal(billLinesOf(items).length, 2, `a different ${what} is a different line`);
  }
});

test("a different name at the same price stays its own line (Tea 20 and Coffee 20 are two lines)", () => {
  const tea = line({ productId: "p-tea", name: "Tea", price: 20 });
  const coffee = line({ productId: "p-coffee", name: "Coffee", price: 20, kotRound: 2 });
  assert.deepEqual(view(billLinesOf([tea, coffee])), ["Tea x1 @20", "Coffee x1 @20"]);
});

test("two reward lines with different notes stay apart (each note prints under its own line)", () => {
  const a = line({ reward: true, note: "Reward - free" });
  const b = line({ reward: true, note: "Birthday treat", kotRound: 2 });
  assert.equal(billLinesOf([a, b]).length, 2);
});

test("add-ons in a different order are the same line; a reward line never joins a paid one", () => {
  const a = line({ modifiers: ["Lemon", "Mint"] });
  const b = line({ modifiers: ["Mint", "Lemon"], kotRound: 2 });
  assert.deepEqual(billLinesOf([a, b]).map((l) => l.qty), [2]);
  const paid = line();
  const free = line({ kotRound: 2, reward: true, note: "Reward - free" });
  assert.equal(billLinesOf([paid, free]).length, 2, "FREE is never added into a paid line");
  const freeNoNote = line({ kotRound: 2, reward: true });
  assert.equal(billLinesOf([paid, freeNoNote]).length, 2, "the reward flag alone keeps them apart");
  const freeAgain = line({ kotRound: 3, reward: true, note: "Reward - free" });
  const merged = billLinesOf([free, freeAgain]);
  assert.deepEqual(merged.map((l) => [l.qty, l.reward]), [[2, true]], "two identical reward lines are one FREE line");
});

test("an older line with no instructions key matches one with an empty instructions string", () => {
  const legacy = { ...line() } as Partial<OrderItem>;
  delete legacy.instructions;
  const items = [legacy as OrderItem, line({ kotRound: 2 })];
  assert.deepEqual(billLinesOf(items).map((l) => l.qty), [2]);
});
