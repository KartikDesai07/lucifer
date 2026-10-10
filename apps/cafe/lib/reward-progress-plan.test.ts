import { test } from "node:test";
import assert from "node:assert/strict";

import type { ISettings } from "@/models/Settings";
import {
  effectiveAnchor,
  planProgressStep,
  progressGate,
  type PlanProgressInput,
  type ProgressRead,
  type ProgressStepPlan,
} from "@/lib/reward-progress-plan";
import {
  REWARD_CARDS_KEEP,
  REWARD_CARD_STEP_ORDERS_MAX,
  SCRATCH_BLOCK_ENV_VAR,
  type RewardLevelsConfig,
} from "@pos/shared/reward-levels";
import { deadlineFrom, type RewardRng } from "@pos/shared/reward-levels-engine";

// CB-7 S2 slice D: the PURE half of "one counted bill moves one diner one step". Everything is table-driven over
// plain objects: the settings are casts to ISettings, the env is an INJECTED object (process.env is never read), the
// clock is a fixed Date and the rng is a script - no database, no ambient time, no ambient randomness.

const CUSTOMER_ID = "64b7f0c2a1b2c3d4e5f60718";
const ORDER_ID = "A-0042";
const ANCHOR = new Date("2026-10-01T10:00:00.000Z");
const PIN_DATE = new Date("2026-09-15T08:30:00.000Z");
const NOW = new Date("2026-10-05T12:00:00.000Z");
const MS = 1;

// Ladder under test (a step's number is its 1-based lifetime count):
//   level 1: size 3, ONE box on step 3 holding three equal-weight "no reward" options (a, b, c) - steps 1-2 have no box
//   level 2: size 2, a box on step 1 and a box on step 2, each with its own scratch/use days so a test can tell them apart
// Lifetime step -> position: 1,2 = L1 s1,s2 (no box) | 3 = L1 s3 | 4 = L2 s1 | 5 = L2 s2 | 6 = L2 s1 again | ...
const L1_SCRATCH_DAYS = 7;
const L1_USE_DAYS = 14;
const L2_S1_SCRATCH_DAYS = 9;
const L2_S1_USE_DAYS = 21;
const L2_S2_SCRATCH_DAYS = 11;
const L2_S2_USE_DAYS = 30;
const MIN_BILL = 100;

const BLOB: RewardLevelsConfig = {
  v: 1,
  enabled: true,
  levels: [
    {
      size: 3,
      slots: [
        {
          step: 3,
          scratchDays: L1_SCRATCH_DAYS,
          useDays: L1_USE_DAYS,
          options: [
            { kind: "none", id: "a", weight: 1 },
            { kind: "none", id: "b", weight: 1 },
            { kind: "none", id: "c", weight: 1 },
          ],
        },
      ],
    },
    {
      size: 2,
      slots: [
        { step: 1, scratchDays: L2_S1_SCRATCH_DAYS, useDays: L2_S1_USE_DAYS, options: [{ kind: "none", id: "d", weight: 1 }] },
        { step: 2, scratchDays: L2_S2_SCRATCH_DAYS, useDays: L2_S2_USE_DAYS, options: [{ kind: "none", id: "e", weight: 1 }] },
      ],
    },
  ],
};
const UNREADABLE = { v: 99, enabled: true, levels: "garbage" };

const settingsOf = (o: Record<string, unknown>): ISettings => o as unknown as ISettings;
const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;
const NO_ENV = envOf({});
const ON = settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "27ABCDE1234F1Z5" });

// ── progressGate ─────────────────────────────────────────────────────────────────────────────────────────────────

test("progressGate: all legs pass -> ok, carrying the parsed config and the customer id", () => {
  const gate = progressGate(ON, CUSTOMER_ID, MIN_BILL, NO_ENV);
  assert.ok(gate.ok, "landmark: the all-pass case really passes");
  assert.deepEqual(gate.cfg, BLOB);
  assert.equal(gate.customerId, CUSTOMER_ID);
});

test("progressGate: levels-off when diner accounts are off, absent, or the settings are null", () => {
  assert.deepEqual(progressGate(settingsOf({ dinerAccountsEnabled: false, rewardLevels: BLOB }), CUSTOMER_ID, MIN_BILL, NO_ENV), {
    ok: false,
    reason: "levels-off",
  });
  assert.deepEqual(progressGate(settingsOf({ rewardLevels: BLOB }), CUSTOMER_ID, MIN_BILL, NO_ENV), { ok: false, reason: "levels-off" });
  assert.deepEqual(progressGate(null, CUSTOMER_ID, MIN_BILL, NO_ENV), { ok: false, reason: "levels-off" });
});

