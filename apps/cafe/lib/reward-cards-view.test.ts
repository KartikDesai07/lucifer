import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DINER_READY_CARD_KEYS,
  type DinerReadyCardDto,
  type DinerRevealedCardDto,
} from "@pos/shared/public-diner-cards";
import {
  REWARD_OPTION_KINDS,
  type RewardCardSnapshot,
  type RewardLevelsConfig,
  type RewardOptionKind,
} from "@pos/shared/reward-levels";
import { inr } from "@pos/shared/utils";
import { buildDinerCardsData, cardDtoOf, walletOf } from "@/lib/reward-cards-view";

// CB-7 S4 slice B: the PURE wallet view. The security rule is the allowlist: a card whose STORED status is "ready"
// (fresh or past its scratch-by date) never carries its outcome. DB-free.

const NOW = new Date("2026-10-12T06:00:00.000Z");
const HOUR = 3_600_000;
const FUTURE = new Date(NOW.getTime() + 48 * HOUR);
const PAST = new Date(NOW.getTime() - 48 * HOUR);

const pool = [
  { kind: "bill-percent" as const, label: "5–15% off the bill", weight: 1 },
  { kind: "none" as const, label: "Better luck next time", weight: 1 },
];

function card(kind: RewardOptionKind, o: Partial<RewardCardSnapshot> = {}): RewardCardSnapshot {
  const outcome: Partial<RewardCardSnapshot> = {
    "bill-percent": { value: 12, minBill: 300 },
    "bill-flat": { value: 50 },
    "product-percent": { value: 20, productId: "prod-secret-1", productName: "Cold Coffee", capRupees: 100 },
    "category-percent": { value: 15, categoryId: "cat-secret-1", categoryName: "Desserts", capRupees: 80, minBill: 200 },
    "category-flat": { value: 40, categoryId: "cat-secret-1", categoryName: "Desserts" },
    "free-item": { value: 0, productId: "prod-secret-1", productName: "Cold Coffee", qty: 2 },
    points: { value: 50 },
    none: { value: 0 },
  }[kind];
  return {
    id: "0123456789ab",
    issueKey: "step:3",
    source: "level",
    level: 1,
    step: 3,
    optionId: "opt-secret",
    kind,
    pool,
    issuedAt: new Date(NOW.getTime() - HOUR),
    scratchBy: FUTURE,
    useDays: 14,
    keepUntil: FUTURE,
    status: "ready",
    value: 0,
    ...outcome,
    ...o,
  } as RewardCardSnapshot;
}

const revealed = (kind: RewardOptionKind, o: Partial<RewardCardSnapshot> = {}): DinerRevealedCardDto =>
  cardDtoOf(card(kind, { status: "revealed", revealedAt: NOW, validUntil: FUTURE, ...o }), NOW) as DinerRevealedCardDto;

const FORBIDDEN_KEYS = ['"value"', "optionId", "productId", "categoryId", "outcome", "minBill", "capRupees", "productName", "categoryName"];
const FORBIDDEN_VALUES = ["prod-secret-1", "cat-secret-1", "opt-secret", "issueKey", "useDays", "keepUntil"];

test("PARITY: DinerReadyCardDto keys are exactly DINER_READY_CARD_KEYS (a Record<keyof, true> must list every key)", () => {
  const all: Record<keyof DinerReadyCardDto, true> = {
    id: true, source: true, level: true, step: true, title: true, issuedAt: true, scratchBy: true, status: true, state: true, pool: true,
  };
  assert.deepEqual([...DINER_READY_CARD_KEYS].sort(), Object.keys(all).sort());
});

for (const kind of REWARD_OPTION_KINDS) {
  test(`READY (${kind}): fresh and expired cards carry only the allowlist - no outcome anywhere in the JSON`, () => {
    for (const [scratchBy, state] of [[FUTURE, "ready"], [PAST, "expired"]] as const) {
      const dto = cardDtoOf(card(kind, { scratchBy }), NOW);
      assert.equal(dto.status, "ready", "stored status decides the branch");
      assert.equal(dto.state, state);
      for (const key of Object.keys(dto)) assert.ok((DINER_READY_CARD_KEYS as readonly string[]).includes(key), `unexpected key ${key}`);
      const json = JSON.stringify(dto);
      for (const needle of [...FORBIDDEN_KEYS, ...FORBIDDEN_VALUES]) assert.equal(json.includes(needle), false, `${kind} ${state} leaks ${needle}`);
      assert.ok(json.includes('"pool"') && json.includes('"scratchBy"'), "landmark: the allowlist keys are present");
    }
  });
}

