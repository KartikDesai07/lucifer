import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REWARD_LEVELS_LAUNCHED,
  REWARD_OPTIONS_PER_SLOT_MAX,
  REWARD_OPTION_ID_RE,
  REWARD_OPTION_KINDS,
  REWARD_SLOTS_PER_LEVEL_MAX,
  type RewardLevelsConfig,
  type RewardOption,
} from "@pos/shared/reward-levels";
import { rewardLevelsWriteSchema } from "@pos/shared/schemas/reward-levels.schema";
import {
  boxHasProblem,
  canSwitchOn,
  configsEqual,
  fieldProblem,
  numberText,
  optionalNumber,
  positionShiftWarning,
  problemSentence,
  problemsForSlot,
  requiredNumber,
  rewardDraftDirty,
  rewardLevelsProblems,
  seedRewardLevels,
  writeBodyOf,
} from "@/lib/reward-levels-form";
import {
  addLevel,
  emptyConfig,
  newOption,
  newSlot,
  nextOptionId,
  putSlot,
  removeLevel,
  removeSlot,
  replaceOption,
  setEnabled,
  setLevelSize,
  setMinBill,
  switchKind,
  withOption,
  withoutOption,
} from "@/lib/reward-levels-edit";
import { POSITION_SHIFT } from "@/lib/reward-levels-copy";

const HEX_A = "a".repeat(24);
const HEX_B = "b".repeat(24);

// Fill the picks a kind needs (the editor starts them empty) so the option can pass the save gate.
function filled(option: RewardOption): RewardOption {
  switch (option.kind) {
    case "product-percent":
    case "free-item":
      return { ...option, productId: HEX_A, productName: "Cold coffee" };
    case "category-percent":
    case "category-flat":
      return { ...option, categoryId: HEX_B, categoryName: "Drinks" };
    default:
      return option;
  }
}

function oneBox(option: RewardOption): RewardLevelsConfig {
  return putSlot(emptyConfig(), 0, { ...newSlot(3), options: [option] });
}

test("lock is on: no edit sequence yields enabled:true, and every config the editor builds passes the WRITE gate disabled", () => {
  assert.equal(REWARD_LEVELS_LAUNCHED, false, "precondition: these asserts are about the lock (S4 flips the constant and rewrites them)");
  let cfg = emptyConfig(50);
  cfg = setEnabled(cfg, true);
  cfg = putSlot(addLevel(cfg), 1, newSlot(2));
  cfg = setEnabled(setLevelSize(setMinBill(cfg, 10), 0, 5), true);
  assert.equal(cfg.enabled, false);
  assert.equal(canSwitchOn(true), false, "canSwitchOn is the lock AND accounts");
  assert.equal(canSwitchOn(false), false);
  assert.equal(rewardLevelsWriteSchema.safeParse(cfg).success, true);
});

test("emptyConfig: one level of the stamp card's default size, no boxes, the cafe minimum carried only when it is real", () => {
  const cfg = emptyConfig(0);
  assert.deepEqual(cfg, { v: 1, enabled: false, levels: [{ size: 8, slots: [] }] });
  assert.equal("minBill" in cfg, false, "0 / NaN means every bill counts, so no key");
  assert.equal(emptyConfig(Number.NaN).minBill, undefined);
  assert.equal(emptyConfig(150).minBill, 150);
});

test("edit ops are pure: the input config is never mutated", () => {
  const base = putSlot(emptyConfig(), 0, newSlot(4));
  const snapshot = JSON.stringify(base);
  addLevel(base);
  removeLevel(base, 0);
  setLevelSize(base, 0, 12);
  setMinBill(base, 99);
  putSlot(base, 0, newSlot(2));
  removeSlot(base, 0, 4);
  setEnabled(base, true);
  assert.equal(JSON.stringify(base), snapshot);
});

test("level ops: add stops at the cap, remove drops by index, size keeps the boxes past a shrunk size", () => {
  let cfg = emptyConfig();
  for (let i = 0; i < 10; i++) cfg = addLevel(cfg);
  assert.equal(cfg.levels.length, 5);
  assert.equal(removeLevel(cfg, 2).levels.length, 4);
  const shrunk = setLevelSize(putSlot(emptyConfig(), 0, newSlot(8)), 0, 3);
  assert.equal(shrunk.levels[0].slots.length, 1, "a smaller size never deletes a reward");
  assert.equal(rewardLevelsProblems(shrunk).length, 1, "it is flagged instead");
  assert.equal(setMinBill(setMinBill(emptyConfig(), 40), undefined).minBill, undefined);
});