test("progressGate: levels-off when the blob is absent, enabled:false, or unparseable", () => {
  const accounts = { dinerAccountsEnabled: true };
  assert.deepEqual(progressGate(settingsOf(accounts), CUSTOMER_ID, MIN_BILL, NO_ENV), { ok: false, reason: "levels-off" }, "absent");
  assert.deepEqual(
    progressGate(settingsOf({ ...accounts, rewardLevels: { ...BLOB, enabled: false } }), CUSTOMER_ID, MIN_BILL, NO_ENV),
    { ok: false, reason: "levels-off" },
    "enabled:false",
  );
  assert.deepEqual(
    progressGate(settingsOf({ ...accounts, rewardLevels: UNREADABLE }), CUSTOMER_ID, MIN_BILL, NO_ENV),
    { ok: false, reason: "levels-off" },
    "unparseable even though the owner said enabled:true",
  );
});

test("progressGate: the env block turns it off for 'true' but 'off' words and blank allow it", () => {
  assert.deepEqual(progressGate(ON, CUSTOMER_ID, MIN_BILL, envOf({ [SCRATCH_BLOCK_ENV_VAR]: "true" })), {
    ok: false,
    reason: "levels-off",
  });
  for (const allowed of ["0", "", "  "]) {
    assert.equal(progressGate(ON, CUSTOMER_ID, MIN_BILL, envOf({ [SCRATCH_BLOCK_ENV_VAR]: allowed })).ok, true, `"${allowed}" allows`);
  }
});

test("progressGate: a GSTIN starting 33 blocks, another state's does not", () => {
  const tn = settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "33ABCDE1234F1Z5" });
  assert.deepEqual(progressGate(tn, CUSTOMER_ID, MIN_BILL, NO_ENV), { ok: false, reason: "levels-off" });
  assert.equal(progressGate(ON, CUSTOMER_ID, MIN_BILL, NO_ENV).ok, true, "landmark: the same call without the 33 prefix passes");
});

test("progressGate: no-customer for null / undefined / empty / a string that is not an ObjectId", () => {
  for (const bad of [null, undefined, "", "not-an-id", "abcdefghijkl", "64b7f0c2a1b2c3d4e5f6071"]) {
    assert.deepEqual(progressGate(ON, bad, MIN_BILL, NO_ENV), { ok: false, reason: "no-customer" }, `${String(bad)}`);
  }
  assert.equal(progressGate(ON, CUSTOMER_ID, MIN_BILL, NO_ENV).ok, true, "landmark: a real id passes");
});

test("progressGate: the min-bill boundary is >= - total == minBill counts, minBill - 1 is below", () => {
  const withMin = settingsOf({ dinerAccountsEnabled: true, rewardLevels: { ...BLOB, minBill: MIN_BILL } });
  assert.equal(progressGate(withMin, CUSTOMER_ID, MIN_BILL, NO_ENV).ok, true, "== minBill counts");
  assert.equal(progressGate(withMin, CUSTOMER_ID, MIN_BILL + 1, NO_ENV).ok, true, "above counts");
  assert.deepEqual(progressGate(withMin, CUSTOMER_ID, MIN_BILL - 1, NO_ENV), { ok: false, reason: "below-min-bill" });
  assert.deepEqual(progressGate(withMin, CUSTOMER_ID, 0, NO_ENV), { ok: false, reason: "below-min-bill" });
});

test("progressGate: with no minBill every bill counts, even a zero total", () => {
  assert.equal(progressGate(ON, CUSTOMER_ID, 0, NO_ENV).ok, true);
});

test("progressGate: the legs fire in order - levels-off beats no-customer beats below-min-bill", () => {
  const off = settingsOf({ dinerAccountsEnabled: false, rewardLevels: { ...BLOB, minBill: MIN_BILL } });
  assert.deepEqual(progressGate(off, null, 0, NO_ENV), { ok: false, reason: "levels-off" });
  const withMin = settingsOf({ dinerAccountsEnabled: true, rewardLevels: { ...BLOB, minBill: MIN_BILL } });
  assert.deepEqual(progressGate(withMin, null, 0, NO_ENV), { ok: false, reason: "no-customer" });
});

