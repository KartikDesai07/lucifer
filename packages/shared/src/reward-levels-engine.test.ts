import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  billCountsForLevels,
  buildCardSnapshot,
  cardStateAt,
  deadlineFrom,
  gstinBlocksScratch,
  pickWeighted,
  pointsBalance,
  positionOf,
  revealPatch,
  rollValue,
  scratchCardsBlocked,
  scratchEnvBlocks,
  slotAt,
  type RewardRng,
} from "./reward-levels-engine";
import type { RewardCardSnapshot, RewardLevel, RewardOption, RewardSlot } from "./reward-levels";

// CB-7 S1 — the pure engine. Randomness is a scripted function here, the clock is a literal Date: nothing in this
// suite touches Math.random or the wall clock.

const PRODUCT_ID = "0123456789abcdef01234567";
const CATEGORY_ID = "76543210fedcba9876543210";

const lvl = (size: number, steps: number[] = []): RewardLevel => ({
  size,
  slots: steps.map((step) => ({
    step,
    scratchDays: 3,
    useDays: 7,
    options: [{ id: "a", kind: "points", weight: 1, min: 5, max: 10 }],
  })),
});

// ── positionOf ──────────────────────────────────────────────────────────────

test("positionOf: levels of size [3,2] — the exact table for n = 1..9, repeating the LAST level forever", () => {
  const levels = [lvl(3), lvl(2)];
  const got = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
    const p = positionOf(n, levels);
    return p && [p.levelIndex, p.step, p.repeat];
  });
  assert.deepEqual(got, [
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 0],
    [1, 1, 0],
    [1, 2, 0],
    [1, 1, 1],
    [1, 2, 1],
    [1, 1, 2],
    [1, 2, 2],
  ]);
});

test("positionOf: a single level repeats from its own start, and the first bill after the last box wraps", () => {
  assert.deepEqual(positionOf(1, [lvl(1)]), { levelIndex: 0, step: 1, repeat: 0 });
  assert.deepEqual(positionOf(2, [lvl(1)]), { levelIndex: 0, step: 1, repeat: 1 });
  assert.deepEqual(positionOf(4, [lvl(3)]), { levelIndex: 0, step: 1, repeat: 1 });
});

test("positionOf: no levels, n below 1 and a non-integer n are all null", () => {
  assert.equal(positionOf(1, []), null);
  assert.equal(positionOf(0, [lvl(3)]), null);
  assert.equal(positionOf(-2, [lvl(3)]), null);
  assert.equal(positionOf(1.5, [lvl(3)]), null);
  assert.equal(positionOf(Number.NaN, [lvl(3)]), null);
  assert.ok(positionOf(1, [lvl(3)]), "landmark: a valid n is not null");
});

test("slotAt: finds the box on that step, null on a step with no reward or a missing level", () => {
  const levels = [lvl(3, [2]), lvl(2, [1])];
  assert.equal(slotAt(levels, { levelIndex: 0, step: 2, repeat: 0 })?.step, 2);
  assert.equal(slotAt(levels, { levelIndex: 0, step: 1, repeat: 0 }), null);
  assert.equal(slotAt(levels, { levelIndex: 5, step: 1, repeat: 0 }), null);
});

test("billCountsForLevels: absent minBill counts everything; >= in rupees at the boundary", () => {
  assert.equal(billCountsForLevels(0, {}), true);
  assert.equal(billCountsForLevels(99, { minBill: 100 }), false);
  assert.equal(billCountsForLevels(100, { minBill: 100 }), true);
  assert.equal(billCountsForLevels(100.5, { minBill: 100 }), true);
});

// ── pickWeighted / rollValue ────────────────────────────────────────────────

const fixed = (value: number): RewardRng => () => value;

test("pickWeighted: EXACT enumeration — weights [1,3,2], r = 0..5 maps to options [0,1,1,1,2,2]", () => {
  const options = [{ weight: 1 }, { weight: 3 }, { weight: 2 }];
  const asked: number[] = [];
  const picked = [0, 1, 2, 3, 4, 5].map((r) =>
    options.indexOf(
      pickWeighted(options, (max) => {
        asked.push(max);
        return r;
      }),
    ),
  );
  assert.deepEqual(picked, [0, 1, 1, 1, 2, 2]);
  assert.ok(asked.every((m) => m === 6), "the rng is asked for the weight total, exclusive");
});