test("putSlot sorts by step, replaces a box on the same step, and refuses a 9th box", () => {
  let cfg = emptyConfig();
  cfg = setLevelSize(cfg, 0, 30);
  for (const step of [5, 2, 9]) cfg = putSlot(cfg, 0, newSlot(step));
  assert.deepEqual(cfg.levels[0].slots.map((s) => s.step), [2, 5, 9]);
  cfg = putSlot(cfg, 0, { ...newSlot(5), scratchDays: 3 });
  assert.equal(cfg.levels[0].slots.length, 3);
  assert.equal(cfg.levels[0].slots[1].scratchDays, 3);
  for (let step = 10; step < 10 + REWARD_SLOTS_PER_LEVEL_MAX; step++) cfg = putSlot(cfg, 0, newSlot(step));
  assert.equal(cfg.levels[0].slots.length, REWARD_SLOTS_PER_LEVEL_MAX);
  assert.deepEqual(removeSlot(cfg, 0, 2).levels[0].slots.map((s) => s.step).slice(0, 2), [5, 9]);
});

test("nextOptionId: one past the highest counter, never a taken id, always matches the id shape", () => {
  assert.equal(nextOptionId([]), "o1");
  assert.equal(nextOptionId([{ id: "o1" }, { id: "o2" }]), "o3");
  assert.equal(nextOptionId([{ id: "o1" }, { id: "o7" }]), "o8", "a gap is not refilled: ids only ever grow");
  assert.equal(nextOptionId([{ id: "abc" }]), "o1");
  for (const id of ["o1", nextOptionId([{ id: "o99" }])]) assert.ok(REWARD_OPTION_ID_RE.test(id));
});

test("withOption / withoutOption / replaceOption: cap, the last reward stays, replace by id", () => {
  let slot = newSlot(1);
  for (let i = 0; i < 10; i++) slot = withOption(slot, newOption("bill-flat", nextOptionId(slot.options)));
  assert.equal(slot.options.length, REWARD_OPTIONS_PER_SLOT_MAX);
  assert.equal(withoutOption(slot, "o2").options.some((o) => o.id === "o2"), false);
  assert.equal(withoutOption(newSlot(1), "o1").options.length, 1);
  const swapped = replaceOption(slot, "o1", newOption("points", "o1"));
  assert.equal(swapped.options[0].kind, "points");
  assert.equal(swapped.options.length, slot.options.length);
});

test("switchKind: id and chance survive, the bill minimum only where the kind has one, picks start empty", () => {
  const start: RewardOption = { id: "o4", kind: "bill-percent", weight: 7, min: 5, max: 9, minBill: 300 };
  const flat = switchKind(start, "bill-flat");
  assert.equal(flat.id, "o4");
  assert.equal(flat.weight, 7);
  assert.equal("minBill" in flat && flat.minBill, 300);
  const pts = switchKind(start, "points");
  assert.equal("minBill" in pts, false, "points has no bill minimum");
  assert.equal(switchKind(start, "none").kind, "none");
  const item = switchKind(start, "free-item");
  assert.deepEqual([item.kind === "free-item" && item.productId, item.kind === "free-item" && item.productName], ["", ""]);
  assert.equal(switchKind(start, "bill-percent"), start, "the same kind is a no-op");
});

test("the 8x8 kind grid: every from/to pair passes the WRITE gate once the picks are filled, and none before that for picker kinds", () => {
  for (const from of REWARD_OPTION_KINDS) {
    for (const to of REWARD_OPTION_KINDS) {
      const switched = switchKind(filled(newOption(from, "o1")), to);
      assert.equal(switched.id, "o1");
      const ready = filled(switched);
      const cfg = oneBox(ready);
      const label = `${from} -> ${to}`;
      // a lone "No reward" box is refused by the gate (a box needs a real reward); pair it with one
      const real = to === "none" ? putSlot(emptyConfig(), 0, { ...newSlot(3), options: [ready, newOption("bill-percent", "o2")] }) : cfg;
      assert.deepEqual(rewardLevelsProblems(real), [], label);
      if (from !== to && (to === "product-percent" || to === "category-percent" || to === "category-flat" || to === "free-item")) {
        assert.ok(rewardLevelsProblems(oneBox(switched)).length > 0, `${label}: an empty pick is refused`);
      }
    }
  }
});

