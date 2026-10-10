import { test } from "node:test";
import assert from "node:assert/strict";

import type { ISettings } from "@/models/Settings";
import { advanceRewardProgress, type ProgressOrder, type RewardProgressDeps } from "@/lib/reward-progress";
import type { ProgressRead } from "@/lib/reward-progress-plan";
import { REWARD_PROGRESS_CAS_ATTEMPTS, SCRATCH_BLOCK_ENV_VAR, type RewardCardSnapshot, type RewardLevelsConfig } from "@pos/shared/reward-levels";

// CB-7 S2 slice D: the IO half over FAKE deps. Every dep call is recorded in one ordered log, so the tests can say
// "exactly one read and one write", "no second write" and "the clock was read once" as plain assertions. The pure
// planning is covered in reward-progress-plan.test.ts; here the plan is real and only the database is fake.

const CUSTOMER_ID = "64b7f0c2a1b2c3d4e5f60718";
const ORDER_ID = "A-0042";
const ANCHOR = new Date("2026-10-01T10:00:00.000Z");
const NOW = new Date("2026-10-05T12:00:00.000Z");
const ORDER_TOTAL_RUPEES = 250;
const MS = 1;
const MIN_BILL = 300;

// Same ladder shape as the plan suite: level 1 = size 3 with a box only on step 3; level 2 = size 2 with a box on
// each step. Lifetime step 1 and 2 have no box; step 3 does. So cardSteps 0 and 1 issue nothing, cardSteps 2 issues.
const BLOB: RewardLevelsConfig = {
  v: 1,
  enabled: true,
  levels: [
    { size: 3, slots: [{ step: 3, scratchDays: 7, useDays: 14, options: [{ kind: "none", id: "a", weight: 1 }] }] },
    {
      size: 2,
      slots: [
        { step: 1, scratchDays: 9, useDays: 21, options: [{ kind: "none", id: "d", weight: 1 }] },
        { step: 2, scratchDays: 11, useDays: 30, options: [{ kind: "none", id: "e", weight: 1 }] },
      ],
    },
  ],
};
const settingsOf = (o: Record<string, unknown>): ISettings => o as unknown as ISettings;
const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;
const ON = settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "27ABCDE1234F1Z5" });
const ORDER: ProgressOrder = { orderId: ORDER_ID, createdAt: new Date(ANCHOR.getTime() + MS), total: ORDER_TOTAL_RUPEES };

const anchored = (cardSteps?: number): ProgressRead => (cardSteps === undefined ? { rewardsAnchorAt: ANCHOR } : { rewardsAnchorAt: ANCHOR, cardSteps });

interface Script {
  reads?: (ProgressRead | null)[];
  writes?: number[]; // matchedCount per write, in order
  marker?: boolean[]; // markerHolds answers, in order
}

interface Fake {
  deps: RewardProgressDeps;
  log: string[]; // every dep call in order: "read" | "write" | "marker" | "now" | "rng" | "newCardId"
  writes: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
  markerArgs: [string, string][];
  readIds: string[];
}

// A dep that is not scripted (or has run out of answers) THROWS, so an unexpected extra call fails loudly instead
// of quietly returning something plausible.
function fakeDeps(script: Script, env: NodeJS.ProcessEnv = envOf({})): Fake {
  const log: string[] = [];
  const writes: Fake["writes"] = [];
  const markerArgs: [string, string][] = [];
  const readIds: string[] = [];
  const reads = [...(script.reads ?? [])];
  const matched = [...(script.writes ?? [])];
  const marker = [...(script.marker ?? [])];
  let minted = 0;
  const deps: RewardProgressDeps = {
    readProgress: async (customerId) => {
      log.push("read");
      readIds.push(customerId);
      if (reads.length === 0) throw new Error("unscripted read");
      return reads.shift() ?? null;
    },
    writeStep: async (filter, update) => {
      log.push("write");
      writes.push({ filter, update });
      const matchedCount = matched.shift();
      if (matchedCount === undefined) throw new Error("unscripted write");
      return { matchedCount };
    },
    markerHolds: async (customerId, orderId) => {
      log.push("marker");
      markerArgs.push([customerId, orderId]);
      const holds = marker.shift();
      if (holds === undefined) throw new Error("unscripted marker");
      return holds;
    },
    rng: () => {
      log.push("rng");
      return 0;
    },
    newCardId: () => {
      log.push("newCardId");
      minted += 1;
      return `card${String(minted).padStart(2, "0")}`;
    },
    now: () => {
      log.push("now");
      return NOW;
    },
    env,
  };
  return { deps, log, writes, markerArgs, readIds };
}

