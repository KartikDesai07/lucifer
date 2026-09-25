import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_MONEY_BREAKDOWN,
  MONEY_BREAKDOWN_KEYS,
  MONEY_BREAKDOWN_GROUP,
  MONEY_BREAKDOWN_SELECT,
  MONEY_BREAKDOWN_LINES,
  MONEY_NET_LABEL,
  ITEM_REVENUE_EXPR,
  lineRevenue,
  rewardLinesValue,
  orderMoneyContribution,
  foldMoneyBreakdown,
  pickMoneyBreakdown,
  type MoneyOrderView,
} from "./money-breakdown";
import { MONEY_FIXTURE_ORDERS, type MoneyFixtureOrder } from "./money-breakdown-fixtures";
import type { MoneyBreakdown } from "@/types";

// D10 S3 — money-breakdown.ts pins: contribution/identity per fixture, the
// fold, and structural/pipeline shape. Cross-file source pins (routes/cards/
// EOD/CSV/pages) live in money-breakdown-source-pins.test.ts (300-line cap),
// per plan .claude/plan/v2/d10-reports-breakdown-plan.md.

function toOrderView(f: MoneyFixtureOrder): MoneyOrderView {
  return {
    subtotal: f.subtotal,
    discount: f.discount,
    discountKind: f.discountKind,
    gstAmount: f.gstAmount,
    chargeAmount: f.chargeAmount,
    items: f.items,
  };
}

// ── §1 per-fixture contribution + identity ──────────────────────────────────

test("each fixture's total equals what computeOrderTotals returned (fixtures are built THROUGH it, never hand-typed)", () => {
  for (const f of MONEY_FIXTURE_ORDERS) {
    const base = f.subtotal - f.discount;
    const recomputedTotal = base + f.gstAmount + (f.chargeAmount ?? 0);
    assert.equal(
      f.total,
      recomputedTotal,
      `${f.label}: total must equal subtotal - discount + gstAmount + chargeAmount`,
    );
  }
});

test("orderMoneyContribution(fixture) deepEqual fixture.expected, per fixture", () => {
  for (const f of MONEY_FIXTURE_ORDERS) {
    assert.deepEqual(orderMoneyContribution(toOrderView(f)), f.expected, f.label);
  }
});

test("identity gross - discount - reward + gst + charges === total, EXACT, per fixture", () => {
  for (const f of MONEY_FIXTURE_ORDERS) {
    const { gross, discount, reward, gst, charges } = f.expected;
    assert.equal(
      gross - discount - reward + gst + charges,
      f.total,
      `${f.label}: identity must hold exactly`,
    );
  }
});

// ── §2 fold ──────────────────────────────────────────────────────────────────

test("foldMoneyBreakdown(MONEY_FIXTURE_ORDERS) equals the field-wise sum of expectations", () => {
  const folded = foldMoneyBreakdown(MONEY_FIXTURE_ORDERS.map(toOrderView));
  const summed: MoneyBreakdown = { ...EMPTY_MONEY_BREAKDOWN };
  for (const f of MONEY_FIXTURE_ORDERS) {
    for (const key of MONEY_BREAKDOWN_KEYS) summed[key] += f.expected[key];
  }
  assert.deepEqual(folded, summed);
});

test("the folded breakdown satisfies the identity against the summed total", () => {
  const folded = foldMoneyBreakdown(MONEY_FIXTURE_ORDERS.map(toOrderView));
  const totalSum = MONEY_FIXTURE_ORDERS.reduce((s, f) => s + f.total, 0);
  assert.equal(
    folded.gross - folded.discount - folded.reward + folded.gst + folded.charges,
    totalSum,
  );
});

test("foldMoneyBreakdown([]) deepEqual EMPTY_MONEY_BREAKDOWN, and is a FRESH object (not the shared constant)", () => {
  const folded = foldMoneyBreakdown([]);
  assert.deepEqual(folded, EMPTY_MONEY_BREAKDOWN);
  assert.notEqual(folded, EMPTY_MONEY_BREAKDOWN, "foldMoneyBreakdown([]) must not return the EMPTY_MONEY_BREAKDOWN reference itself");
});

test("pickMoneyBreakdown(undefined) and (null) both yield all-zero breakdowns", () => {
  assert.deepEqual(pickMoneyBreakdown(undefined), EMPTY_MONEY_BREAKDOWN);
  assert.deepEqual(pickMoneyBreakdown(null), EMPTY_MONEY_BREAKDOWN);
});

test("pickMoneyBreakdown({ gross: 5 }) yields gross 5, the rest 0", () => {
  assert.deepEqual(pickMoneyBreakdown({ gross: 5 }), {
    gross: 5,
    discount: 0,
    reward: 0,
    gst: 0,
    charges: 0,
  });
});

// ── §3 lineRevenue / rewardLinesValue ────────────────────────────────────────

test("lineRevenue: a reward line contributes 0; a normal line contributes price x qty", () => {
  assert.equal(lineRevenue({ price: 180, qty: 1, reward: true }), 0);
  assert.equal(lineRevenue({ price: 220, qty: 3 }), 660);
});

test("rewardLinesValue sums ONLY the reward lines", () => {
  const items = [
    { price: 220, qty: 1 },
    { price: 180, qty: 1, reward: true as const },
    { price: 50, qty: 2, reward: true as const },
  ];
  assert.equal(rewardLinesValue(items), 180 + 100);
});

// ── §4 structural parity ────────────────────────────────────────────────────

