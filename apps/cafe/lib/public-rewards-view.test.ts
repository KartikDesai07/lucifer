import { test } from "node:test";
import assert from "node:assert/strict";

import {
  unitWord,
  rewardWorth,
  nextRewardLine,
  trackGeometry,
  HOW_IT_WORKS_STEPS,
} from "@/components/public/public-rewards-view";
import type { DinerStampCard } from "@/lib/diner-loyalty";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

// CB-6D-B — behaviour pins for the pure Rewards-view module
// (components/public/public-rewards-view.ts), split out of
// lib/public-orders-rewards-premium-pins.test.ts to keep that file's source
// pins under the 300-line budget. Mirrors lib/public-home-data.test.ts's
// import style for a components/public pure module.

// A DinerStampCard fixture with EVERY field of the interface
// (apps/cafe/lib/diner-loyalty.ts), so a field added later to the interface
// without a matching update here fails tsc on this file rather than silently
// leaving the fixture incomplete.
function baseCard(overrides: Partial<DinerStampCard> = {}): DinerStampCard {
  return {
    stamps: 0,
    stampsPerReward: 10,
    toNextReward: 4,
    rewardsReady: 0,
    lifetime: 0,
    reward: { kind: "flat", value: 50, item: "" },
    ladder: [],
    cyclePosition: 0,
    reachedThisCycle: 0,
    unitLabel: "stamp",
    ...overrides,
  };
}

// A ResolvedMilestone fixture with EVERY field of the interface
// (@pos/shared/loyalty-rules), so a field added there also fails tsc here.
function milestone(overrides: Partial<ResolvedMilestone> = {}): ResolvedMilestone {
  return {
    at: 10,
    kind: "flat",
    value: 50,
    item: "",
    itemProductId: null,
    qty: 1,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
    ...overrides,
  };
}

// ── unitWord ─────────────────────────────────────────────────────────────

test("public-rewards-view: unitWord — count 1 returns the bare unit, count !== 1 appends 's'", () => {
  assert.equal(unitWord(1, "stamp"), "stamp", "count 1 must not pluralise");
  assert.equal(unitWord(2, "stamp"), "stamps", "count > 1 must pluralise");
  assert.equal(unitWord(0, "stamp"), "stamps", "count 0 must pluralise (not exactly one)");
});

// ── rewardWorth — 3 kinds + empty item ──────────────────────────────────────

test("public-rewards-view: rewardWorth — kind 'item' with a name renders the name", () => {
  assert.equal(rewardWorth({ kind: "item", value: 0, item: "Cappuccino" }), "Cappuccino");
});

test("public-rewards-view: rewardWorth — kind 'item' with an EMPTY item falls back to 'a free item'", () => {
  assert.equal(
    rewardWorth({ kind: "item", value: 0, item: "" }),
    "a free item",
    "an empty item name must never render as a blank reward line",
  );
});

test("public-rewards-view: rewardWorth — kind 'percent' renders '{value}% off your bill'", () => {
  assert.equal(rewardWorth({ kind: "percent", value: 15, item: "" }), "15% off your bill");
});

test("public-rewards-view: rewardWorth — kind 'flat' renders the rupee amount off the bill via inr()", () => {
  assert.equal(rewardWorth({ kind: "flat", value: 50, item: "" }), "₹50 off your bill");
});

// ── nextRewardLine ───────────────────────────────────────────────────────

test("public-rewards-view: nextRewardLine — empty ladder (card.ladder.length === 0) returns null", () => {
  const card = baseCard({ ladder: [] });
  assert.equal(nextRewardLine(card), null, "an empty ladder must return null — the tab's guided branch speaks instead");
});

test("public-rewards-view: nextRewardLine — rewardsReady === 1 reads '1 reward ready'", () => {
  const card = baseCard({ rewardsReady: 1, ladder: [milestone()] });
  assert.equal(nextRewardLine(card), "1 reward ready");
});