const count = (log: string[], what: string): number => log.filter((entry) => entry === what).length;

const filterSteps = (write: Fake["writes"][number]): unknown => write.filter.cardSteps;
const cardOf = (write: Fake["writes"][number]): RewardCardSnapshot => {
  const push = (write.update as { $push: { rewardCards?: { $each: RewardCardSnapshot[] } } }).$push;
  assert.ok(push.rewardCards, "expected the write to carry a card");
  return push.rewardCards.$each[0];
};

// ── Gate skips cost nothing ─────────────────────────────────────────────────────────────────────────────────────

test("advanceRewardProgress: every gate skip makes ZERO dep calls - not even now()", async () => {
  const withMin = settingsOf({ dinerAccountsEnabled: true, rewardLevels: { ...BLOB, minBill: MIN_BILL } });
  const cases: { name: string; settings: ISettings | null; customerId: string | null | undefined; env?: NodeJS.ProcessEnv; reason: string }[] = [
    { name: "settings null", settings: null, customerId: CUSTOMER_ID, reason: "levels-off" },
    { name: "accounts off", settings: settingsOf({ dinerAccountsEnabled: false, rewardLevels: BLOB }), customerId: CUSTOMER_ID, reason: "levels-off" },
    { name: "blob absent", settings: settingsOf({ dinerAccountsEnabled: true }), customerId: CUSTOMER_ID, reason: "levels-off" },
    { name: "env block", settings: ON, customerId: CUSTOMER_ID, env: envOf({ [SCRATCH_BLOCK_ENV_VAR]: "true" }), reason: "levels-off" },
    { name: "GSTIN 33", settings: settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "33ABCDE1234F1Z5" }), customerId: CUSTOMER_ID, reason: "levels-off" },
    { name: "walk-in (null)", settings: ON, customerId: null, reason: "no-customer" },
    { name: "walk-in (undefined)", settings: ON, customerId: undefined, reason: "no-customer" },
    { name: "bad id", settings: ON, customerId: "not-an-id", reason: "no-customer" },
    { name: "below min bill", settings: withMin, customerId: CUSTOMER_ID, reason: "below-min-bill" },
  ];
  for (const c of cases) {
    const fake = fakeDeps({}, c.env);
    const result = await advanceRewardProgress(c.settings, c.customerId, ORDER, fake.deps);
    assert.deepEqual(result, { counted: false, reason: c.reason }, c.name);
    assert.deepEqual(fake.log, [], `${c.name}: no dep may be touched`);
  }
  // Landmark: the same fake DOES record calls when the gate passes, so an empty log above is meaningful.
  const live = fakeDeps({ reads: [anchored(0)], writes: [1] });
  await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, live.deps);
  assert.ok(live.log.length > 0);
});

test("advanceRewardProgress: the injected env is what the gate reads (an allowed value passes)", async () => {
  const fake = fakeDeps({ reads: [anchored(0)], writes: [1] }, envOf({ [SCRATCH_BLOCK_ENV_VAR]: "0" }));
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps), { counted: true, cardIssued: false });
});

// ── Happy path ──────────────────────────────────────────────────────────────────────────────────────────────────

test("advanceRewardProgress: happy path with no box = exactly 1 read + 1 write, counted, cardIssued false", async () => {
  const fake = fakeDeps({ reads: [anchored(0)], writes: [1] });
  const result = await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.deepEqual(result, { counted: true, cardIssued: false });
  assert.equal(count(fake.log, "read"), 1);
  assert.equal(count(fake.log, "write"), 1);
  assert.equal(count(fake.log, "marker"), 0, "a win never asks the marker");
  assert.deepEqual(fake.readIds, [CUSTOMER_ID]);
  assert.equal(fake.writes[0].filter._id, CUSTOMER_ID);
  assert.deepEqual(fake.writes[0].filter.cardStepOrders, { $ne: ORDER_ID });
  assert.deepEqual(fake.writes[0].filter.cardSteps, { $in: [null, 0] });
});

