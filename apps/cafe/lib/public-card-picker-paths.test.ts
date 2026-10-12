import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { buildOrderRequestBody, classifyRewardFailure, isRewardErrorMessage } from "@/components/public/public-submit";
import { usableCards } from "@/components/public/rewards/usable-cards";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import {
  CARD_BILL_TOO_SMALL,
  CARD_NEEDS_SIGN_IN,
  CARD_NOT_USABLE,
  CARD_NOTHING_TO_DISCOUNT,
  CARD_REWARD_EXCLUSIVE,
  REWARD_CARD_USE_KINDS,
} from "@pos/shared/reward-card-use";
import { REWARD_OPTION_KINDS } from "@pos/shared/reward-levels";
import type { DinerCardDto, DinerRevealedCardDto } from "@pos/shared/public-diner-cards";

// CB-7 S5 slice F — the diner's cart picker for a revealed scratch card. Source pins read the real files (comments
// stripped, so a commented-out call site cannot satisfy them) plus behavioural checks on the pure pieces.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, "apps/cafe", rel), "utf8"));

const STORE = "components/public/public-cart-store.ts";
const SUBMIT = "components/public/public-submit.ts";
const HOOK = "components/public/use-public-cart-submit.ts";
const CART = "components/public/PublicCart.tsx";
const FLOW = "components/public/PublicOrderFlow.tsx";
const SHELL = "components/public/PublicDinerShell.tsx";
const PICKER = "components/public/rewards/PublicCardPicker.tsx";

const CARD_ID = "0123456789ab";

function body(over: { requestedRewardAt: number | null; requestedCardId?: string | null }) {
  return buildOrderRequestBody({
    target: { kind: "parcel" },
    cart: [],
    note: "",
    promoCode: null,
    name: "Asha",
    mobile: "9876543210",
    ...over,
  });
}

function revealed(
  id: string,
  kind: DinerRevealedCardDto["outcome"]["kind"],
  state: DinerRevealedCardDto["state"],
): DinerRevealedCardDto {
  return {
    id,
    source: "level",
    issuedAt: 0,
    scratchBy: 0,
    status: state === "used" ? "used" : "revealed",
    state,
    pool: [],
    validUntil: 1,
    outcome: { kind, value: 10, label: "x", condition: null },
  };
}

test("store: the card pick shares the ONE reward key with the stamp rung, stored as {card} behind a guard", () => {
  const src = read(STORE);
  assert.match(src, /readRequestedCardId\(\): string \| null/);
  assert.match(src, /safeRead\(REQUESTED_REWARD_KEY, isCardPick\)/, "the card read goes through the 12-hex guard");
  assert.match(src, /safeWrite\(REQUESTED_REWARD_KEY, \{ card: cardId \}\)/, "the card write uses the shared key");
  assert.match(
    src,
    /safeRead\(REQUESTED_REWARD_KEY, \(v\): v is number => typeof v === "number"\)/,
    "a stored number still reads as a rung",
  );
  assert.equal((src.match(/"pos\.public\.reward\.v1"/g) ?? []).length, 1, "exactly one reward key literal");
});

test("store: sign-out and submit clear the reward key (a signed-out diner's card never rides the next order)", () => {
  const src = read(STORE);
  const clearCart = src.slice(src.indexOf("export function clearCart"), src.indexOf("export function readIdentity"));
  assert.match(clearCart, /clearRequestedRewardAt\(\)/, "a submit (clearCart) clears the pick");
  const clearDiner = src.slice(src.indexOf("export function clearDinerData"));
  assert.match(clearDiner, /clearRequestedRewardAt\(\)/, "sign-out (clearDinerData) clears the pick");
  const clearFn = src.slice(
    src.indexOf("export function clearRequestedRewardAt"),
    src.indexOf("export function readAppliedPromoCode"),
  );
  assert.match(clearFn, /safeRemove\(REQUESTED_REWARD_KEY\)/);
  assert.match(read(SHELL), /clearDinerData\(\)/, "the shell's signOut still calls clearDinerData");
  assert.match(read(HOOK), /clearCart\(\)/, "the submit path still clears the cart");
});

test("submit: a picked card sends requestedCardId and never also requestedRewardAt", () => {
  const withCard = body({ requestedRewardAt: 5, requestedCardId: CARD_ID });
  assert.equal(withCard.requestedCardId, CARD_ID);
  assert.equal(withCard.requestedRewardAt, undefined, "both intents must never ride one submit");
  const stampOnly = body({ requestedRewardAt: 5 });
  assert.equal(stampOnly.requestedRewardAt, 5);
  assert.ok(!("requestedCardId" in stampOnly), "no card key when no card is picked");
  const none = body({ requestedRewardAt: null, requestedCardId: null });
  assert.equal(none.requestedRewardAt, undefined);
  assert.ok(!("requestedCardId" in none));
  assert.match(read(SUBMIT), /requestedRewardAt: cardPicked \? undefined/, "source: the stamp intent is dropped");
});