// ── effectiveAnchor ──────────────────────────────────────────────────────────────────────────────────────────────

test("effectiveAnchor: the stored anchor wins over pinSetAt", () => {
  assert.equal(effectiveAnchor({ rewardsAnchorAt: ANCHOR, pinSetAt: PIN_DATE }), ANCHOR);
  assert.equal(effectiveAnchor({ rewardsAnchorAt: ANCHOR }), ANCHOR);
});

test("effectiveAnchor: pinSetAt is the fallback when the anchor is absent or null", () => {
  assert.equal(effectiveAnchor({ pinSetAt: PIN_DATE }), PIN_DATE);
  assert.equal(effectiveAnchor({ rewardsAnchorAt: null, pinSetAt: PIN_DATE }), PIN_DATE);
});

test("effectiveAnchor: neither -> null (a diner with no PIN and no anchor is not in the programme)", () => {
  assert.equal(effectiveAnchor({}), null);
  assert.equal(effectiveAnchor({ rewardsAnchorAt: null, pinSetAt: null }), null);
  assert.equal(effectiveAnchor({ cardSteps: 7 }), null, "a counter alone is no anchor");
});

// ── planProgressStep ─────────────────────────────────────────────────────────────────────────────────────────────

// A rng that answers 0 and records what it was asked (maxExclusive), so "who picked" and "was it asked at all" are
// both observable.
function recordingRng(answers: number[] = []): { rng: RewardRng; asked: number[] } {
  const asked: number[] = [];
  const queue = [...answers];
  const rng: RewardRng = (maxExclusive) => {
    asked.push(maxExclusive);
    return queue.shift() ?? 0;
  };
  return { rng, asked };
}

function idSource(): { newCardId: () => string; issued: string[] } {
  const issued: string[] = [];
  return {
    issued,
    newCardId: () => {
      const id = `card${String(issued.length + 1).padStart(2, "0")}`;
      issued.push(id);
      return id;
    },
  };
}

function inputOf(read: ProgressRead, over: Partial<PlanProgressInput> = {}): PlanProgressInput {
  return {
    read,
    cfg: BLOB,
    customerId: CUSTOMER_ID,
    orderId: ORDER_ID,
    orderCreatedAt: new Date(ANCHOR.getTime() + MS),
    now: NOW,
    rng: recordingRng().rng,
    newCardId: idSource().newCardId,
    ...over,
  };
}

function mustPlan(input: PlanProgressInput): ProgressStepPlan {
  const result = planProgressStep(input);
  assert.ok(!("skip" in result), `expected a plan, got skip ${"skip" in result ? result.skip : ""}`);
  return result;
}

function mustCard(plan: ProgressStepPlan): NonNullable<ProgressStepPlan["card"]> {
  assert.ok(plan.card, "expected the step to issue a card");
  return plan.card;
}

test("planProgressStep: not-anchored when neither an anchor nor a PIN date exists", () => {
  const rng = recordingRng();
  const ids = idSource();
  for (const read of [{}, { cardSteps: 3 }, { rewardsAnchorAt: null, pinSetAt: null }]) {
    assert.deepEqual(planProgressStep(inputOf(read, { rng: rng.rng, newCardId: ids.newCardId })), { skip: "not-anchored" });
  }
  assert.deepEqual(rng.asked, [], "a skipped step never rolls");
  assert.deepEqual(ids.issued, [], "a skipped step never mints an id");
});

test("planProgressStep: before-anchor - 1 ms before skips, the equal instant counts, 1 ms after counts", () => {
  const read: ProgressRead = { rewardsAnchorAt: ANCHOR };
  const rng = recordingRng();
  assert.deepEqual(
    planProgressStep(inputOf(read, { orderCreatedAt: new Date(ANCHOR.getTime() - MS), rng: rng.rng })),
    { skip: "before-anchor" },
  );
  assert.deepEqual(rng.asked, [], "landmark: the skip happened before any roll");
  assert.ok(!("skip" in planProgressStep(inputOf(read, { orderCreatedAt: new Date(ANCHOR.getTime()) }))), "equal instant counts");
  assert.ok(!("skip" in planProgressStep(inputOf(read, { orderCreatedAt: new Date(ANCHOR.getTime() + MS) }))), "1 ms after counts");
});