test("public-rewards-view: nextRewardLine — rewardsReady > 1 reads '{n} rewards ready'", () => {
  const card = baseCard({ rewardsReady: 3, ladder: [milestone()] });
  assert.equal(nextRewardLine(card), "3 rewards ready");
});

test("public-rewards-view: nextRewardLine — ladder mode states the next milestone's distance and worth", () => {
  const card = baseCard({
    cyclePosition: 3,
    ladder: [
      milestone({ at: 5, kind: "item", item: "Cookie" }),
      milestone({ at: 10, kind: "flat", value: 50 }),
    ],
  });
  assert.equal(nextRewardLine(card), "2 more stamps to Cookie", "must name the NEXT milestone (at:5), not the last one");
});

test("public-rewards-view: nextRewardLine — ladder mode says 'one more' (not '1 more') when exactly 1 away", () => {
  const card = baseCard({
    cyclePosition: 4,
    ladder: [
      milestone({ at: 5, kind: "item", item: "Cookie" }),
      milestone({ at: 10, kind: "flat", value: 50 }),
    ],
  });
  assert.equal(nextRewardLine(card), "one more stamp to Cookie", "1-away must read 'one more', matching Home's wording");
});

test("public-rewards-view: nextRewardLine — end-of-cycle (no milestone ahead of cyclePosition) falls back to card.reward/toNextReward", () => {
  const card = baseCard({
    cyclePosition: 10,
    toNextReward: 2,
    ladder: [milestone({ at: 5, kind: "item", item: "Cookie" }), milestone({ at: 10, kind: "flat", value: 50 })],
  });
  assert.equal(
    nextRewardLine(card),
    "2 more stamps to ₹50 off your bill",
    "past the last milestone in the cycle, the fallback must use card.toNextReward + card.reward, not throw or return null",
  );
});

test("public-rewards-view: nextRewardLine — flat mode (ladder.length === 1) states toNextReward/card.reward", () => {
  const card = baseCard({ toNextReward: 3, ladder: [milestone({ at: 10, kind: "flat", value: 50 })] });
  assert.equal(nextRewardLine(card), "3 more stamps to ₹50 off your bill");
});

test("public-rewards-view: nextRewardLine — flat mode says 'one more' when toNextReward === 1", () => {
  const card = baseCard({ toNextReward: 1, ladder: [milestone({ at: 10, kind: "flat", value: 50 })] });
  assert.equal(nextRewardLine(card), "one more stamp to ₹50 off your bill");
});

// ── trackGeometry ────────────────────────────────────────────────────────

test("public-rewards-view: trackGeometry — cycleLength <= 0 returns empty geometry, never throws", () => {
  assert.deepEqual(trackGeometry(0, 5, [{ at: 5 }]), { fillPercent: 0, markers: [] });
  assert.doesNotThrow(() => trackGeometry(-1, 5, [{ at: 5 }]));
});

test("public-rewards-view: trackGeometry — fillPercent and marker leftPercent are clamped to [0, 100]", () => {
  const overCycle = trackGeometry(10, 20, [{ at: 5 }]);
  assert.equal(overCycle.fillPercent, 100, "fillPercent must clamp at 100 when position exceeds cycleLength");

  const negativePos = trackGeometry(10, -5, [{ at: 5 }]);
  assert.equal(negativePos.fillPercent, 0, "a negative position must clamp to 0 fill, never a negative percent");

  const nanPos = trackGeometry(10, NaN, [{ at: 5 }]);
  assert.equal(nanPos.fillPercent, 0, "NaN position must read as 0, never propagate NaN into the style width");
});

test("public-rewards-view: trackGeometry — marker.reached is true iff at <= position", () => {
  const { markers } = trackGeometry(10, 5, [{ at: 5 }, { at: 10 }]);
  assert.equal(markers[0].reached, true, "a milestone AT the current position must read as reached");
  assert.equal(markers[1].reached, false, "a milestone past the current position must read as not reached");
});

