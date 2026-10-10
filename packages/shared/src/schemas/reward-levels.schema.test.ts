import { test } from "node:test";
import assert from "node:assert/strict";
import { rewardLevelsWriteSchema } from "./reward-levels.schema";
import { REWARD_LEVELS_READ_LIMITS, parseStoredRewardLevels, rewardLevelsChosenRaw } from "./reward-levels-read.schema";
import { settingsSchema, updateSettingsSchema } from "./settings.schema";
import * as C from "../reward-levels";
import type { RewardLevelsConfig } from "../reward-levels";

// CB-7 S1 — the WRITE gate (every rule, strict, integers), the READ twin (shape-only, own ceilings, fail closed
// to null) and the Settings PUT wiring. NOTE: enabled:true is refused while REWARD_LEVELS_LAUNCHED is false, so the
// "valid" fixture is a DRAFT (enabled:false); the lock itself is asserted separately.

const PRODUCT_UPPER = "0123456789ABCDEF01234567";
const PRODUCT_ID = PRODUCT_UPPER.toLowerCase();
const CATEGORY_UPPER = "76543210FEDCBA9876543210";
const CATEGORY_ID = CATEGORY_UPPER.toLowerCase();

// One option of EVERY kind, spread over two boxes (a box holds at most 5 options).
function valid(): Record<string, unknown> {
  return {
    v: 1,
    enabled: false,
    minBill: 150,
    levels: [
      {
        size: 5,
        slots: [
          {
            step: 3,
            scratchDays: 3,
            useDays: 14,
            options: [
              { id: "a1", kind: "bill-percent", weight: 2, min: 5, max: 15, minBill: 200 },
              { id: "a2", kind: "bill-flat", weight: 1, min: 20, max: 50 },
              { id: "a3", kind: "product-percent", weight: 1, min: 10, max: 10, productId: PRODUCT_UPPER, productName: " Cold Coffee ", capRupees: 80, minBill: 100 },
              { id: "a4", kind: "category-percent", weight: 1, min: 5, max: 20, categoryId: CATEGORY_UPPER, categoryName: "Beverages", capRupees: 60 },
              { id: "a5", kind: "category-flat", weight: 1, min: 30, max: 30, categoryId: CATEGORY_UPPER, categoryName: "Beverages", minBill: 250 },
            ],
          },
          {
            step: 5,
            scratchDays: 7,
            useDays: 30,
            options: [
              { id: "b1", kind: "free-item", weight: 1, productId: PRODUCT_UPPER, productName: "Cold Coffee", qty: 2, minBill: 300 },
              { id: "b2", kind: "points", weight: 1, min: 20, max: 50 },
              { id: "b3", kind: "none", weight: 3, label: " Better luck next time " },
            ],
          },
        ],
      },
      { size: 2, slots: [] },
    ],
  };
}

function expected(): Record<string, unknown> {
  const e = valid() as { levels: { slots: { options: Record<string, unknown>[] }[] }[] };
  const [s1, s2] = e.levels[0].slots;
  s1.options[2].productId = PRODUCT_ID;
  s1.options[2].productName = "Cold Coffee";
  s1.options[3].categoryId = CATEGORY_ID;
  s1.options[4].categoryId = CATEGORY_ID;
  s2.options[0].productId = PRODUCT_ID;
  s2.options[2].label = "Better luck next time";
  return e as unknown as Record<string, unknown>;
}

type Draft = { enabled: boolean | string; levels: { size: number; slots: { step: number; scratchDays: number; options: Record<string, unknown>[] }[] }[] } & Record<string, unknown>;
function mutate(fn: (d: Draft) => void): Record<string, unknown> {
  const d = valid() as Draft;
  fn(d);
  return d;
}
const slot0 = (d: Draft) => d.levels[0].slots[0];

// The paths (dot-joined) of every issue the WRITE gate raises.
function paths(input: unknown): string[] {
  const r = rewardLevelsWriteSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
}
function messages(input: unknown): string[] {
  const r = rewardLevelsWriteSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

// ── WRITE ───────────────────────────────────────────────────────────────────

test("WRITE: a full config with one option of every kind parses and round-trips (ids lower-cased, names/labels trimmed)", () => {
  const r = rewardLevelsWriteSchema.safeParse(valid());
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues));
  if (!r.success) return;
  assert.deepEqual(r.data, expected());
  const kinds = r.data.levels.flatMap((l) => l.slots.flatMap((s) => s.options.map((o) => o.kind)));
  assert.deepEqual([...kinds].sort(), [...C.REWARD_OPTION_KINDS].sort(), "landmark: every kind is exercised");
  // The parsed output is usable as the shared config type (compile-time assignment).
  const asConfig: RewardLevelsConfig = r.data;
  assert.equal(asConfig.v, 1);
  // Re-parsing the output is stable (idempotent canonicalisation).
  assert.deepEqual(rewardLevelsWriteSchema.parse(r.data), r.data);
});