test("pickWeighted: throws on an empty list, a non-positive or fractional total, and an out-of-range random number", () => {
  assert.throws(() => pickWeighted([], fixed(0)));
  assert.throws(() => pickWeighted([{ weight: 0 }], fixed(0)));
  assert.throws(() => pickWeighted([{ weight: -1 }, { weight: 1 }], fixed(0)));
  assert.throws(() => pickWeighted([{ weight: 1.5 }], fixed(0)));
  assert.throws(() => pickWeighted([{ weight: 2 }], fixed(2)), "r === total is outside [0,total)");
  assert.throws(() => pickWeighted([{ weight: 2 }], fixed(-1)));
  assert.throws(() => pickWeighted([{ weight: 2 }], fixed(0.5)));
  assert.doesNotThrow(() => pickWeighted([{ weight: 2 }], fixed(1)), "landmark: the top valid r passes");
});

test("rollValue: inclusive at BOTH ends, and asks the rng for exactly max - min + 1", () => {
  const option: RewardOption = { id: "a", kind: "bill-percent", weight: 1, min: 5, max: 15 };
  let asked = -1;
  const rng = (r: number): RewardRng => (max) => {
    asked = max;
    return r;
  };
  assert.equal(rollValue(option, rng(0)), 5, "r = 0 → min");
  assert.equal(asked, 11, "15 - 5 + 1");
  assert.equal(rollValue(option, rng(10)), 15, "r = max - min → max");
  const single: RewardOption = { id: "a", kind: "points", weight: 1, min: 7, max: 7 };
  assert.equal(rollValue(single, rng(0)), 7);
  assert.equal(asked, 1, "a fixed value still asks for one slot");
});

test("rollValue: every ranged kind rolls, free-item and none are 0 and never ask the rng", () => {
  const ranged: RewardOption[] = [
    { id: "a", kind: "bill-percent", weight: 1, min: 1, max: 3 },
    { id: "a", kind: "bill-flat", weight: 1, min: 1, max: 3 },
    { id: "a", kind: "product-percent", weight: 1, min: 1, max: 3, productId: PRODUCT_ID, productName: "Cold Coffee" },
    { id: "a", kind: "category-percent", weight: 1, min: 1, max: 3, categoryId: CATEGORY_ID, categoryName: "Beverages" },
    { id: "a", kind: "category-flat", weight: 1, min: 1, max: 3, categoryId: CATEGORY_ID, categoryName: "Beverages" },
    { id: "a", kind: "points", weight: 1, min: 1, max: 3 },
  ];
  for (const o of ranged) assert.equal(rollValue(o, fixed(2)), 3, o.kind);
  const boom: RewardRng = () => {
    throw new Error("must not be called");
  };
  assert.equal(rollValue({ id: "a", kind: "free-item", weight: 1, productId: PRODUCT_ID, productName: "X", qty: 1 }, boom), 0);
  assert.equal(rollValue({ id: "a", kind: "none", weight: 1 }, boom), 0);
});

test("rollValue: a stored min above max (the READ twin never narrows) rolls within [lo, hi] and asks for hi - lo + 1", () => {
  const option: RewardOption = { id: "a", kind: "bill-flat", weight: 1, min: 20, max: 10 };
  let asked = -1;
  const rng = (r: number): RewardRng => (max) => {
    asked = max;
    return r;
  };
  assert.equal(rollValue(option, rng(0)), 10, "r = 0 → the lower end");
  assert.equal(asked, 11, "20 - 10 + 1, never a non-positive range");
  assert.equal(rollValue(option, rng(10)), 20, "r = hi - lo → the higher end");
});

test("rollValue: throws when the rng answers outside [0, hi - lo] (it must never abort silently into a wrong value)", () => {
  const option: RewardOption = { id: "a", kind: "bill-percent", weight: 1, min: 5, max: 15 }; // 11 wide
  assert.throws(() => rollValue(option, fixed(-1)));
  assert.throws(() => rollValue(option, fixed(11)));
  assert.throws(() => rollValue(option, fixed(1.5)));
  assert.doesNotThrow(() => rollValue(option, fixed(10)), "landmark: the top valid r passes");
});