test("public-rewards-view: trackGeometry — percentages are rounded to 2 decimals", () => {
  const { fillPercent, markers } = trackGeometry(3, 1, [{ at: 1 }, { at: 2 }, { at: 3 }]);
  assert.equal(fillPercent, 33.33, "1/3 of the cycle must round to 33.33, not carry float noise");
  assert.equal(markers[1].leftPercent, 66.67, "2/3 of the cycle must round to 66.67");
});

test("public-rewards-view: trackGeometry — never mutates the milestones input", () => {
  const milestones = [{ at: 5 }, { at: 10 }];
  const snapshot = JSON.stringify(milestones);
  trackGeometry(10, 5, milestones);
  assert.equal(JSON.stringify(milestones), snapshot, "the milestones array/objects must be unchanged after the call");
});

test("public-rewards-view: trackGeometry — zero markers renders the bare track (empty markers array, never throws)", () => {
  assert.doesNotThrow(() => trackGeometry(10, 5, []));
  const { markers, fillPercent } = trackGeometry(10, 5, []);
  assert.deepEqual(markers, []);
  assert.equal(fillPercent, 50);
});

// ── HOW_IT_WORKS_STEPS ───────────────────────────────────────────────────

test("public-rewards-view: HOW_IT_WORKS_STEPS has exactly 3 entries", () => {
  assert.equal(HOW_IT_WORKS_STEPS.length, 3, "the how-it-works strip is a fixed 3-step walkthrough");
});

// F4 (CB-6D-B review fix, MEDIUM) — "Fill the card to unlock a reward" is
// wrong for a ladder cafe where rewards unlock at intermediate rungs, not
// only when the card is full. Fix: step 3's literal changes to "Collect
// enough stamps and a reward unlocks" (true for both flat and ladder mode).
// Still exactly 3 entries, no props/mode branch. RED now: the old literal is
// still in the array.
test("PIN (F4): HOW_IT_WORKS_STEPS step 3 is the mode-agnostic 'Collect enough stamps and a reward unlocks', never the ladder-false 'fill the card' copy", () => {
  assert.equal(HOW_IT_WORKS_STEPS.length, 3, "still exactly 3 steps — no props/mode branch");
  assert.ok(
    !HOW_IT_WORKS_STEPS.some((step) => /fill the card/i.test(step)),
    "no step may claim the card must be FILLED to unlock a reward — false for a ladder cafe with intermediate rungs",
  );
  assert.ok(
    HOW_IT_WORKS_STEPS.includes("Collect enough stamps and a reward unlocks"),
    "step 3 must be the exact mode-agnostic literal, true for both flat and ladder cafes",
  );
});

// ── F1 (CB-6D-B review fix, HIGH) — cardProgress / ladderRungAffordable ────
// Root cause: PublicRewardLadder gated the claim on milestone.at <=
// cyclePosition (the CURRENT cycle) while the server (lib/reward-claim.ts
// decideRedemption / claimRewardStamps `stamps: { $gte: cost }`) decides on
// the customer's TOTAL stamps; and the hero was fed the showFull-adjusted
// `position` while the list was fed the raw card.cyclePosition. Neither
// cardProgress nor ladderRungAffordable exists yet on the current tree, so
// importing them makes this whole dynamic-import block fail to resolve —
// that IS the RED evidence for F1's behaviour contract. Using a dynamic
// import (not a static one) keeps this failure scoped to these two test()
// blocks rather than failing the ENTIRE suite file at load, so every other
// pin in this file still runs (mirrors the STATUS_CHIP_META walk's dynamic
// import style in lib/public-diner-panel-pins.test.ts).