test("submit: every card refusal (and the promo / exclusive ones) is a reward error that drops the pick", () => {
  const refusals = [
    CARD_NOT_USABLE,
    CARD_BILL_TOO_SMALL,
    CARD_NOTHING_TO_DISCOUNT,
    CARD_NEEDS_SIGN_IN,
    CARD_REWARD_EXCLUSIVE,
    PROMO_BLOCKS_REWARD,
  ];
  assert.equal(new Set(refusals).size, refusals.length, "landmark: six distinct refusal strings");
  for (const message of refusals) {
    assert.ok(isRewardErrorMessage(message), message);
    assert.equal(classifyRewardFailure(422, CARD_ID, message), message, "a card id counts as a sent reward");
  }
  assert.equal(classifyRewardFailure(422, null, CARD_NOT_USABLE), null, "no reward sent -> not a reward failure");
  assert.equal(classifyRewardFailure(400, CARD_ID, CARD_NOT_USABLE), null, "only a 422 is classified");
  assert.ok(!isRewardErrorMessage("The menu just changed"), "unrelated copy is not a reward error");
  const hook = read(HOOK);
  assert.match(hook, /requestedCardId \?\? requestedRewardAt/, "the classifier is told about a card pick");
  const failBranch = hook.slice(hook.indexOf("if (rewardFailure !== null)"), hook.indexOf("setRewardError(rewardFailure)"));
  assert.match(failBranch, /setRequestedCardId\(null\)/, "a refused card is dropped from state");
  assert.match(failBranch, /clearRequestedRewardAt\(\)/, "and from storage");
});

test("hook: the pick is re-read when the drawer opens, sent in the body, and picking writes the shared key", () => {
  const hook = read(HOOK);
  assert.match(hook, /setRequestedCardId\(readRequestedCardId\(\)\)/);
  assert.match(hook, /writeRequestedCardId\(cardId\)/);
  assert.match(hook, /requestedRewardAt,\s*requestedCardId,\s*\}\)/, "buildOrderRequestBody receives both");
});

test("picker: lists only usable cards - revealed AND a spendable kind (isCardUseKind) - with no fetch of its own", () => {
  const cards: DinerCardDto[] = [
    ...REWARD_OPTION_KINDS.map((kind) => revealed(`r-${kind}`, kind, "revealed")),
    revealed("used", "bill-percent", "used"),
    revealed("expired", "bill-flat", "expired"),
  ];
  const ids = usableCards(cards).map((c) => c.id);
  assert.deepEqual(
    [...ids].sort(),
    REWARD_CARD_USE_KINDS.map((k) => `r-${k}`).sort(),
  );
  assert.ok(ids.length > 0 && !ids.includes("r-points") && !ids.includes("r-none"), "points / none never offered");
  const ready: DinerCardDto = {
    id: "rd",
    source: "level",
    issuedAt: 0,
    scratchBy: 0,
    status: "ready",
    state: "ready",
    pool: [],
  };
  assert.deepEqual(usableCards([ready]), []);
  assert.match(read("components/public/rewards/usable-cards.ts"), /isCardUseKind\(card\.outcome\.kind\)/);
  const picker = read(PICKER);
  assert.match(picker, /usableCards\(/);
  assert.match(picker, /useDinerCards\(identity\)/, "reuses the wallet query");
  assert.ok(!/apiGet|useQuery\(|fetch\(/.test(picker), "the picker adds no fetch of its own");
  assert.match(picker, /if \(cards\.length === 0\) return null/, "renders nothing without a usable card");
  assert.match(picker, /onSelect\(selected \? null : card\.id\)/, "tap again un-picks");
  assert.match(picker, /min-h-11/, "44px touch target");
  assert.ok(!/<select|<input|type="date"/.test(picker), "no native pickers");
});

test("cart: the picker shows only while the promo control does, never beside an applied promo or a stamp pick", () => {
  const cart = read(CART);
  assert.match(cart, /chargeApplies && !promoCode && requestedRewardAt === null && \(\s*<PublicCardPicker/);
  assert.match(cart, /requestedRewardAt !== null \|\| requestedCardId !== null/, "a picked card shows the selected row");
  assert.match(cart, /cardsIdentity = null/);
  assert.match(cart, /identity=\{cardsIdentity\}/);
});

test("reachability: shell -> flow -> cart pass cardsIdentity, null when cards are off", () => {
  const shell = readFileSync(path.join(REPO_ROOT, "apps/cafe", SHELL), "utf8");
  assert.match(stripComments(shell), /cardsIdentity=\{cardsOn \? \(diner\?\.mobile \?\? null\) : null\}/);
  assert.match(read(FLOW), /cardsIdentity=\{cardsIdentity\}/);
  assert.match(read(FLOW), /cardsIdentity\?: string \| null/);
  assert.ok(shell.split("\n").length <= 301, "PublicDinerShell stays within 300 lines");
});