test("advanceRewardProgress: happy path on a box step = 1 read + 1 write, cardIssued true, card stamped with now()", async () => {
  const fake = fakeDeps({ reads: [anchored(2)], writes: [1] });
  const result = await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.deepEqual(result, { counted: true, cardIssued: true });
  assert.equal(count(fake.log, "read"), 1);
  assert.equal(count(fake.log, "write"), 1);
  const card = cardOf(fake.writes[0]);
  assert.equal(card.issueKey, "step:3");
  assert.equal(card.id, "card01");
  assert.equal(card.issuedAt, NOW);
  assert.equal(filterSteps(fake.writes[0]), 2);
});

// ── CAS misses ──────────────────────────────────────────────────────────────────────────────────────────────────

test("advanceRewardProgress: miss + the marker holds this order -> already-counted, no second write", async () => {
  const fake = fakeDeps({ reads: [anchored(2)], writes: [0], marker: [true] });
  const result = await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.deepEqual(result, { counted: false, reason: "already-counted" });
  assert.equal(count(fake.log, "write"), 1);
  assert.equal(count(fake.log, "read"), 1, "no retry read either");
  assert.deepEqual(fake.markerArgs, [[CUSTOMER_ID, ORDER_ID]], "the marker is asked about THIS customer and THIS order");
});

test("advanceRewardProgress: miss + counter moved (re-read t0+1) -> a second write on the NEW t0 -> counted", async () => {
  // Attempt 1 plans step 2 (no box) and loses; attempt 2 sees the counter at 2 and plans step 3 (a box).
  const fake = fakeDeps({ reads: [anchored(1), anchored(2)], writes: [0, 1], marker: [false] });
  const result = await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.deepEqual(result, { counted: true, cardIssued: true }, "the result describes the RETRY plan, not the first");
  assert.deepEqual(
    fake.log.filter((e) => e === "read" || e === "write" || e === "marker"),
    ["read", "write", "marker", "read", "write"],
  );
  assert.equal(filterSteps(fake.writes[0]), 1, "first attempt keyed on the first read");
  assert.equal(filterSteps(fake.writes[1]), 2, "the retry filter carries the NEW t0");
  assert.equal(cardOf(fake.writes[1]).issueKey, "step:3");
  assert.equal((fake.writes[0].update.$push as Record<string, unknown>).rewardCards, undefined, "the lost attempt carried no card");
});

test("advanceRewardProgress: miss + the SAME t0 on re-read -> unexplained-miss after exactly 1 write", async () => {
  const fake = fakeDeps({ reads: [anchored(1), anchored(1)], writes: [0], marker: [false] });
  const result = await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.deepEqual(result, { counted: false, reason: "unexplained-miss" });
  assert.equal(count(fake.log, "write"), 1, "a retry that would miss identically is never sent");
  assert.equal(count(fake.log, "read"), 2);
  assert.equal(count(fake.log, "marker"), 1);
});

test("advanceRewardProgress: three misses, each with a moved t0 -> contended after exactly REWARD_PROGRESS_CAS_ATTEMPTS writes", async () => {
  const attempts = REWARD_PROGRESS_CAS_ATTEMPTS;
  assert.ok(attempts >= 2, "landmark: a retry exists at all, else this leg proves nothing");
  const reads = Array.from({ length: attempts }, (_, i) => anchored(i));
  const fake = fakeDeps({ reads, writes: Array.from({ length: attempts }, () => 0), marker: Array.from({ length: attempts }, () => false) });
  const result = await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.deepEqual(result, { counted: false, reason: "contended" });
  assert.equal(count(fake.log, "write"), attempts);
  assert.equal(count(fake.log, "read"), attempts);
  assert.equal(count(fake.log, "now"), 1, "one clock reading across every retry");
  assert.deepEqual(
    fake.writes.map(filterSteps),
    [{ $in: [null, 0] }, ...Array.from({ length: attempts - 1 }, (_, i) => i + 1)],
    "every attempt was keyed on the counter its own read saw",
  );
});

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("advanceRewardProgress: the customer row is gone -> no-row after 1 read, no write", async () => {
  const fake = fakeDeps({ reads: [null] });
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps), { counted: false, reason: "no-row" });
  assert.equal(count(fake.log, "read"), 1);
  assert.equal(count(fake.log, "write"), 0);
});