test("WRITE: an empty draft (no levels, off) is valid; minBill is optional", () => {
  assert.ok(rewardLevelsWriteSchema.safeParse({ v: 1, enabled: false, levels: [] }).success);
  assert.ok(rewardLevelsWriteSchema.safeParse({ v: 1, enabled: false, minBill: 0, levels: [] }).success);
});

test("WRITE: ranged min above max is refused at that option's max", () => {
  assert.deepEqual(paths(mutate((d) => Object.assign(slot0(d).options[0], { min: 20, max: 10 }))), ["levels.0.slots.0.options.0.max"]);
  assert.deepEqual(paths(mutate((d) => Object.assign(slot0(d).options[1], { min: 51, max: 50 }))), ["levels.0.slots.0.options.1.max"]);
  assert.ok(rewardLevelsWriteSchema.safeParse(mutate((d) => Object.assign(slot0(d).options[0], { min: 10, max: 10 }))).success, "landmark: equal is fine");
});

test("WRITE: a box past the level's size, and two boxes on one step, are refused at the step", () => {
  assert.deepEqual(paths(mutate((d) => (slot0(d).step = 6))), ["levels.0.slots.0.step"]);
  assert.deepEqual(paths(mutate((d) => (d.levels[0].slots[1].step = 3))), ["levels.0.slots.1.step"]);
  assert.deepEqual(paths(mutate((d) => (slot0(d).step = 0))), ["levels.0.slots.0.step"]);
  assert.deepEqual(paths(mutate((d) => (slot0(d).step = 5))), ["levels.0.slots.1.step"], "the LATER box carries the duplicate");
});

test("WRITE: two options in one box with the same id are refused at the second one's id; an option id must be short and plain", () => {
  assert.deepEqual(paths(mutate((d) => (slot0(d).options[1].id = "a1"))), ["levels.0.slots.0.options.1.id"]);
  for (const bad of ["", "A1", "a-1", "a".repeat(17)]) {
    assert.deepEqual(paths(mutate((d) => (slot0(d).options[0].id = bad))), ["levels.0.slots.0.options.0.id"], JSON.stringify(bad));
  }
});

test("WRITE: a box with only 'no reward' options is refused; so is an empty one", () => {
  const allNone = mutate((d) => (slot0(d).options = [{ id: "n1", kind: "none", weight: 1 }]));
  assert.deepEqual(paths(allNone), ["levels.0.slots.0.options"]);
  assert.ok(messages(allNone).includes("Add at least one real reward to this box"));
  assert.ok(paths(mutate((d) => (slot0(d).options = []))).includes("levels.0.slots.0.options"));
});

test("WRITE: .strict() — an unknown key at the top, a level, a box or an option is refused", () => {
  assert.ok(paths(mutate((d) => (d.extra = 1))).length > 0);
  assert.ok(paths(mutate((d) => Object.assign(d.levels[0], { name: "Gold" }))).length > 0);
  assert.ok(paths(mutate((d) => Object.assign(slot0(d), { note: "x" }))).length > 0);
  assert.ok(paths(mutate((d) => Object.assign(slot0(d).options[0], { sneaky: true }))).length > 0);
  assert.ok(paths(mutate((d) => Object.assign(slot0(d).options[0], { productId: PRODUCT_ID }))).length > 0, "a field of another kind is unknown here");
  assert.deepEqual(paths(valid()), [], "landmark: the untouched fixture is clean");
});