test("writeBodyOf: null stays null, a valid draft is the parsed form and parsing it again changes nothing, an invalid draft is returned as is", () => {
  assert.equal(writeBodyOf(null), null);
  const messy = oneBox({ ...filled(newOption("product-percent", "o1")), productName: "  Cold coffee  ", productId: HEX_A.toUpperCase() } as RewardOption);
  const body = writeBodyOf(messy);
  assert.ok(body);
  assert.notEqual(configsEqual(body, messy), true, "the body is the TRIMMED, lower-cased form");
  assert.deepEqual(rewardLevelsWriteSchema.parse(body), body, "idempotent under parse");
  const first = body.levels[0].slots[0].options[0];
  assert.equal(first.kind === "product-percent" && first.productId, HEX_A);
  const broken = setLevelSize(emptyConfig(), 0, Number.NaN);
  assert.equal(writeBodyOf(broken), broken);
});

test("seedRewardLevels: absent, readable and unreadable blobs", () => {
  assert.deepEqual(seedRewardLevels(undefined), { baseline: null, unreadable: false });
  assert.deepEqual(seedRewardLevels(null), { baseline: null, unreadable: false });
  const stored = oneBox(newOption("bill-flat", "o1"));
  const seeded = seedRewardLevels(JSON.parse(JSON.stringify(stored)));
  assert.equal(seeded.unreadable, false);
  assert.ok(configsEqual(seeded.baseline, stored));
  assert.deepEqual(seedRewardLevels({ v: 99, nonsense: true }), { baseline: null, unreadable: true });
  assert.deepEqual(seedRewardLevels("text"), { baseline: null, unreadable: true });
});

test("configsEqual: deep, undefined equals absent, NaN equals NaN, order of boxes matters", () => {
  const a = oneBox(newOption("bill-percent", "o1"));
  const b = JSON.parse(JSON.stringify(a)) as RewardLevelsConfig;
  assert.equal(configsEqual(a, b), true);
  assert.equal(configsEqual({ ...a, minBill: undefined }, a), true);
  assert.equal(configsEqual(setLevelSize(a, 0, Number.NaN), setLevelSize(b, 0, Number.NaN)), true);
  assert.equal(configsEqual(setLevelSize(a, 0, 9), a), false);
  assert.equal(configsEqual(null, null), true);
  assert.equal(configsEqual(null, a), false);
  assert.equal(configsEqual(putSlot(putSlot(emptyConfig(), 0, newSlot(1)), 0, newSlot(2)), putSlot(emptyConfig(), 0, newSlot(1)) ), false);
});

test("rewardDraftDirty mirrors draftDirty: nothing saved, saved, and unreadable", () => {
  const saved = oneBox(newOption("bill-percent", "o1"));
  const none = { baseline: null, unreadable: false };
  assert.equal(rewardDraftDirty(none, null, false), false);
  assert.equal(rewardDraftDirty(none, emptyConfig(), false), true);
  const has = { baseline: saved, unreadable: false };
  assert.equal(rewardDraftDirty(has, saved, false), false);
  assert.equal(rewardDraftDirty(has, setMinBill(saved, 5), false), true);
  assert.equal(rewardDraftDirty(has, null, false), true, "cleared a saved setup");
  const bad = { baseline: null, unreadable: true };
  assert.equal(rewardDraftDirty(bad, null, false), false, "an unreadable blob left alone sends nothing");
  assert.equal(rewardDraftDirty(bad, null, true), true);
  assert.equal(rewardDraftDirty(bad, emptyConfig(), true), true);
});

