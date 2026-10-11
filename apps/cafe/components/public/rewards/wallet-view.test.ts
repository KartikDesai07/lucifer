import { test } from "node:test";
import assert from "node:assert/strict";

import { freezeOpenCard, scratchableCount } from "@/components/public/rewards/wallet-view";
import type { DinerCardDto, DinerCardsData, DinerReadyCardDto } from "@pos/shared/public-diner-cards";

const ISSUED = Date.UTC(2026, 10, 1);
const POOL = [{ kind: "bill-percent" as const, label: "10% off", chance: 100 }];

function ready(id: string, state: "ready" | "expired" = "ready"): DinerReadyCardDto {
  return { id, source: "level", issuedAt: ISSUED, scratchBy: ISSUED + 1, status: "ready", state, pool: POOL };
}

function revealed(id: string, kind: "bill-percent" | "none" = "bill-percent"): DinerCardDto {
  return {
    id,
    source: "level",
    issuedAt: ISSUED,
    scratchBy: ISSUED + 1,
    status: kind === "none" ? "used" : "revealed",
    state: kind === "none" ? "used" : "revealed",
    pool: POOL,
    outcome: { kind, value: 10, label: "10% off the bill", condition: null },
  };
}

function data(cards: DinerCardDto[], earning: boolean): DinerCardsData {
  return { earning, progress: null, ladder: null, cards, pointsBalance: 0 };
}

test("freezeOpenCard: the open card keeps its ready snapshot even after the cache says revealed", () => {
  const snapshot = ready("c2");
  const cards = [ready("c3"), revealed("c2"), ready("c1")];
  const out = freezeOpenCard(cards, snapshot);
  assert.equal(out[1], snapshot);
  assert.equal(out[0], cards[0]);
  assert.equal(out[2], cards[2]);
});

test("freezeOpenCard: a none card the cache already moved to used stays in place while the sheet is open", () => {
  const snapshot = ready("c1");
  const out = freezeOpenCard([revealed("c1", "none")], snapshot);
  assert.deepEqual(out, [snapshot]);
});

test("freezeOpenCard: with no open card (sheet closed) the cache is shown as is", () => {
  const cards = [revealed("c1")];
  assert.equal(freezeOpenCard(cards, null), cards);
});

test("scratchableCount: ready cards count only while the cafe is earning", () => {
  const cards = [ready("a"), ready("b"), ready("old", "expired"), revealed("r")];
  assert.equal(scratchableCount(data(cards, true)), 2);
  assert.equal(scratchableCount(data(cards, false)), 0);
});