test("WRITE: fractions, text and out-of-range numbers are refused at their field", () => {
  const cases: [string, (d: Draft) => void][] = [
    ["levels.0.slots.0.options.0.min", (d) => Object.assign(slot0(d).options[0], { min: 5.5 })],
    ["levels.0.slots.0.options.0.max", (d) => Object.assign(slot0(d).options[0], { max: 101 })],
    ["levels.0.slots.0.options.0.min", (d) => Object.assign(slot0(d).options[0], { min: 0 })],
    ["levels.0.slots.0.options.0.weight", (d) => Object.assign(slot0(d).options[0], { weight: 0 })],
    ["levels.0.slots.0.options.0.weight", (d) => Object.assign(slot0(d).options[0], { weight: C.REWARD_WEIGHT_MAX + 1 })],
    ["levels.0.slots.0.options.0.weight", (d) => Object.assign(slot0(d).options[0], { weight: "2" })],
    ["levels.0.slots.0.options.1.max", (d) => Object.assign(slot0(d).options[1], { max: C.REWARD_FLAT_MAX + 1 })],
    ["levels.0.slots.0.options.2.capRupees", (d) => Object.assign(slot0(d).options[2], { capRupees: 0 })],
    ["levels.0.slots.0.options.0.minBill", (d) => Object.assign(slot0(d).options[0], { minBill: -1 })],
    ["levels.0.slots.1.options.0.qty", (d) => Object.assign(d.levels[0].slots[1].options[0], { qty: C.REWARD_QTY_MAX + 1 })],
    ["levels.0.slots.1.options.1.max", (d) => Object.assign(d.levels[0].slots[1].options[1], { max: C.REWARD_POINTS_MAX + 1 })],
    ["levels.0.slots.0.scratchDays", (d) => (slot0(d).scratchDays = 0)],
    ["levels.0.slots.0.useDays", (d) => Object.assign(slot0(d), { useDays: C.REWARD_DAYS_MAX + 1 })],
    ["levels.0.size", (d) => (d.levels[0].size = 31)],
    ["levels.0.size", (d) => (d.levels[0].size = 2.5)],
    ["minBill", (d) => (d.minBill = 100_001)],
    ["minBill", (d) => (d.minBill = 99.5)],
    ["v", (d) => (d.v = 2)],
    ["enabled", (d) => (d.enabled = "yes")],
    ["levels.0.slots.0.options.2.productId", (d) => Object.assign(slot0(d).options[2], { productId: "nope" })],
    ["levels.0.slots.0.options.3.categoryName", (d) => Object.assign(slot0(d).options[3], { categoryName: "  " })],
    ["levels.0.slots.0.options.2.productName", (d) => Object.assign(slot0(d).options[2], { productName: "x".repeat(C.REWARD_NAME_MAX_LEN + 1) })],
    ["levels.0.slots.1.options.2.label", (d) => Object.assign(d.levels[0].slots[1].options[2], { label: "x".repeat(C.REWARD_LABEL_MAX_LEN + 1) })],
  ];
  for (const [path, fn] of cases) assert.ok(paths(mutate(fn)).includes(path), `${path}: ${JSON.stringify(paths(mutate(fn)))}`);
});

test("WRITE: owner-facing copy reads cleanly — a type error names the field, a bad reference names its kind", () => {
  const msgsFor = (path: string, fn: (d: Draft) => void) => {
    const r = rewardLevelsWriteSchema.safeParse(mutate(fn));
    return r.success ? [] : r.error.issues.filter((i) => i.path.join(".") === path).map((i) => i.message);
  };
  assert.deepEqual(
    msgsFor("levels.0.slots.0.options.0.weight", (d) => Object.assign(slot0(d).options[0], { weight: "2" })),
    ["The chance must be a whole number"],
  );
  assert.deepEqual(
    msgsFor("levels.0.slots.0.options.3.categoryId", (d) => Object.assign(slot0(d).options[3], { categoryId: "nope" })),
    ["Pick the category from the list"],
  );
  assert.deepEqual(
    msgsFor("levels.0.slots.0.options.3.categoryName", (d) => Object.assign(slot0(d).options[3], { categoryName: "  " })),
    ["Pick the category from the list"],
  );
  assert.deepEqual(
    msgsFor("levels.0.slots.0.options.2.productId", (d) => Object.assign(slot0(d).options[2], { productId: "nope" })),
    ["Pick the item from the list"],
  );
  assert.deepEqual(
    msgsFor("levels.0.slots.0.options.2.productName", (d) => Object.assign(slot0(d).options[2], { productName: "  " })),
    ["Pick the item from the list"],
  );
});

