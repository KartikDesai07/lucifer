import { test } from "node:test";
import assert from "node:assert/strict";
import { planPointsSpend, type PointsPlanCard } from "./reward-points-plan";

// CB-7 S6 slice A — which lots a points spend takes from: first in, first out by use-by date, whole points, short
// lots -> null (never a clamp), and the expiry instant mirrors cardStateAt's strict `>`.

const NOW = new Date("2026-10-14T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const lot = (id: string, value: number, daysLeft: number, extra: Partial<PointsPlanCard> = {}): PointsPlanCard => ({
  id,
  kind: "points",
  status: "revealed",
  value,
  pointsSpent: 0,
  scratchBy: new Date(NOW.getTime() - DAY),
  validUntil: new Date(NOW.getTime() + daysLeft * DAY),
  ...extra,
});
const takes = (plan: ReturnType<typeof planPointsSpend>) => plan?.map((l) => [l.id, l.take]);

test("takes the lot that expires first (FIFO by validUntil), not the first in the array", () => {
  const plan = planPointsSpend([lot("late", 100, 20), lot("soon", 100, 2)], 60, NOW);
  assert.deepEqual(takes(plan), [["soon", 60]]);
});

test("a spend bigger than one lot continues into the next, in use-by order", () => {
  const plan = planPointsSpend([lot("c", 50, 30), lot("a", 40, 1), lot("b", 50, 5)], 100, NOW);
  assert.deepEqual(takes(plan), [["a", 40], ["b", 50], ["c", 10]]);
});

test("a partial lot gives only what is left of it, and records what was spent before", () => {
  const plan = planPointsSpend([lot("a", 100, 1, { pointsSpent: 70 }), lot("b", 100, 2)], 50, NOW);
  assert.deepEqual(plan, [
    { id: "a", take: 30, spentBefore: 70, value: 100 },
    { id: "b", take: 20, spentBefore: 0, value: 100 },
  ]);
});

test("equal use-by dates break the tie by id, so two attempts plan the same lots", () => {
  const plan = planPointsSpend([lot("zz", 10, 3), lot("aa", 10, 3)], 15, NOW);
  assert.deepEqual(takes(plan), [["aa", 10], ["zz", 5]]);
});

test("a fully spent lot is skipped, never a zero take", () => {
  const plan = planPointsSpend([lot("done", 50, 1, { pointsSpent: 50 }), lot("b", 50, 2)], 10, NOW);
  assert.deepEqual(takes(plan), [["b", 10]]);
});

test("short lots -> null (the server refuses; it never spends less than asked)", () => {
  assert.equal(planPointsSpend([lot("a", 40, 1), lot("b", 50, 2)], 91, NOW), null);
  assert.equal(planPointsSpend([], 1, NOW), null);
});

test("the exact use-by instant is still spendable; one millisecond later is not (cardStateAt's strict >)", () => {
  const at = lot("edge", 30, 0, { validUntil: NOW });
  assert.deepEqual(takes(planPointsSpend([at], 30, NOW)), [["edge", 30]]);
  assert.equal(planPointsSpend([at], 1, new Date(NOW.getTime() + 1)), null);
});

test("only revealed points lots count: ready, used, expired and other kinds are never taken", () => {
  const cards = [
    lot("ready", 50, 1, { status: "ready" }),
    lot("used", 50, 1, { status: "used" }),
    lot("old", 50, 1, { validUntil: new Date(NOW.getTime() - 1) }),
    lot("pct", 50, 1, { kind: "bill-percent" }),
  ];
  assert.equal(planPointsSpend(cards, 1, NOW), null);
});

test("a non-positive or fractional n plans nothing", () => {
  const cards = [lot("a", 50, 1)];
  assert.equal(planPointsSpend(cards, 0, NOW), null);
  assert.equal(planPointsSpend(cards, -5, NOW), null);
  assert.equal(planPointsSpend(cards, 1.5, NOW), null);
});

test("planning never mutates its input", () => {
  const cards = [lot("b", 50, 2), lot("a", 50, 1)];
  const before = JSON.stringify(cards);
  planPointsSpend(cards, 70, NOW);
  assert.equal(JSON.stringify(cards), before);
  assert.equal(cards[0].id, "b", "the caller's order is untouched");
});