// A DinerStampCard fixture with EVERY field of the interface, reused for the
// cardProgress behaviour pins below (same construction as baseCard() above,
// duplicated locally so this block reads standalone against the dynamic
// import without depending on baseCard's override shape changing later).
function progressCard(overrides: Partial<DinerStampCard> = {}): DinerStampCard {
  return {
    stamps: 0,
    stampsPerReward: 10,
    toNextReward: 4,
    rewardsReady: 0,
    lifetime: 0,
    reward: { kind: "flat", value: 50, item: "" },
    ladder: [],
    cyclePosition: 0,
    reachedThisCycle: 0,
    unitLabel: "stamp",
    ...overrides,
  };
}

test("PIN (F1): cardProgress — a full, ready card (stamps === stampsPerReward, rewardsReady > 0) reads as FULLY filled, not reset to 0", async () => {
  // Mutation caught: cardProgress silently reverting to the raw
  // filled = stamps % stampsPerReward without the showFull override, which
  // would read a just-completed card as 0/12 instead of 12/12.
  const { cardProgress } = await import("@/components/public/public-rewards-view");
  const card = progressCard({ stamps: 12, stampsPerReward: 12, rewardsReady: 1, cyclePosition: 0 });
  assert.deepEqual(cardProgress(card), { filled: 12, position: 12 }, "a completed, ready card must read as full (12/12), not empty (0/12)");
});

test("PIN (F1): cardProgress — mid-cycle on a second card reads the CURRENT cycle's progress, not the lifetime total", async () => {
  const { cardProgress } = await import("@/components/public/public-rewards-view");
  const card = progressCard({ stamps: 14, stampsPerReward: 12, rewardsReady: 1, cyclePosition: 2 });
  assert.deepEqual(cardProgress(card), { filled: 2, position: 2 }, "14 stamps on a 12-stamp card with 1 ready must read 2/12 (this cycle), not 14/12");
});

test("PIN (F1): cardProgress — an unfinished, not-yet-ready card reads the raw filled/position (showFull never triggers)", async () => {
  const { cardProgress } = await import("@/components/public/public-rewards-view");
  const card = progressCard({ stamps: 5, stampsPerReward: 8, rewardsReady: 0, cyclePosition: 5 });
  assert.deepEqual(cardProgress(card), { filled: 5, position: 5 }, "no reward ready yet — filled/position must be the plain in-progress numbers");
});

test("PIN (F1): cardProgress — stampsPerReward === 0 reads filled 0 and position === cyclePosition (never a divide-by-zero)", async () => {
  const { cardProgress } = await import("@/components/public/public-rewards-view");
  const card = progressCard({ stamps: 5, stampsPerReward: 0, rewardsReady: 0, cyclePosition: 3 });
  const result = cardProgress(card);
  assert.equal(result.filled, 0, "stampsPerReward 0 must never divide-by-zero into NaN — filled reads 0");
  assert.equal(result.position, 3, "position falls back to the raw cyclePosition when stampsPerReward is 0");
});

test("PIN (F1): ladderRungAffordable — true when the diner's TOTAL stamps meet or exceed the rung's cost (the server's own $gte test)", async () => {
  const { ladderRungAffordable } = await import("@/components/public/public-rewards-view");
  assert.equal(ladderRungAffordable(12, 12), true, "stamps === at must be affordable — matches the server's stamps: { $gte: cost } test");
  assert.equal(ladderRungAffordable(2, 4), false, "stamps < at must not be affordable");
  assert.equal(ladderRungAffordable(0, 0), true, "0 >= 0 must read affordable — a free/zero-cost rung is always claimable");
});

test("PIN (F1): ladderRungAffordable — a non-finite stamps balance (NaN) must never read as affordable", async () => {
  // Mutation caught: a bare `stamps >= at` without the Number.isFinite guard
  // would let NaN >= 1 evaluate to false by luck for THIS pair, but the
  // contract requires an explicit finiteness gate, not an accident of JS's
  // NaN comparison semantics.
  const { ladderRungAffordable } = await import("@/components/public/public-rewards-view");
  assert.equal(ladderRungAffordable(NaN, 1), false, "a NaN stamps balance must never read as affordable");
});