test("WRITE: count caps — levels, boxes per level, options per box", () => {
  const level = { size: 8, slots: [] };
  assert.ok(paths(mutate((d) => (d.levels = Array.from({ length: C.REWARD_LEVELS_MAX + 1 }, () => ({ ...level }))))).includes("levels"));
  const box = (step: number) => ({ step, scratchDays: 1, useDays: 1, options: [{ id: "a", kind: "points", weight: 1, min: 1, max: 1 }] });
  assert.ok(paths(mutate((d) => (d.levels = [{ size: 30, slots: Array.from({ length: C.REWARD_SLOTS_PER_LEVEL_MAX + 1 }, (_, i) => box(i + 1)) }]))).includes("levels.0.slots"));
  const many = Array.from({ length: C.REWARD_OPTIONS_PER_SLOT_MAX + 1 }, (_, i) => ({ id: `p${i}`, kind: "points", weight: 1, min: 1, max: 1 }));
  assert.ok(paths(mutate((d) => (slot0(d).options = many))).includes("levels.0.slots.0.options"));
});

test("LAUNCH LOCK: enabled:true is refused at 'enabled' while REWARD_LEVELS_LAUNCHED is false", () => {
  assert.equal(C.REWARD_LEVELS_LAUNCHED, false, "landmark: still locked — flipping this is S4's job, with this test");
  const on = mutate((d) => (d.enabled = true));
  assert.deepEqual(paths(on), ["enabled"]);
  assert.ok(messages(on).includes("Scratch cards are not available yet"));
  assert.ok(rewardLevelsWriteSchema.safeParse(valid()).success, "landmark: the same config switched off passes");
});

test("WRITE: enabled:true with no level holding a box is refused at 'levels' (beside the lock)", () => {
  for (const levels of [[], [{ size: 3, slots: [] }]]) {
    const got = paths({ v: 1, enabled: true, levels });
    assert.ok(got.includes("levels") && got.includes("enabled"), JSON.stringify(got));
  }
  assert.ok(!paths({ v: 1, enabled: false, levels: [{ size: 3, slots: [] }] }).includes("levels"), "a draft may be empty");
});

// ── READ ────────────────────────────────────────────────────────────────────

test("READ: parses everything WRITE accepts, unchanged", () => {
  const w = rewardLevelsWriteSchema.parse(valid());
  assert.deepEqual(parseStoredRewardLevels(w), w);
});

test("READ: accepts values above the write caps (below its own ceilings) and rules the write gate refuses", () => {
  const big = mutate((d) => {
    Object.assign(slot0(d).options[0], { weight: 500, min: 20, max: 10 }); // above the weight cap AND min > max
    slot0(d).scratchDays = 1000;
    d.levels[0].slots[1].step = 3; // a duplicate step
    d.levels[0].size = 45;
    d.enabled = true; // the launch lock is a WRITE rule only
  });
  assert.equal(rewardLevelsWriteSchema.safeParse(big).success, false, "landmark: the write gate refuses it");
  assert.ok(parseStoredRewardLevels(big), "the read gate still reads it");
  const over = mutate((d) => Object.assign(d.levels[0].slots[1].options[0], { qty: 500 }));
  assert.ok(parseStoredRewardLevels(over));
});

test("READ: an unknown future key is stripped, never a failure", () => {
  const future = mutate((d) => {
    d.futureTop = true;
    Object.assign(d.levels[0], { tag: "x" });
    Object.assign(slot0(d), { tag: "x" });
    Object.assign(slot0(d).options[0], { tag: "x" });
  });
  const got = parseStoredRewardLevels(future);
  assert.ok(got);
  assert.ok(!("futureTop" in got) && !("tag" in got.levels[0]) && !("tag" in got.levels[0].slots[0]) && !("tag" in got.levels[0].slots[0].options[0]));
  assert.equal(got.levels[0].slots[0].options[0].kind, "bill-percent", "the rest survives");
});

test("READ: garbage, a wrong version and an unknown kind all read as null (OFF, fail closed)", () => {
  for (const raw of [null, undefined, [], "x", 5, {}, { v: 2 }, { v: 2, enabled: true, levels: [] }, { v: 1, enabled: true }]) {
    assert.equal(parseStoredRewardLevels(raw), null, JSON.stringify(raw));
  }
  const unknownKind = mutate((d) => Object.assign(slot0(d).options[0], { kind: "mystery" }));
  assert.equal(parseStoredRewardLevels(unknownKind), null);
  assert.ok(parseStoredRewardLevels({ v: 1, enabled: false, levels: [] }), "landmark: a minimal config parses");
});