test("READY: epoch-ms dates, level/step only when the card has them, pool = {kind,label,chance} adding to 100", () => {
  const dto = cardDtoOf(card("bill-percent"), NOW) as DinerReadyCardDto;
  assert.equal(dto.issuedAt, NOW.getTime() - HOUR);
  assert.equal(dto.scratchBy, FUTURE.getTime());
  assert.deepEqual(dto.pool, [
    { kind: "bill-percent", label: "5–15% off the bill", chance: 50 },
    { kind: "none", label: "Better luck next time", chance: 50 },
  ]);
  assert.equal(dto.level, 1);
  assert.equal(dto.step, 3);
  const camp = cardDtoOf({ ...card("bill-flat"), source: "campaign", level: undefined, step: undefined }, NOW);
  assert.equal("level" in camp, false);
  assert.equal("step" in camp, false);
  const odd = cardDtoOf(card("bill-percent", { pool: [{ kind: "points", label: "a", weight: 1 }, { kind: "none", label: "b", weight: 1 }, { kind: "none", label: "c", weight: 1 }] }), NOW);
  assert.equal(odd.pool.reduce((s, p) => s + p.chance, 0), 100);
});

test("REVEALED: outcome labels + conditions for all 8 kinds", () => {
  const cases: [RewardOptionKind, string, string | null][] = [
    ["bill-percent", "12% off the bill", `Valid on bills of ${inr(300)} or more.`],
    ["bill-flat", `${inr(50)} off the bill`, null],
    ["product-percent", "20% off one Cold Coffee", `Discount is capped at ${inr(100)}.`],
    ["category-percent", "15% off Desserts", `Valid on bills of ${inr(200)} or more. Discount is capped at ${inr(80)}.`],
    ["category-flat", `${inr(40)} off Desserts`, null],
    ["free-item", "2 × Free Cold Coffee", null],
    ["points", "50 points", null],
  ];
  assert.equal(cases.length + 1, REWARD_OPTION_KINDS.length, "landmark: every kind but none is here");
  for (const [kind, label, condition] of cases) {
    const dto = revealed(kind);
    assert.equal(dto.outcome.label, label, kind);
    assert.equal(dto.outcome.condition, condition, kind);
    assert.equal(dto.outcome.kind, kind);
    assert.equal(dto.state, "revealed");
    assert.equal(dto.revealedAt, NOW.getTime());
    assert.equal(dto.validUntil, FUTURE.getTime());
  }
  assert.equal(revealed("free-item", { qty: 1 }).outcome.label, "Free Cold Coffee");
  assert.equal(revealed("bill-flat", { minBill: 0 }).outcome.condition, null, "a zero minimum bill is no condition");
});

test("REVEALED: none = used with the default or the owner's label; points carry pointsLeft", () => {
  const none = cardDtoOf(card("none", { status: "used", revealedAt: NOW, usedAt: NOW, keepUntil: NOW }), NOW) as DinerRevealedCardDto;
  assert.equal(none.status, "used");
  assert.equal(none.state, "used");
  assert.equal(none.usedAt, NOW.getTime());
  assert.equal(none.outcome.label, "Better luck next time");
  assert.equal("pointsLeft" in none.outcome, false);
  const custom = cardDtoOf(card("none", { status: "used", label: "Not today" }), NOW) as DinerRevealedCardDto;
  assert.equal(custom.outcome.label, "Not today");
  const pts = revealed("points", { pointsSpent: 20 });
  assert.equal(pts.outcome.pointsLeft, 30);
  assert.equal(pts.outcome.value, 50);
  assert.equal(revealed("points", { pointsSpent: 80 }).outcome.pointsLeft, 0, "never negative");
  assert.equal(revealed("points", { value: 1 }).outcome.label, "1 point");
});

test("REVEALED: an expired revealed card keeps its stored outcome with state expired; no secrets (id refs, issue key)", () => {
  const dto = revealed("product-percent", { validUntil: PAST });
  assert.equal(dto.state, "expired");
  assert.equal(dto.outcome.label, "20% off one Cold Coffee");
  const json = JSON.stringify(dto);
  for (const needle of ["optionId", "productId", "categoryId", "prod-secret-1", "opt-secret", "issueKey", "useDays", "keepUntil", "orderId"]) {
    assert.equal(json.includes(needle), false, `revealed leaks ${needle}`);
  }
  assert.ok(json.includes('"outcome"'), "landmark: the outcome is there after the reveal");
});

