import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cardsLoadCanRetry,
  cardsLoadErrorCopy,
  replaceCard,
  scratchCanRetry,
  scratchErrorCopy,
} from "@/components/public/rewards/use-diner-cards";
import { ApiError } from "@/lib/api-client";
import {
  CARD_NOT_SCRATCHABLE,
  CARDS_LOAD_FAILED,
  CARDS_SIGN_IN,
  SCRATCH_BUSY,
  SCRATCH_OFFLINE,
  SCRATCH_PAUSED,
  type DinerCardDto,
  type DinerCardsData,
} from "@pos/shared/public-diner-cards";

const ISSUED = Date.UTC(2026, 10, 1);
const POOL = [{ kind: "bill-percent" as const, label: "10% off", chance: 100 }];

function ready(id: string): DinerCardDto {
  return { id, source: "level", issuedAt: ISSUED, scratchBy: ISSUED + 1, status: "ready", state: "ready", pool: POOL };
}

function revealed(id: string): DinerCardDto {
  return {
    id,
    source: "level",
    issuedAt: ISSUED,
    scratchBy: ISSUED + 1,
    status: "revealed",
    state: "revealed",
    pool: POOL,
    outcome: { kind: "bill-percent", value: 10, label: "10% off the bill", condition: null },
  };
}

function wallet(cards: DinerCardDto[]): DinerCardsData {
  return { earning: true, progress: null, ladder: null, cards, pointsBalance: 0 };
}

test("replaceCard swaps the card with the same id and keeps the list order", () => {
  const prev = wallet([ready("c3"), ready("c2"), ready("c1")]);
  const next = revealed("c2");
  const out = replaceCard(prev, next);
  assert.ok(out);
  assert.deepEqual(
    out.cards.map((c) => c.id),
    ["c3", "c2", "c1"],
  );
  assert.equal(out.cards[1], next);
  assert.equal(out.cards[0], prev.cards[0]);
  assert.equal(prev.cards[1].status, "ready", "the previous wallet is not mutated");
});

test("replaceCard is a no-op when the card is absent or there is no wallet yet", () => {
  const prev = wallet([ready("c1")]);
  assert.equal(replaceCard(prev, revealed("zz")), prev);
  assert.equal(replaceCard(undefined, revealed("c1")), undefined);
});

test("replaceCard keeps every other wallet field", () => {
  const prev: DinerCardsData = { ...wallet([ready("c1")]), pointsBalance: 40, earning: false };
  const out = replaceCard(prev, revealed("c1"));
  assert.ok(out);
  assert.equal(out.pointsBalance, 40);
  assert.equal(out.earning, false);
});

test("scratchErrorCopy: network and timeout read as offline; 404 not scratchable; 403 paused; the rest busy", () => {
  assert.equal(scratchErrorCopy(new ApiError("x", "network", null)), SCRATCH_OFFLINE);
  assert.equal(scratchErrorCopy(new ApiError("x", "timeout", null)), SCRATCH_OFFLINE);
  assert.equal(scratchErrorCopy(new ApiError("x", "http", 404)), CARD_NOT_SCRATCHABLE);
  assert.equal(scratchErrorCopy(new ApiError("x", "http", 403)), SCRATCH_PAUSED);
  assert.equal(scratchErrorCopy(new ApiError("x", "http", 503)), SCRATCH_BUSY);
  assert.equal(scratchErrorCopy(new ApiError("x", "http", 500)), SCRATCH_BUSY);
  assert.equal(scratchErrorCopy(new Error("boom")), SCRATCH_BUSY);
  assert.equal(scratchErrorCopy(null), SCRATCH_BUSY);
});

test("scratchErrorCopy: a 401 (the diner signed out) asks them to sign in", () => {
  assert.equal(scratchErrorCopy(new ApiError("x", "http", 401)), CARDS_SIGN_IN);
});

test("scratchCanRetry: only a 401 cannot be retried", () => {
  assert.equal(scratchCanRetry(new ApiError("x", "http", 401)), false);
  assert.equal(scratchCanRetry(new ApiError("x", "http", 503)), true);
  assert.equal(scratchCanRetry(new ApiError("x", "network", null)), true);
  assert.equal(scratchCanRetry(null), true);
});

test("cardsLoadErrorCopy / cardsLoadCanRetry: a 401 asks to sign in and cannot be retried; anything else is the load-failed copy and retryable", () => {
  const signedOut = new ApiError("x", "http", 401);
  assert.equal(cardsLoadErrorCopy(signedOut), CARDS_SIGN_IN);
  assert.equal(cardsLoadCanRetry(signedOut), false);
  for (const other of [new ApiError("x", "http", 500), new ApiError("x", "network", null), new Error("boom"), null]) {
    assert.equal(cardsLoadErrorCopy(other), CARDS_LOAD_FAILED);
    assert.equal(cardsLoadCanRetry(other), true);
  }
});