test("rewardLevelsChosenRaw: the owner's mode is a raw read — independent of the full parse", () => {
  assert.equal(rewardLevelsChosenRaw({ enabled: true }), true, "true even when the rest is garbage");
  assert.equal(rewardLevelsChosenRaw({ enabled: true, levels: "junk", v: 99 }), true);
  assert.equal(rewardLevelsChosenRaw({ enabled: "true" }), false);
  assert.equal(rewardLevelsChosenRaw({ enabled: false }), false);
  assert.equal(rewardLevelsChosenRaw({}), false);
  assert.equal(rewardLevelsChosenRaw([]), false);
  assert.equal(rewardLevelsChosenRaw(null), false);
  assert.equal(rewardLevelsChosenRaw(undefined), false);
  assert.equal(rewardLevelsChosenRaw("enabled"), false);
});

test("READ ceilings: every one is >= its write cap, and every ceiling is accounted for", () => {
  const caps: Record<keyof typeof REWARD_LEVELS_READ_LIMITS, number> = {
    levels: C.REWARD_LEVELS_MAX,
    levelSize: C.REWARD_LEVEL_SIZE_MAX,
    slotsPerLevel: C.REWARD_SLOTS_PER_LEVEL_MAX,
    optionsPerSlot: C.REWARD_OPTIONS_PER_SLOT_MAX,
    weight: C.REWARD_WEIGHT_MAX,
    days: C.REWARD_DAYS_MAX,
    percent: C.REWARD_PERCENT_MAX,
    flat: C.REWARD_FLAT_MAX,
    points: C.REWARD_POINTS_MAX,
    capRupees: C.REWARD_CAP_RUPEES_MAX,
    minBill: C.REWARD_MIN_BILL_MAX,
    qty: C.REWARD_QTY_MAX,
    nameLen: C.REWARD_NAME_MAX_LEN,
    labelLen: C.REWARD_LABEL_MAX_LEN,
    idLen: Math.max(C.REWARD_CARD_ID_HEX_LEN, 24), // an option id is <= 16 chars; a product/category ref is 24 hex
  };
  assert.deepEqual(Object.keys(caps).sort(), Object.keys(REWARD_LEVELS_READ_LIMITS).sort());
  for (const [key, cap] of Object.entries(caps)) {
    const ceiling = REWARD_LEVELS_READ_LIMITS[key as keyof typeof REWARD_LEVELS_READ_LIMITS];
    assert.ok(ceiling >= cap, `${key}: read ceiling ${ceiling} < write cap ${cap}`);
  }
  assert.ok(Object.isFrozen(REWARD_LEVELS_READ_LIMITS), "frozen");
});

// ── Settings PUT wiring ─────────────────────────────────────────────────────

test("updateSettingsSchema keeps a valid rewardLevels and accepts null (the clear), alone and beside another field", () => {
  const r = updateSettingsSchema.safeParse({ rewardLevels: valid() });
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues));
  if (r.success) assert.deepEqual(r.data.rewardLevels, expected(), "kept (not stripped) and canonicalised");
  const cleared = updateSettingsSchema.safeParse({ rewardLevels: null });
  assert.ok(cleared.success && cleared.data.rewardLevels === null, "null is kept as null");
  const beside = updateSettingsSchema.safeParse({ billShowLogo: true, rewardLevels: null });
  assert.ok(beside.success && beside.data.rewardLevels === null);
  const absent = updateSettingsSchema.safeParse({ billShowLogo: true });
  assert.ok(absent.success && !("rewardLevels" in absent.data), "absent stays absent (no default)");
});

test("updateSettingsSchema rejects an unknown key inside rewardLevels, at a path under rewardLevels", () => {
  const r = updateSettingsSchema.safeParse({ rewardLevels: { ...valid(), sneaky: 1 } });
  assert.equal(r.success, false);
  if (!r.success) assert.ok(r.error.issues.every((i) => i.path[0] === "rewardLevels"), JSON.stringify(r.error.issues.map((i) => i.path)));
  assert.equal(updateSettingsSchema.safeParse({ rewardLevels: { ...valid(), enabled: true } }).success, false, "the launch lock applies through the PUT gate");
});

test("PIN: rewardLevels is PUT-only — never a key of settingsSchema (a section form would resend or wipe it)", () => {
  assert.ok("restaurantName" in settingsSchema.shape, "landmark: settingsSchema.shape is the real key set");
  assert.ok(!("rewardLevels" in settingsSchema.shape));
});