test("planProgressStep: before-anchor is measured against the PIN date when the diner is lazily anchored", () => {
  const read: ProgressRead = { pinSetAt: PIN_DATE };
  assert.deepEqual(planProgressStep(inputOf(read, { orderCreatedAt: new Date(PIN_DATE.getTime() - MS) })), { skip: "before-anchor" });
  assert.ok(!("skip" in planProgressStep(inputOf(read, { orderCreatedAt: new Date(PIN_DATE.getTime()) }))), "equal to the PIN date counts");
});

test("planProgressStep: t0 0 -> EXACT filter and update (counter key {$in:[null,0]}, no rewardCards for a box-less step)", () => {
  const plan = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR }));
  assert.equal(plan.t0, 0);
  assert.equal(plan.n, 1);
  assert.equal(plan.card, null, "step 1 has no box");
  const createdAt = new Date(ANCHOR.getTime() + MS);
  assert.deepEqual(plan.filter, {
    _id: CUSTOMER_ID,
    cardStepOrders: { $ne: ORDER_ID },
    cardSteps: { $in: [null, 0] },
    $or: [
      { rewardsAnchorAt: { $lte: createdAt } },
      { rewardsAnchorAt: { $exists: false }, pinHash: { $exists: true }, pinSetAt: { $lte: createdAt } },
    ],
  });
  assert.deepEqual(plan.update, {
    $inc: { cardSteps: 1 },
    $min: { rewardsAnchorAt: ANCHOR },
    $push: { cardStepOrders: { $each: [ORDER_ID], $slice: -REWARD_CARD_STEP_ORDERS_MAX } },
  });
  const push = (plan.update as { $push: Record<string, unknown> }).$push;
  assert.ok("cardStepOrders" in push, "landmark: the marker push is there");
  assert.equal("rewardCards" in push, false, "no rewardCards key at all when the step has no box");
});

test("planProgressStep: an absent, null and 0 counter all plan the same step 1", () => {
  const absent = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR }));
  const nul = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: null }));
  const zero = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 0 }));
  assert.deepEqual(nul.filter, absent.filter);
  assert.deepEqual(zero.filter, absent.filter);
  assert.equal(nul.t0, 0);
  assert.equal(zero.n, 1);
});

test("planProgressStep: t0 5 -> EXACT filter (counter key is the bare 5) and update carrying the issued card", () => {
  const plan = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 5 }));
  assert.equal(plan.t0, 5);
  assert.equal(plan.n, 6);
  const card = mustCard(plan);
  const createdAt = new Date(ANCHOR.getTime() + MS);
  assert.deepEqual(plan.filter, {
    _id: CUSTOMER_ID,
    cardStepOrders: { $ne: ORDER_ID },
    cardSteps: 5,
    $or: [
      { rewardsAnchorAt: { $lte: createdAt } },
      { rewardsAnchorAt: { $exists: false }, pinHash: { $exists: true }, pinSetAt: { $lte: createdAt } },
    ],
  });
  assert.deepEqual(plan.update, {
    $inc: { cardSteps: 1 },
    $min: { rewardsAnchorAt: ANCHOR },
    $push: {
      cardStepOrders: { $each: [ORDER_ID], $slice: -REWARD_CARD_STEP_ORDERS_MAX },
      rewardCards: { $each: [card], $sort: { keepUntil: 1 }, $slice: -REWARD_CARDS_KEEP },
    },
  });
});

test("planProgressStep: $min.rewardsAnchorAt is the effective anchor - the stored one, or the PIN date when lazy", () => {
  const stored = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, pinSetAt: PIN_DATE }));
  assert.deepEqual((stored.update as { $min: unknown }).$min, { rewardsAnchorAt: ANCHOR }, "stored anchor wins over the PIN date");
  const lazy = mustPlan(inputOf({ pinSetAt: PIN_DATE }));
  assert.deepEqual((lazy.update as { $min: unknown }).$min, { rewardsAnchorAt: PIN_DATE }, "lazy anchor = pinSetAt");
  assert.deepEqual((lazy.update as { $inc: unknown }).$inc, { cardSteps: 1 }, "landmark: the lazy plan is a full plan");
});