test("advanceRewardProgress: not anchored / before the anchor on the FIRST read -> that reason, no write", async () => {
  const none = fakeDeps({ reads: [{ cardSteps: 4 }] });
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, none.deps), { counted: false, reason: "not-anchored" });
  assert.equal(count(none.log, "write"), 0);

  const older: ProgressOrder = { ...ORDER, createdAt: new Date(ANCHOR.getTime() - MS) };
  const before = fakeDeps({ reads: [anchored(4)] });
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, older, before.deps), { counted: false, reason: "before-anchor" });
  assert.equal(count(before.log, "write"), 0);
});

test("advanceRewardProgress: the re-read on a retry classifies too - row gone, anchor removed, anchor moved past the bill", async () => {
  const gone = fakeDeps({ reads: [anchored(1), null], writes: [0], marker: [false] });
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, gone.deps), { counted: false, reason: "no-row" });
  assert.equal(count(gone.log, "write"), 1);

  const unanchored = fakeDeps({ reads: [anchored(1), { cardSteps: 2 }], writes: [0], marker: [false] });
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, unanchored.deps), { counted: false, reason: "not-anchored" });
  assert.equal(count(unanchored.log, "write"), 1);

  const later: ProgressRead = { rewardsAnchorAt: new Date(ORDER.createdAt.getTime() + MS), cardSteps: 2 };
  const before = fakeDeps({ reads: [anchored(1), later], writes: [0], marker: [false] });
  assert.deepEqual(await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, before.deps), { counted: false, reason: "before-anchor" });
  assert.equal(count(before.log, "write"), 1);
});

// ── Clock and errors ────────────────────────────────────────────────────────────────────────────────────────────

test("advanceRewardProgress: now() is read exactly once, even across a retry, and both attempts share that instant", async () => {
  // Attempt 1: step 3 (box) loses; attempt 2: step 4 (a box) wins - both cards are stamped from the one reading.
  const fake = fakeDeps({ reads: [anchored(2), anchored(3)], writes: [0, 1], marker: [false] });
  await advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps);
  assert.equal(count(fake.log, "now"), 1);
  assert.equal(fake.log.indexOf("now"), 0, "read before the first database call");
  assert.equal(cardOf(fake.writes[0]).issuedAt, NOW);
  assert.equal(cardOf(fake.writes[1]).issuedAt, NOW);
  assert.equal(cardOf(fake.writes[1]).issueKey, "step:4");
});

test("advanceRewardProgress: a throwing writeStep REJECTS (errors propagate, never swallowed here)", async () => {
  const fake = fakeDeps({ reads: [anchored(0)] });
  fake.deps.writeStep = async () => {
    throw new Error("write boom");
  };
  await assert.rejects(() => advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps), /write boom/);
});

test("advanceRewardProgress: a throwing readProgress REJECTS, on the first attempt and on a retry", async () => {
  const first = fakeDeps({});
  first.deps.readProgress = async () => {
    throw new Error("read boom");
  };
  await assert.rejects(() => advanceRewardProgress(ON, CUSTOMER_ID, ORDER, first.deps), /read boom/);

  const reads: (ProgressRead | Error)[] = [anchored(1), new Error("read boom on retry")];
  const retry = fakeDeps({ writes: [0], marker: [false] });
  retry.deps.readProgress = async () => {
    const next = reads.shift();
    if (next instanceof Error) throw next;
    return next ?? null;
  };
  await assert.rejects(() => advanceRewardProgress(ON, CUSTOMER_ID, ORDER, retry.deps), /read boom on retry/);
  assert.equal(count(retry.log, "write"), 1);
});

test("advanceRewardProgress: a throwing markerHolds REJECTS too", async () => {
  const fake = fakeDeps({ reads: [anchored(1)], writes: [0] });
  fake.deps.markerHolds = async () => {
    throw new Error("marker boom");
  };
  await assert.rejects(() => advanceRewardProgress(ON, CUSTOMER_ID, ORDER, fake.deps), /marker boom/);
});