test("walletOf: newest issuedAt first, a tie broken by id, input untouched", () => {
  const a = card("none", { id: "aaaaaaaaaaaa", issuedAt: new Date(1000) });
  const b = card("none", { id: "bbbbbbbbbbbb", issuedAt: new Date(2000) });
  const c = card("none", { id: "cccccccccccc", issuedAt: new Date(2000) });
  const input = [a, c, b];
  assert.deepEqual(walletOf(input).map((x) => x.id), ["bbbbbbbbbbbb", "cccccccccccc", "aaaaaaaaaaaa"]);
  assert.deepEqual(input.map((x) => x.id), ["aaaaaaaaaaaa", "cccccccccccc", "bbbbbbbbbbbb"]);
});

const opt = (id: string, kind: "bill-percent" | "none", weight = 1) =>
  kind === "none" ? { id, weight, kind } : { id, weight, kind, min: 5, max: 15 };
const CFG: RewardLevelsConfig = {
  v: 1,
  enabled: true,
  levels: [
    { size: 2, slots: [{ step: 2, scratchDays: 7, useDays: 14, options: [opt("a", "bill-percent")] }] },
    {
      size: 3,
      slots: [
        { step: 3, scratchDays: 7, useDays: 14, options: [opt("b", "bill-percent"), opt("c", "none")] },
        { step: 1, scratchDays: 7, useDays: 14, options: [opt("d", "bill-percent", 3), opt("e", "bill-percent", 1)] },
      ],
    },
  ],
};
const build = (cardSteps: number, over: Partial<Parameters<typeof buildDinerCardsData>[0]> = {}) =>
  buildDinerCardsData({ earning: true, cfg: CFG, cardSteps, cards: [], now: NOW, ...over });

test("buildDinerCardsData: progress is 1-based and crosses a level boundary", () => {
  assert.deepEqual(build(0).progress, { level: 1, levelCount: 2, round: 0, size: 2, filled: 0, stepsToNextCard: 2, nextBox: { level: 1, step: 2 } });
  assert.deepEqual(build(1).progress, { level: 1, levelCount: 2, round: 0, size: 2, filled: 1, stepsToNextCard: 1, nextBox: { level: 1, step: 2 } });
  assert.deepEqual(build(2).progress, { level: 2, levelCount: 2, round: 0, size: 3, filled: 0, stepsToNextCard: 1, nextBox: { level: 2, step: 1 } });
  assert.deepEqual(build(4).progress, { level: 2, levelCount: 2, round: 0, size: 3, filled: 2, stepsToNextCard: 1, nextBox: { level: 2, step: 3 } });
});

test("buildDinerCardsData: after the last level the last level repeats (round counts re-runs)", () => {
  assert.deepEqual(build(5).progress, { level: 2, levelCount: 2, round: 1, size: 3, filled: 0, stepsToNextCard: 1, nextBox: { level: 2, step: 1 } });
  assert.equal(build(7).progress?.round, 1);
  assert.equal(build(8).progress?.round, 2);
});

test("buildDinerCardsData: ladder boxes in step order with kinds, labels, chances and everyCardWins", () => {
  const ladder = build(0).ladder;
  assert.ok(ladder);
  assert.deepEqual(ladder.map((l) => [l.level, l.size, l.boxes.map((b) => b.step)]), [[1, 2, [2]], [2, 3, [1, 3]]]);
  assert.deepEqual(ladder[1].boxes[0].choices, [
    { kind: "bill-percent", label: "5–15% off the bill", chance: 75 },
    { kind: "bill-percent", label: "5–15% off the bill", chance: 25 },
  ]);
  assert.deepEqual(ladder[1].boxes[1].choices.map((c) => c.kind), ["bill-percent", "none"]);
  assert.equal(ladder[0].boxes[0].everyCardWins, true);
  assert.equal(ladder[1].boxes[0].everyCardWins, true);
  assert.equal(ladder[1].boxes[1].everyCardWins, false, "a box with a No-reward choice never claims every card wins");
});

test("buildDinerCardsData: not earning -> no progress / ladder, but the wallet and the points balance remain", () => {
  const lot = card("points", { status: "revealed", revealedAt: NOW, validUntil: FUTURE, pointsSpent: 10 });
  const data = build(3, { earning: false, cards: [lot, card("bill-flat")] });
  assert.equal(data.earning, false);
  assert.equal(data.progress, null);
  assert.equal(data.ladder, null);
  assert.equal(data.cards.length, 2);
  assert.equal(data.pointsBalance, 40);
  const noCfg = build(3, { cfg: null });
  assert.equal(noCfg.earning, false, "earning with no readable config cannot show a ladder");
  assert.equal(noCfg.progress, null);
  assert.equal(build(0, { earning: true }).earning, true);
});