test("buildCardSnapshot: a none option's label is stored trimmed, and only when it says something", () => {
  const labelOf = (label: string | undefined) =>
    buildCardSnapshot({
      id: "0123456789ab",
      issueKey: "step:1",
      source: "level",
      slot: { scratchDays: 1, useDays: 1, options: [{ id: "a", kind: "none", weight: 1, ...(label !== undefined ? { label } : {}) }] },
      rng: () => 0,
      now: NOW,
    });
  for (const blank of ["", "   "]) assert.ok(!("label" in labelOf(blank)), `${JSON.stringify(blank)} leaves no label key`);
  assert.ok(!("label" in labelOf(undefined)), "landmark: no label at all, none either");
  assert.equal(labelOf(" Try again ").label, "Try again");
});

// ── clocks ──────────────────────────────────────────────────────────────────

test("deadlineFrom: lands on 23:59:59.999 IST of the right day", () => {
  const issued = Date.parse("2026-11-12T14:30:00Z"); // 20:00 IST on 12 Nov
  assert.equal(deadlineFrom(issued, 3).toISOString(), "2026-11-15T18:29:59.999Z");
  // 23:00 IST on 12 Nov is still 12 Nov in the cafe, so +1 day is 13 Nov — not 14.
  assert.equal(deadlineFrom(Date.parse("2026-11-12T17:30:00Z"), 1).toISOString(), "2026-11-13T18:29:59.999Z");
});

const D = (iso: string): Date => new Date(iso);

test("cardStateAt: the deadline instant is still valid, one ms later is expired — for BOTH clocks", () => {
  const scratchBy = D("2026-11-15T18:29:59.999Z");
  const ready = { status: "ready" as const, scratchBy, validUntil: undefined };
  assert.equal(cardStateAt(ready, scratchBy), "ready");
  assert.equal(cardStateAt(ready, new Date(scratchBy.getTime() + 1)), "expired");
  const validUntil = D("2026-11-20T18:29:59.999Z");
  const revealed = { status: "revealed" as const, scratchBy, validUntil };
  assert.equal(cardStateAt(revealed, validUntil), "revealed");
  assert.equal(cardStateAt(revealed, new Date(validUntil.getTime() + 1)), "expired");
  // A revealed card past its SCRATCH deadline is judged on the use-by clock only.
  assert.equal(cardStateAt(revealed, new Date(scratchBy.getTime() + 1)), "revealed");
});

test("cardStateAt: used is used forever, and a revealed card without a validUntil is expired (fail closed)", () => {
  const scratchBy = D("2026-11-15T18:29:59.999Z");
  assert.equal(cardStateAt({ status: "used", scratchBy }, D("2030-01-01T00:00:00Z")), "used");
  assert.equal(cardStateAt({ status: "revealed", scratchBy }, D("2026-11-01T00:00:00Z")), "expired");
});

test("revealPatch: none → used at once; points → a lot with pointsSpent 0; others → validUntil = keepUntil", () => {
  const now = D("2026-11-12T14:30:00Z");
  assert.deepEqual(revealPatch({ kind: "none", useDays: 7 }, now), { status: "used", revealedAt: now, usedAt: now, keepUntil: now });
  const until = D("2026-11-19T18:29:59.999Z");
  assert.deepEqual(revealPatch({ kind: "points", useDays: 7 }, now), {
    status: "revealed",
    revealedAt: now,
    validUntil: until,
    keepUntil: until,
    pointsSpent: 0,
  });
  for (const kind of ["bill-percent", "bill-flat", "product-percent", "category-percent", "category-flat", "free-item"] as const) {
    const patch = revealPatch({ kind, useDays: 7 }, now);
    assert.deepEqual(patch, { status: "revealed", revealedAt: now, validUntil: until, keepUntil: until }, kind);
    assert.ok(!("pointsSpent" in patch) && !("usedAt" in patch), kind);
  }
});

// ── buildCardSnapshot ───────────────────────────────────────────────────────

function scripted(values: number[]): { rng: RewardRng; asked: number[] } {
  const asked: number[] = [];
  const queue = [...values];
  return {
    asked,
    rng: (max) => {
      asked.push(max);
      const v = queue.shift();
      assert.ok(v !== undefined, "rng called more often than scripted");
      return v;
    },
  };
}

const NOW = D("2026-11-12T14:30:00Z");

