import { test } from "node:test";
import assert from "node:assert/strict";

import { cardDetailView } from "@/components/public/rewards/card-detail-view";
import { deadlineLine } from "@/components/public/rewards/reward-clock";
import { POINTS_EXPIRE_RULE } from "@pos/shared/reward-points";
import { CARD_TERMS, POINTS_RULE, type DinerPoolChoice, type DinerRevealedCardDto } from "@pos/shared/public-diner-cards";

const NOW = Date.UTC(2026, 10, 1);
const UNTIL = NOW + 3 * 24 * 60 * 60 * 1000;

const POOL: DinerPoolChoice[] = [
  { kind: "bill-percent", label: "10% off", chance: 60 },
  { kind: "points", label: "50 points", chance: 40 },
];

function card(over: Partial<DinerRevealedCardDto>): DinerRevealedCardDto {
  return {
    id: "0123456789ab",
    source: "level",
    issuedAt: NOW,
    scratchBy: NOW + 1,
    status: "revealed",
    state: "revealed",
    pool: POOL,
    validUntil: UNTIL,
    outcome: { kind: "bill-percent", value: 10, label: "10% off the bill", condition: "On bills over 200" },
    ...over,
  };
}

test("a plain card: title, condition, use-by line and only the general terms", () => {
  const view = cardDetailView(card({}), NOW);
  assert.equal(view.title, "10% off the bill");
  assert.equal(view.condition, "On bills over 200");
  assert.equal(view.useBy, deadlineLine("use", UNTIL, NOW));
  assert.ok(view.useBy !== null && view.useBy.startsWith("Use by"), "landmark: the use-by wording");
  assert.equal(view.pointsLeft, null);
  assert.deepEqual(view.terms, [CARD_TERMS]);
});

test("a points card adds points left and the two points rules", () => {
  const view = cardDetailView(
    card({ outcome: { kind: "points", value: 50, label: "50 points", condition: null, pointsLeft: 30 } }),
    NOW,
  );
  assert.equal(view.pointsLeft, "30 points left");
  assert.equal(view.condition, null);
  assert.deepEqual(view.terms, [CARD_TERMS, POINTS_RULE, POINTS_EXPIRE_RULE]);
});

test("a pool with a none choice is not every-card-wins; one without is", () => {
  const withNone = cardDetailView(card({ pool: [...POOL, { kind: "none", label: "Better luck next time", chance: 10 }] }), NOW);
  assert.equal(withNone.everyCardWins, false);
  assert.equal(cardDetailView(card({}), NOW).everyCardWins, true);
});

test("no validUntil means no use-by line", () => {
  assert.equal(cardDetailView(card({ validUntil: undefined }), NOW).useBy, null);
});

test("the chances are passed through in order", () => {
  assert.deepEqual(cardDetailView(card({}), NOW).chances, POOL);
});