test("positionShiftWarning: level count or any size differs, nothing else", () => {
  const base = setLevelSize(addLevel(emptyConfig()), 1, 5);
  assert.equal(positionShiftWarning(base, base), null);
  assert.equal(positionShiftWarning(base, putSlot(base, 0, newSlot(2))), null, "a reward change does not move anyone");
  assert.equal(positionShiftWarning(base, setLevelSize(base, 1, 6)), POSITION_SHIFT);
  assert.equal(positionShiftWarning(base, addLevel(base)), POSITION_SHIFT);
  assert.equal(positionShiftWarning(base, removeLevel(base, 1)), POSITION_SHIFT);
  assert.equal(positionShiftWarning(null, base), null);
  assert.equal(positionShiftWarning(base, null), null);
});

test("number helpers: blank required = NaN, blank optional = absent, NaN shows as empty text", () => {
  assert.ok(Number.isNaN(requiredNumber("")));
  assert.ok(Number.isNaN(requiredNumber("   ")));
  assert.ok(Number.isNaN(requiredNumber("abc")));
  assert.equal(requiredNumber(" 12 "), 12);
  assert.equal(optionalNumber(""), undefined);
  assert.equal(optionalNumber("0"), 0);
  assert.equal(optionalNumber("7"), 7);
  assert.equal(numberText(Number.NaN), "");
  assert.equal(numberText(undefined), "");
  assert.equal(numberText(0), "0");
  assert.equal(numberText(42), "42");
});

test("problems: located by level / box / reward / field, messages are plain sentences, never a path", () => {
  const inverted: RewardOption = { id: "o1", kind: "bill-percent", weight: 1, min: 20, max: 10 };
  const cfg = putSlot(emptyConfig(), 0, { ...newSlot(8), options: [inverted] });
  const problems = rewardLevelsProblems(cfg);
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0], { level: 0, step: 8, optionId: "o1", field: "max", message: "The highest value must not be below the lowest" });
  assert.equal(problemSentence(problems[0]), "Level 1, box 8: The highest value must not be below the lowest");
  assert.equal(fieldProblem(problems, 0, 8, "o1", "max"), "The highest value must not be below the lowest");
  assert.equal(fieldProblem(problems, 0, 8, "o1", "min"), null);
  assert.equal(boxHasProblem(problems, 0, 8), true);
  assert.equal(boxHasProblem(problems, 0, 7), false);
  assert.equal(problemsForSlot(problems, 0, 8).length, 1);
  assert.deepEqual(rewardLevelsProblems(null), []);
});

test("problems: blank numbers, empty picks and an over-long level all read as sentences", () => {
  const blank = oneBox({ id: "o1", kind: "bill-percent", weight: 1, min: Number.NaN, max: Number.NaN });
  const empty = oneBox(newOption("free-item", "o1"));
  const sizeNaN = setLevelSize(emptyConfig(), 0, Number.NaN);
  const tooMany = (() => {
    let cfg = emptyConfig();
    for (let i = 0; i < 5; i++) cfg = addLevel(cfg);
    return { ...cfg, levels: [...cfg.levels, ...cfg.levels] };
  })();
  const all = [blank, empty, sizeNaN, tooMany].flatMap((c) => rewardLevelsProblems(c));
  assert.ok(all.length >= 5);
  for (const p of all) {
    const text = problemSentence(p);
    assert.ok(p.message.length > 0);
    assert.doesNotMatch(text, /\b(levels|slots|options)\.\d|\[\d\]|undefined|NaN|Expected|Required|Invalid/, text);
    assert.match(text, /^[A-Z]/, `a sentence: ${text}`);
  }
  assert.equal(fieldProblem(rewardLevelsProblems(empty), 0, 3, "o1", "productId"), "Pick the item from the list");
  assert.ok(rewardLevelsProblems(blank).every((p) => p.message.endsWith("must be a whole number")));
});

test("problems: a box of only 'No reward' is refused, and a draft with the switch on never gets past the lock", () => {
  const onlyNone = oneBox(newOption("none", "o1"));
  const [problem] = rewardLevelsProblems(onlyNone);
  assert.equal(problem.message, "Add at least one real reward to this box");
  assert.equal(problem.field, "options");
  assert.equal(fieldProblem([problem], 0, 3, null, "options"), "Add at least one real reward to this box");
  const forced = { ...oneBox(newOption("bill-percent", "o1")), enabled: true };
  assert.equal(rewardLevelsProblems(forced).some((p) => p.message === "Scratch cards are not available yet"), !REWARD_LEVELS_LAUNCHED);
});