test("buildDinerCardsData: expired points lots and ready cards add nothing to the balance; cards are newest first", () => {
  const dead = card("points", { id: "111111111111", status: "revealed", validUntil: PAST, issuedAt: new Date(1) });
  const live = card("points", { id: "222222222222", status: "revealed", validUntil: FUTURE, issuedAt: new Date(2) });
  const ready = card("points", { id: "333333333333", issuedAt: new Date(3) });
  const data = build(0, { cards: [dead, live, ready] });
  assert.equal(data.pointsBalance, 50);
  assert.deepEqual(data.cards.map((c) => c.id), ["333333333333", "222222222222", "111111111111"]);
});

const boxAt = (step: number) => ({ step, scratchDays: 7, useDays: 14, options: [opt(`o${step}`, "bill-percent")] });
const cfgOf = (levels: { size: number; steps: number[] }[]): RewardLevelsConfig => ({
  v: 1,
  enabled: true,
  levels: levels.map((l) => ({ size: l.size, slots: l.steps.map(boxAt) })),
});
const nextBoxOf = (cfg: RewardLevelsConfig, cardSteps: number) => build(cardSteps, { cfg }).progress?.nextBox;

test("nextBox: the box the next card comes from, inside the current level (boxes at steps 4 and 8 of 8)", () => {
  const cfg = cfgOf([{ size: 8, steps: [4, 8] }]);
  assert.deepEqual(nextBoxOf(cfg, 2), { level: 1, step: 4 });
  assert.equal(build(2, { cfg }).progress?.stepsToNextCard, 2);
  assert.deepEqual(nextBoxOf(cfg, 4), { level: 1, step: 8 });
  assert.deepEqual(nextBoxOf(cfg, 0), { level: 1, step: 4 });
});

test("nextBox: a level whose remaining steps hold no box -> the first box of the next level that has one", () => {
  const cfg = cfgOf([{ size: 4, steps: [2] }, { size: 3, steps: [] }, { size: 5, steps: [3, 5] }]);
  assert.deepEqual(nextBoxOf(cfg, 2), { level: 3, step: 3 }, "past level 1's only box, level 2 has none");
    assert.equal(build(2, { cfg }).progress?.stepsToNextCard, 8, "landmark: bills 3-4 (level 1), 5-7 (level 2), then level 3 step 3 is bill 10");
});

test("nextBox: past the last level the repeating last level supplies the box (F5)", () => {
  const cfg = cfgOf([{ size: 2, steps: [2] }, { size: 4, steps: [1, 3] }]);
  assert.deepEqual(nextBoxOf(cfg, 4), { level: 2, step: 3 }, "first pass of level 2");
  assert.equal(build(4, { cfg }).progress?.round, 0);
  assert.deepEqual(nextBoxOf(cfg, 5), { level: 2, step: 1 }, "step 4 holds no box, so the repeat's step 1");
  assert.deepEqual(nextBoxOf(cfg, 7), { level: 2, step: 3 });
  assert.equal(build(7, { cfg }).progress?.round, 1);
  assert.deepEqual(nextBoxOf(cfg, 9), { level: 2, step: 1 });
});

test("nextBox: null when the config has no boxes at all (stepsToNextCard is null too)", () => {
  const cfg = cfgOf([{ size: 3, steps: [] }]);
  const progress = build(1, { cfg }).progress;
  assert.equal(progress?.stepsToNextCard, null);
  assert.equal(progress?.nextBox, null);
});

// CB-7 S6 session 3: a festival card carries its campaign name as `title` on BOTH DTO kinds (config text, never the
// outcome); a level card has no `title` key at all.
test("title: a campaign card carries it on ready AND revealed DTOs; a level card has no title key", () => {
  const camp = { source: "campaign" as const, level: undefined, step: undefined, title: "Diwali treat" };
  const ready = cardDtoOf(card("bill-percent", camp), NOW) as DinerReadyCardDto;
  assert.equal(ready.title, "Diwali treat");
  assert.equal(ready.status, "ready");
  assert.ok(JSON.stringify(ready).includes('"pool"'), "landmark: the ready allowlist is present");
  for (const key of Object.keys(ready)) assert.ok((DINER_READY_CARD_KEYS as readonly string[]).includes(key), `unexpected key ${key}`);

  const shown = revealed("bill-percent", camp);
  assert.equal(shown.title, "Diwali treat");
  assert.equal(shown.status, "revealed");
  assert.ok(shown.outcome, "landmark: the revealed card carries its outcome");

  assert.equal("title" in (cardDtoOf(card("bill-percent"), NOW) as DinerReadyCardDto), false);
  assert.equal("title" in revealed("bill-percent"), false);
});