test("Object.keys(MONEY_BREAKDOWN_GROUP) deepEqual [...MONEY_BREAKDOWN_KEYS]", () => {
  assert.deepEqual(Object.keys(MONEY_BREAKDOWN_GROUP), [...MONEY_BREAKDOWN_KEYS]);
});

test("MONEY_BREAKDOWN_LINES has exactly 5 entries whose keys are exactly the 5 breakdown keys, each once", () => {
  assert.equal(MONEY_BREAKDOWN_LINES.length, 5);
  const lineKeys = MONEY_BREAKDOWN_LINES.map((l) => l.key).sort();
  assert.deepEqual(lineKeys, [...MONEY_BREAKDOWN_KEYS].sort());
  assert.equal(new Set(lineKeys).size, 5, "each key must appear exactly once");
});

test("MONEY_BREAKDOWN_LINES labels are unique and plain ASCII", () => {
  const labels = MONEY_BREAKDOWN_LINES.map((l) => l.label);
  assert.equal(new Set(labels).size, labels.length, "labels must be unique");
  for (const label of labels) {
    assert.ok(/^[\x20-\x7E]+$/.test(label), `label "${label}" must be plain ASCII`);
  }
});

test("MONEY_BREAKDOWN_LINES signs: gross '', discount '-', reward '-', gst '+', charges '+'", () => {
  const bySign = (key: keyof MoneyBreakdown) =>
    MONEY_BREAKDOWN_LINES.find((l) => l.key === key)?.sign;
  assert.equal(bySign("gross"), "");
  assert.equal(bySign("discount"), "-");
  assert.equal(bySign("reward"), "-");
  assert.equal(bySign("gst"), "+");
  assert.equal(bySign("charges"), "+");
  for (const line of MONEY_BREAKDOWN_LINES) {
    assert.ok(["", "-", "+"].includes(line.sign), `sign "${line.sign}" must be one of "", "-", "+"`);
  }
});

test('the gst line is labelled "GST added", not "collected" - gstAmount is only the tax ADDED on top (exclusive mode) and is 0 in inclusive mode, where "collected" would read as no tax on every bill (review C1)', () => {
  const gstLine = MONEY_BREAKDOWN_LINES.find((l) => l.key === "gst");
  assert.ok(gstLine, "a gst line must exist");
  assert.equal(gstLine?.label, "GST added");
});

test('MONEY_NET_LABEL is "Net sales"', () => {
  assert.equal(MONEY_NET_LABEL, "Net sales");
});

test("MONEY_BREAKDOWN_SELECT split on whitespace contains exactly the six expected paths", () => {
  const parts = MONEY_BREAKDOWN_SELECT.split(/\s+/).filter(Boolean);
  assert.deepEqual(
    [...parts].sort(),
    ["subtotal", "discount", "discountKind", "gstAmount", "chargeAmount", "items.reward"].sort(),
  );
});

// ── §5 pipeline shape pins (DB-free) ────────────────────────────────────────

test("ITEM_REVENUE_EXPR.$cond[0] deepEqual { $eq: [\"$items.reward\", true] } and $cond[1] === 0", () => {
  assert.deepEqual(ITEM_REVENUE_EXPR.$cond[0], { $eq: ["$items.reward", true] });
  assert.equal(ITEM_REVENUE_EXPR.$cond[1], 0);
});

test('MONEY_BREAKDOWN_GROUP.gst deepEqual { $sum: { $ifNull: ["$gstAmount", 0] } }', () => {
  assert.deepEqual(MONEY_BREAKDOWN_GROUP.gst, { $sum: { $ifNull: ["$gstAmount", 0] } });
});

test('MONEY_BREAKDOWN_GROUP.charges deepEqual { $sum: { $ifNull: ["$chargeAmount", 0] } }', () => {
  assert.deepEqual(MONEY_BREAKDOWN_GROUP.charges, { $sum: { $ifNull: ["$chargeAmount", 0] } });
});

test('JSON.stringify(MONEY_BREAKDOWN_GROUP.reward) contains "$discountKind", "reward", and "$$this.reward"', () => {
  const s = JSON.stringify(MONEY_BREAKDOWN_GROUP.reward);
  assert.ok(s.includes("$discountKind"), "must reference $discountKind");
  assert.ok(s.includes("reward"), 'must reference the "reward" literal (discountKind value)');
  assert.ok(s.includes("$$this.reward"), "must reference $$this.reward (the per-item reward flag)");
});

// §6 source pins split out to money-breakdown-source-pins.test.ts (300-line
// cap) — appended to package.json's test chain right after this file.

// ── §7 mutation-test the PURE tests (fail-first evidence for the fixture
// tests themselves — never mutates lib/money-breakdown.ts) ─────────────────

test("mutation test: flipping a sign in a fixture's expected breaks the contribution AND identity assertions", () => {
  const target = MONEY_FIXTURE_ORDERS.find((f) => f.expected.gst > 0 && f.expected.discount === 0);
  assert.ok(target, "need a fixture with gst > 0 to mutate meaningfully");
  if (!target) return;

  const mutated: MoneyBreakdown = { ...target.expected, gst: target.expected.gst + 1 };

  let contributionCaught = false;
  try {
    assert.deepEqual(orderMoneyContribution(toOrderView(target)), mutated);
  } catch {
    contributionCaught = true;
  }
  assert.ok(contributionCaught, "a mutated expected.gst must fail the contribution assertion");

  const identityHolds =
    mutated.gross - mutated.discount - mutated.reward + mutated.gst + mutated.charges === target.total;
  assert.ok(!identityHolds, "a mutated expected.gst must also break the total identity");
});