test("buildCardSnapshot: copies ONLY the picked option's fields; pool labels come from config", () => {
  const slot: Pick<RewardSlot, "scratchDays" | "useDays" | "options"> = {
    scratchDays: 3,
    useDays: 7,
    options: [
      { id: "aaa", kind: "bill-percent", weight: 1, min: 5, max: 15, minBill: 200 },
      { id: "bbb", kind: "product-percent", weight: 3, min: 10, max: 10, productId: PRODUCT_ID, productName: "Cold Coffee", capRupees: 80 },
      { id: "ccc", kind: "none", weight: 2, label: "  " },
    ],
  };
  const { rng, asked } = scripted([2, 0]); // r=2 → second option (weights 1,3,2), then roll 0
  const card = buildCardSnapshot({ id: "0123456789ab", issueKey: "step:4", source: "level", level: 1, step: 4, slot, rng, now: NOW });
  assert.deepEqual(asked, [6, 1], "pick over the weight total, then roll over max - min + 1");
  assert.deepEqual(card, {
    id: "0123456789ab",
    issueKey: "step:4",
    source: "level",
    level: 1,
    step: 4,
    optionId: "bbb",
    kind: "product-percent",
    value: 10,
    productId: PRODUCT_ID,
    productName: "Cold Coffee",
    capRupees: 80,
    pool: [
      { kind: "bill-percent", label: "5–15% off the bill", weight: 1 },
      { kind: "product-percent", label: "10% off one Cold Coffee", weight: 3 },
      { kind: "none", label: "Better luck next time", weight: 2 },
    ],
    issuedAt: NOW,
    scratchBy: D("2026-11-15T18:29:59.999Z"),
    useDays: 7,
    keepUntil: D("2026-11-15T18:29:59.999Z"),
    status: "ready",
  });
  for (const absent of ["campaignId", "title", "minBill", "categoryId", "qty", "label", "revealedAt", "validUntil", "usedAt", "pointsSpent"]) {
    assert.ok(!(absent in card), `${absent} is absent, not an undefined key`);
  }
});

test("buildCardSnapshot: every kind copies its own fields (and a campaign card carries campaignId + title)", () => {
  const cases: { option: RewardOption; extra: Partial<RewardCardSnapshot>; value: number }[] = [
    { option: { id: "a", kind: "bill-flat", weight: 1, min: 20, max: 50, minBill: 300 }, extra: { minBill: 300 }, value: 20 },
    {
      option: { id: "a", kind: "category-percent", weight: 1, min: 5, max: 5, categoryId: CATEGORY_ID, categoryName: "Beverages", capRupees: 60, minBill: 100 },
      extra: { categoryId: CATEGORY_ID, categoryName: "Beverages", capRupees: 60, minBill: 100 },
      value: 5,
    },
    {
      option: { id: "a", kind: "category-flat", weight: 1, min: 30, max: 30, categoryId: CATEGORY_ID, categoryName: "Beverages" },
      extra: { categoryId: CATEGORY_ID, categoryName: "Beverages" },
      value: 30,
    },
    {
      option: { id: "a", kind: "free-item", weight: 1, productId: PRODUCT_ID, productName: "Cold Coffee", qty: 2, minBill: 150 },
      extra: { productId: PRODUCT_ID, productName: "Cold Coffee", qty: 2, minBill: 150 },
      value: 0,
    },
    { option: { id: "a", kind: "points", weight: 1, min: 20, max: 50 }, extra: {}, value: 20 },
    { option: { id: "a", kind: "none", weight: 1, label: "Try again" }, extra: { label: "Try again" }, value: 0 },
  ];
  for (const { option, extra, value } of cases) {
    const slot = { scratchDays: 1, useDays: 1, options: [option] };
    const card = buildCardSnapshot({
      id: "0123456789ab",
      issueKey: "camp:c1",
      source: "campaign",
      campaignId: "c1",
      title: "Diwali",
      slot,
      rng: () => 0,
      now: NOW,
    });
    assert.equal(card.value, value, option.kind);
    assert.equal(card.campaignId, "c1");
    assert.equal(card.title, "Diwali");
    assert.ok(!("level" in card) && !("step" in card));
    const { id, issueKey, source, campaignId, title, optionId, kind, value: v, pool, issuedAt, scratchBy, useDays, keepUntil, status, ...rest } = card;
    void [id, issueKey, source, campaignId, title, optionId, kind, v, pool, issuedAt, scratchBy, useDays, keepUntil, status];
    assert.deepEqual(rest, extra, option.kind);
  }
});

