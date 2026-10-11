import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { LoyaltyMilestoneLike } from "@pos/shared/loyalty-rules";
import { REWARD_LEVELS_LAUNCHED, REWARD_OPTION_KINDS, REWARD_WEIGHT_DEFAULT, type RewardLevelsConfig } from "@pos/shared/reward-levels";
import { positionOf } from "@pos/shared/reward-levels-engine";
import { rewardLevelsWriteSchema } from "@pos/shared/schemas/reward-levels.schema";
import { stripComments } from "@/lib/source-pin-utils";
import { NONE_WARNING, REWARD_KIND_LABELS } from "@/lib/reward-levels-copy";
import { newSlot, priceOfFrom, replaceOption, setEnabled, withOption, withoutOption } from "@/lib/reward-levels-edit";
import { rewardLevelsProblems, writeBodyOf } from "@/lib/reward-levels-form";
import { REWARD_STARTERS, copyStampRewards, starterConfig, type RewardStarterId } from "@/lib/reward-levels-starters";

const HEX_A = "a".repeat(24);
const HEX_B = "b".repeat(24);
const IDS: RewardStarterId[] = ["quick-5", "classic-8", "three-levels"];

const stamp = (at: number, over: Partial<LoyaltyMilestoneLike> = {}): LoyaltyMilestoneLike => ({
  at,
  kind: "percent",
  value: 10,
  item: "",
  ...over,
});

test("starters: three of them, each with a label and a one-line description, in the owner's order", () => {
  assert.deepEqual(REWARD_STARTERS.map((s) => s.id), IDS);
  assert.deepEqual(REWARD_STARTERS.map((s) => s.label), ["Quick 5", "Classic 8", "Three levels"]);
  for (const s of REWARD_STARTERS) assert.ok(s.description.length > 0 && !s.description.includes("\n"), s.id);
});

test("starters (Q4): the exact boxes, ranges and days the owner approved", () => {
  const box = (cfg: RewardLevelsConfig, level: number, step: number) => {
    const slot = cfg.levels[level].slots.find((s) => s.step === step);
    assert.ok(slot, `level ${level + 1} box ${step} exists`);
    assert.equal(slot.scratchDays, 7);
    assert.equal(slot.useDays, 30);
    assert.equal(slot.options.length, 1);
    return slot.options[0];
  };
  const quick = starterConfig("quick-5", undefined);
  assert.deepEqual(quick.levels.map((l) => [l.size, l.slots.length]), [[5, 1]]);
  assert.deepEqual(box(quick, 0, 5), { id: "o1", kind: "bill-percent", weight: 1, min: 5, max: 15 });
  const classic = starterConfig("classic-8", undefined);
  assert.deepEqual(classic.levels.map((l) => [l.size, l.slots.length]), [[8, 2]]);
  assert.deepEqual(box(classic, 0, 4), { id: "o1", kind: "bill-flat", weight: 1, min: 20, max: 50 });
  assert.deepEqual(box(classic, 0, 8), { id: "o1", kind: "bill-percent", weight: 1, min: 10, max: 20 });
  const three = starterConfig("three-levels", undefined);
  assert.deepEqual(three.levels.map((l) => l.size), [5, 8, 10]);
  assert.deepEqual(box(three, 0, 5), { id: "o1", kind: "bill-percent", weight: 1, min: 5, max: 10 });
  assert.deepEqual(box(three, 1, 4), { id: "o1", kind: "bill-flat", weight: 1, min: 20, max: 40 });
  assert.deepEqual(box(three, 1, 8), { id: "o1", kind: "bill-percent", weight: 1, min: 10, max: 15 });
  assert.deepEqual(box(three, 2, 10), { id: "o1", kind: "bill-percent", weight: 1, min: 15, max: 20 });
});

test("starters: every one passes the WRITE gate, is switched OFF, carries the cafe minimum only when real, and the body is idempotent", () => {
  for (const id of IDS) {
    for (const minBill of [undefined, 0, Number.NaN, 120]) {
      const cfg = starterConfig(id, minBill);
      assert.equal(rewardLevelsWriteSchema.safeParse(cfg).success, true, `${id} / ${minBill}`);
      assert.deepEqual(rewardLevelsProblems(cfg), []);
      assert.equal(cfg.enabled, false);
      assert.equal(cfg.minBill, minBill === 120 ? 120 : undefined);
      assert.equal("minBill" in cfg, minBill === 120);
      const body = writeBodyOf(cfg);
      assert.deepEqual(rewardLevelsWriteSchema.parse(body), body);
    }
  }
});