test("planProgressStep: the card carries the step key, source, 1-based level, step, injected id and keepUntil === scratchBy", () => {
  const ids = idSource();
  const plan = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 5 }, { newCardId: ids.newCardId }));
  const card = mustCard(plan);
  assert.deepEqual(ids.issued, ["card01"], "the id source is asked exactly once");
  assert.equal(card.id, "card01");
  assert.equal(card.issueKey, "step:6");
  assert.equal(card.source, "level");
  assert.equal(card.level, 2, "levelIndex 1 is shown as level 2");
  assert.equal(card.step, 1);
  assert.equal(card.status, "ready");
  assert.equal(card.issuedAt, NOW, "stamped with the injected clock");
  assert.equal(card.scratchBy.getTime(), deadlineFrom(NOW.getTime(), L2_S1_SCRATCH_DAYS).getTime());
  assert.equal(card.keepUntil.getTime(), card.scratchBy.getTime());
  assert.ok(card.scratchBy.getTime() > NOW.getTime(), "landmark: the deadline is in the future");
  assert.equal(card.useDays, L2_S1_USE_DAYS);
});

test("planProgressStep: a box-less step mints no id and does not roll", () => {
  const ids = idSource();
  const rng = recordingRng();
  for (const cardSteps of [0, 1]) {
    const plan = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps }, { newCardId: ids.newCardId, rng: rng.rng }));
    assert.equal(plan.card, null);
  }
  assert.deepEqual(ids.issued, []);
  assert.deepEqual(rng.asked, []);
});

test("planProgressStep: level boundary - the last step of level 1 vs the first step of level 2", () => {
  const last = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 2 })));
  assert.equal(last.issueKey, "step:3");
  assert.equal(last.level, 1);
  assert.equal(last.step, 3);
  assert.equal(last.useDays, L1_USE_DAYS);
  assert.equal(last.scratchBy.getTime(), deadlineFrom(NOW.getTime(), L1_SCRATCH_DAYS).getTime());

  const first = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 3 })));
  assert.equal(first.issueKey, "step:4");
  assert.equal(first.level, 2);
  assert.equal(first.step, 1);
  assert.equal(first.useDays, L2_S1_USE_DAYS);
  assert.equal(first.scratchBy.getTime(), deadlineFrom(NOW.getTime(), L2_S1_SCRATCH_DAYS).getTime());

  const second = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 4 })));
  assert.equal(second.level, 2);
  assert.equal(second.step, 2);
  assert.equal(second.useDays, L2_S2_USE_DAYS);
});

test("planProgressStep: after the last step the LAST level repeats (F5) and lands on its slot again", () => {
  const firstPass = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 3 }))); // step 4 = L2 s1
  const repeat = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 5 }))); // step 6 = L2 s1 again
  assert.equal(repeat.issueKey, "step:6");
  assert.equal(repeat.level, 2);
  assert.equal(repeat.step, firstPass.step);
  assert.equal(repeat.optionId, firstPass.optionId);
  assert.equal(repeat.useDays, firstPass.useDays);

  const farRepeat = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 101 }))); // step 102: offset 98 in a size-2 level
  assert.equal(farRepeat.issueKey, "step:102");
  assert.equal(farRepeat.level, 2);
  assert.equal(farRepeat.step, 1);

  const farSecond = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 102 }))); // step 103
  assert.equal(farSecond.level, 2);
  assert.equal(farSecond.step, 2);
});

test("planProgressStep: the INJECTED rng picks the option - a scripted 2 chooses the third, 0 and 1 the first and second", () => {
  const picked = (answer: number): { optionId: string; asked: number[] } => {
    const { rng, asked } = recordingRng([answer]);
    const card = mustCard(mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 2 }, { rng })));
    return { optionId: card.optionId, asked };
  };
  const third = picked(2);
  assert.equal(third.optionId, "c");
  assert.deepEqual(third.asked, [3], "asked once, over the three equal weights (a none option has no value roll)");
  assert.equal(picked(0).optionId, "a");
  assert.equal(picked(1).optionId, "b");
});

test("planProgressStep: a config with no levels still counts the step, with no card and no rewardCards key", () => {
  const plan = mustPlan(inputOf({ rewardsAnchorAt: ANCHOR, cardSteps: 4 }, { cfg: { ...BLOB, levels: [] } }));
  assert.equal(plan.card, null);
  assert.equal(plan.n, 5);
  assert.equal("rewardCards" in (plan.update as { $push: Record<string, unknown> }).$push, false);
  assert.deepEqual((plan.update as { $inc: unknown }).$inc, { cardSteps: 1 });
});