// ── pointsBalance ───────────────────────────────────────────────────────────

test("pointsBalance: counts revealed unexpired points lots, minus what was spent; skips expired, used and other kinds", () => {
  const now = D("2026-11-12T14:30:00Z");
  const later = D("2026-11-20T00:00:00Z");
  const earlier = D("2026-11-01T00:00:00Z");
  const lot = (over: Partial<RewardCardSnapshot>) => ({
    kind: "points" as const,
    status: "revealed" as const,
    value: 50,
    scratchBy: earlier,
    validUntil: later,
    ...over,
  });
  const cards = [
    lot({}), // 50
    lot({ value: 30, pointsSpent: 10 }), // 20
    lot({ validUntil: earlier }), // expired
    lot({ status: "used", pointsSpent: 50 }), // used
    lot({ status: "ready", validUntil: undefined, scratchBy: later }), // not scratched yet
    lot({ kind: "bill-flat" }), // another kind
    lot({ value: 10, pointsSpent: 40 }), // over-spent never goes negative
  ];
  assert.equal(pointsBalance(cards, now), 70);
  assert.equal(pointsBalance([], now), 0);
  assert.equal(pointsBalance([lot({ validUntil: now })], now), 50, "the use-by instant itself still counts");
  assert.equal(pointsBalance([lot({ validUntil: now })], new Date(now.getTime() + 1)), 0);
});

// ── Tamil Nadu guard ────────────────────────────────────────────────────────

test("scratchEnvBlocks: blank and explicit off words allow; ANYTHING else blocks (fail closed)", () => {
  for (const v of [undefined, null, "", "  ", "0", "false", "FALSE", " off ", "no", "No"]) assert.equal(scratchEnvBlocks(v), false, JSON.stringify(v));
  for (const v of ["1", "true", "yes", " 1", "TN", "on", "maybe", "00"]) assert.equal(scratchEnvBlocks(v), true, JSON.stringify(v));
});

test("gstinBlocksScratch: state code 33 (after trim + uppercase) blocks; others, blank and null do not", () => {
  assert.equal(gstinBlocksScratch("33ABCDE1234F1Z5"), true);
  assert.equal(gstinBlocksScratch(" 33abc"), true);
  assert.equal(gstinBlocksScratch("34ABCDE1234F1Z5"), false);
  assert.equal(gstinBlocksScratch("27ABCDE1234F1Z5"), false);
  assert.equal(gstinBlocksScratch("3"), false);
  assert.equal(gstinBlocksScratch(""), false);
  assert.equal(gstinBlocksScratch(null), false);
  assert.equal(gstinBlocksScratch(undefined), false);
});

test("scratchCardsBlocked: either source blocks; neither allows", () => {
  assert.equal(scratchCardsBlocked({ envFlag: undefined, gstNumber: undefined }), false);
  assert.equal(scratchCardsBlocked({ envFlag: "0", gstNumber: "27ABCDE1234F1Z5" }), false);
  assert.equal(scratchCardsBlocked({ envFlag: "true", gstNumber: "27ABCDE1234F1Z5" }), true);
  assert.equal(scratchCardsBlocked({ envFlag: "", gstNumber: "33ABCDE1234F1Z5" }), true);
  assert.equal(scratchCardsBlocked({ envFlag: "1", gstNumber: "33ABCDE1234F1Z5" }), true);
});

// ── source pin ──────────────────────────────────────────────────────────────

test("SOURCE pin: no reward-levels* source file uses ambient randomness (randomness is injected, server CSPRNG only)", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const needle = "Math" + ".random"; // concatenated: this file is not scanned, but the habit keeps the pin from matching itself
  const files = [here, join(here, "schemas")].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /^reward-levels.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
      .map((f) => join(dir, f)),
  );
  assert.ok(files.length >= 6, `landmark: the reward-levels sources were found (${files.length})`);
  for (const file of files) assert.ok(!readFileSync(file, "utf8").includes(needle), `${file} must not use ambient randomness`);
  const engine = readFileSync(join(here, "reward-levels-engine.ts"), "utf8");
  assert.ok(engine.includes("pickWeighted"), "landmark: the engine file is the one being scanned");
});