test("starters: with the lock on, no starter or copy then edit reaches enabled:true", () => {
  assert.equal(REWARD_LEVELS_LAUNCHED, false, "precondition: S4 flips the constant and rewrites this");
  for (const id of IDS) assert.equal(setEnabled(starterConfig(id, 10), true).enabled, false, id);
  const copied = copyStampRewards({ milestones: [stamp(3)] }, 10).config;
  assert.ok(copied);
  assert.equal(setEnabled(copied, true).enabled, false);
});

test("starters: the ladder engine walks the three-level starter from box 5 of level 1 into level 2 and on into the repeating last level", () => {
  const three = starterConfig("three-levels", undefined);
  assert.deepEqual(positionOf(5, three.levels), { levelIndex: 0, step: 5, repeat: 0 });
  assert.deepEqual(positionOf(6, three.levels), { levelIndex: 1, step: 1, repeat: 0 });
  assert.deepEqual(positionOf(23, three.levels), { levelIndex: 2, step: 10, repeat: 0 });
  assert.deepEqual(positionOf(24, three.levels), { levelIndex: 2, step: 1, repeat: 1 });
});

test("copy: percent -> bill-percent, flat -> bill-flat, a menu item -> free-item (qty kept), days and bills carried, one level of the card size", () => {
  const { config, notes } = copyStampRewards(
    {
      cardSize: 9,
      milestones: [
        stamp(6, { kind: "item", value: 0, item: "Cold coffee", itemProductId: HEX_A.toUpperCase(), qty: 2 }),
        stamp(2, { value: 15, minBill: 200, claimWithinDays: 14 }),
        stamp(4, { kind: "flat", value: 50 }),
      ],
    },
    120,
  );
  assert.deepEqual(notes, []);
  assert.ok(config);
  assert.equal(config.enabled, false);
  assert.equal(config.minBill, 120);
  assert.equal(config.levels.length, 1);
  assert.equal(config.levels[0].size, 9);
  assert.deepEqual(
    config.levels[0].slots.map((s) => [s.step, s.scratchDays, s.useDays, s.options[0].kind]),
    [[2, 7, 14, "bill-percent"], [4, 7, 30, "bill-flat"], [6, 7, 30, "free-item"]],
  );
  assert.deepEqual(config.levels[0].slots[0].options[0], { id: "o1", kind: "bill-percent", weight: 1, min: 15, max: 15, minBill: 200 });
  assert.deepEqual(config.levels[0].slots[1].options[0], { id: "o1", kind: "bill-flat", weight: 1, min: 50, max: 50 });
  assert.deepEqual(config.levels[0].slots[2].options[0], { id: "o1", kind: "free-item", weight: 1, productId: HEX_A, productName: "Cold coffee", qty: 2 });
  assert.deepEqual(rewardLevelsProblems(config), [], "the copy passes the WRITE gate as it is");
});

test("copy: no card size = the last reward's box; an item with no qty is one; an unset cafe minimum leaves no key", () => {
  const { config } = copyStampRewards({ milestones: [stamp(3), stamp(5, { kind: "item", item: "Tea", itemProductId: HEX_B })] }, undefined);
  assert.ok(config);
  assert.equal(config.levels[0].size, 5);
  assert.equal("minBill" in config, false);
  const free = config.levels[0].slots[1].options[0];
  assert.equal(free.kind === "free-item" && free.qty, 1);
});

test("copy notes: a promo code, a name-only free item and a value that does not fit are named, never dropped silently", () => {
  const { config, notes } = copyStampRewards(
    {
      milestones: [
        stamp(2, { promoCode: "SAVE10" }),
        stamp(4, { kind: "item", item: "Brownie", itemProductId: null }),
        stamp(5, { value: 150 }),
      ],
    },
    undefined,
  );
  assert.ok(config);
  assert.deepEqual(config.levels[0].slots.map((s) => s.step), [2], "only box 2 became a reward");
  assert.equal(notes.length, 3);
  assert.match(notes[0], /^Box 2: .*promo code/);
  assert.match(notes[1], /^Box 4: .*free item.*menu/);
  assert.match(notes[2], /^Box 5: .*value/);
  assert.deepEqual(rewardLevelsProblems(config), []);
});

test("copy refusals: more than 30 boxes, no rewards, and no rules are each a sentence and no config", () => {
  const big = copyStampRewards({ cardSize: 45, milestones: [stamp(3)] }, undefined);
  assert.equal(big.config, null);
  assert.equal(big.notes.length, 1);
  assert.match(big.notes[0], /45 boxes/);
  assert.match(big.notes[0], /at most 30/);
  assert.doesNotMatch(big.notes[0], /undefined|NaN|\[object/);
  assert.equal(copyStampRewards({ milestones: [stamp(31)] }, undefined).config, null, "the last reward alone can make it too big");
  assert.ok(copyStampRewards({ cardSize: 30, milestones: [stamp(30)] }, undefined).config, "exactly 30 is fine");
  for (const rules of [{ milestones: [] }, {}, null, undefined]) {
    const empty = copyStampRewards(rules, undefined);
    assert.equal(empty.config, null);
    assert.match(empty.notes[0], /no rewards yet/);
  }
});

test("copy table: every kind has a label, and the No-reward warning is the owner's approved sentence", () => {
  for (const kind of REWARD_OPTION_KINDS) assert.ok(REWARD_KIND_LABELS[kind].length > 0, kind);
  assert.equal(REWARD_KIND_LABELS["bill-percent"], "% off the bill");
  assert.equal(REWARD_KIND_LABELS.none, "No reward");
  assert.equal(
    NONE_WARNING,
    "Some diners will get nothing. Expect complaints, and a prize where some people win nothing can count as a lottery in some states. Check with a lawyer before you use this.",
  );
});

test("priceOfFrom: the highest of the price and every size, case-insensitive, undefined when not on the menu", () => {
  const priceOf = priceOfFrom([
    { _id: HEX_A, price: 100, variations: [{ name: "S", price: 80 }, { name: "L", price: 160 }] },
    { _id: HEX_B, price: 50 },
  ]);
  assert.equal(priceOf(HEX_A), 160);
  assert.equal(priceOf(HEX_A.toUpperCase()), 160);
  assert.equal(priceOf(HEX_B), 50);
  assert.equal(priceOf("c".repeat(24)), undefined);
  assert.equal(priceOfFrom(undefined)(HEX_A), undefined);
});

test("newSlot: Q4 day defaults and one 10% bill option with a counter id", () => {
  const slot = newSlot(6);
  assert.deepEqual([slot.step, slot.scratchDays, slot.useDays], [6, 7, 30]);
  assert.deepEqual(slot.options, [{ id: "o1", kind: "bill-percent", weight: 1, min: 10, max: 10 }]);
});

test("SOURCE PIN: the four libs stay client-safe (no config reader, mongoose, node:crypto or model), LF only, and only the form imports the WRITE gate", () => {
  const root = process.cwd();
  for (const name of ["copy", "form", "edit", "starters"]) {
    const raw = readFileSync(path.join(root, "lib", `reward-levels-${name}.ts`), "utf8");
    const src = stripComments(raw);
    assert.ok(src.length > 200, `landmark: ${name} is a real file`);
    for (const banned of ["reward-levels-config", "mongoose", "node:crypto", "@/models/"]) {
      assert.equal(src.includes(banned), false, `${name} must not mention ${banned}`);
    }
    assert.equal(src.includes("schemas/reward-levels" + ".schema"), name === "form", `${name}: only the form lib imports the WRITE schema`);
    assert.equal(raw.includes("\r"), false, `${name} has LF endings`);
    assert.ok(raw.split("\n").length <= 300, `${name} stays under 300 lines`);
  }
});

test("withoutOption: the reward left alone in a box gets the default chance back (its Chance field hides with one reward — s89h review)", () => {
  const slot = withOption(newSlot(3), { ...newSlot(3).options[0], id: "o2" });
  const broken = replaceOption(slot, "o1", { ...slot.options[0], weight: 0 });
  const left = withoutOption(broken, "o2");
  assert.equal(left.options.length, 1);
  assert.equal(left.options[0].weight, REWARD_WEIGHT_DEFAULT, "a hidden, invalid chance can no longer block Save");
  const cfg: RewardLevelsConfig = { v: 1, enabled: false, levels: [{ size: 8, slots: [left] }] };
  assert.deepEqual(rewardLevelsProblems(cfg), [], "the box saves cleanly");
  assert.equal(withoutOption(left, "o1"), left, "landmark: the last reward still cannot be removed");
});
