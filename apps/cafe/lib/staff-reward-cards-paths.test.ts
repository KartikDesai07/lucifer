import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  REWARD_SCOPE_PRODUCTS_MAX,
  STAFF_REWARD_CARD_KEYS,
  cardRedeemedReward,
  staffCardReward,
  type StaffRewardCard,
} from "@pos/shared/reward-card-use";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import { rewardDiscountAmount } from "./reward-discount";
import { cardOffers } from "./reward-card-offers";
import { staffCardCategoryIds, staffCardsOf } from "./reward-cards-staff";
import { stripComments } from "./source-pin-utils";

// CB-7 S5 Slice E: the staff POS card picker. Behaviour tests for the allowlist builder and the client verdicts, plus
// source pins over the route / hook / cart wiring. Every source pin runs on the real file AND on mutated copies it must
// reject; negatives carry a positive landmark. Needles that would match this file's own text are concatenated.

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

const [ROUTE, HOOK, TAB, TOTALS] = ["app/api/customers/[id]/rewards/route.ts", "hooks/use-customer-rewards.ts", "hooks/use-pos-tab.ts", "hooks/use-pos-totals.ts"];
const [CART, CART_CARDS, CART_REWARD] = ["components/pos/Cart.tsx", "components/pos/CartRewardCards.tsx", "components/pos/CartReward.tsx"];
const [PROPS, OFFERS, STAFF_LIB] = ["lib/pos-cart-props.ts", "lib/reward-card-offers.ts", "lib/reward-cards-staff.ts"];

type Pin = (src: string) => boolean;
function pinned(label: string, src: string, pin: Pin, ...mutations: Array<(s: string) => string>): void {
  assert.ok(pin(src), `${label}: holds on the real source`);
  mutations.forEach((mutate, i) => {
    const mutated = mutate(src);
    assert.notEqual(mutated, src, `${label}: mutation ${i} changes the text`);
    assert.ok(!pin(mutated), `${label}: mutation ${i} is caught`);
  });
}
const swap = (from: string, to: string) => (s: string) => s.replace(from, to);
const sliceFrom = (s: string, start: string, end: string): string => {
  const a = s.indexOf(start);
  assert.ok(a >= 0, `landmark: ${start}`);
  const b = s.indexOf(end, a);
  assert.ok(b > a, `landmark: ${end}`);
  return s.slice(a, b);
};

// ── fixtures ──
const NOW = new Date("2026-10-12T06:00:00.000Z");
const LATER = new Date(NOW.getTime() + 3 * 86_400_000);
function card(over: Partial<RewardCardSnapshot> & Pick<RewardCardSnapshot, "id" | "kind">): RewardCardSnapshot {
  return {
    issueKey: "step:1", source: "level", optionId: "opt-secret", value: 20, useDays: 7, orderId: "ORD-SECRET",
    pool: [{ kind: "none", weight: 1, label: "Better luck" }],
    issuedAt: NOW, scratchBy: LATER, keepUntil: LATER, status: "revealed", revealedAt: NOW, validUntil: LATER,
    ...over,
  };
}
const WALLET: RewardCardSnapshot[] = [
  card({ id: "aaaaaaaaaaaa", kind: "bill-percent", value: 10, minBill: 300, capRupees: 50 }),
  card({ id: "bbbbbbbbbbbb", kind: "product-percent", productId: "p1", productName: "Cold Coffee" }),
  card({ id: "cccccccccccc", kind: "category-percent", categoryId: "c1", categoryName: "Shakes" }),
  card({ id: "dddddddddddd", kind: "free-item", productId: "p2", productName: "Brownie", qty: 2, value: 0 }),
  card({ id: "eeeeeeeeeeee", kind: "bill-flat", status: "ready" }), card({ id: "ffffffffffff", kind: "bill-flat", status: "used" }),
  card({ id: "111111111111", kind: "bill-flat", validUntil: new Date(NOW.getTime() - 1) }),
  card({ id: "222222222222", kind: "points" }), card({ id: "333333333333", kind: "none", value: 0 }),
];
const SCOPES = new Map<string, string[]>([["c1", ["p1", "p3"]]]);

test("staffCardsOf: only revealed, unexpired money cards, key by key from the allowlist", () => {
  const cards = staffCardsOf(WALLET, SCOPES, NOW);
  assert.deepEqual(cards.map((c) => c.id).sort(), ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd"]);
  const allowed = new Set<string>(STAFF_REWARD_CARD_KEYS);
  for (const c of cards) {
    for (const key of Object.keys(c)) assert.ok(allowed.has(key), `${c.id}: ${key} is on the staff allowlist`);
    const wire = JSON.stringify(c);
    for (const secret of ["opt-secret", "ORD-SECRET", "step:1", "orderId", "issueKey", "optionId", "pool", "usedAt"]) {
      assert.ok(!wire.includes(secret), `${c.id}: ${secret} never reaches the counter`);
    }
  }
  const pct = cards.find((c) => c.id === "aaaaaaaaaaaa");
  assert.equal(pct?.minBill, 300);
  assert.equal(pct?.capRupees, 50);
  assert.match(pct?.label ?? "", /10%/);
  assert.ok((pct?.condition ?? "").includes("300") && (pct?.condition ?? "").includes("50"));
  assert.equal(pct?.validUntil, LATER.getTime());
  assert.deepEqual(cards.find((c) => c.id === "cccccccccccc")?.scopeProductIds, ["p1", "p3"]);
  assert.equal(cards.find((c) => c.id === "bbbbbbbbbbbb")?.scopeProductIds, undefined, "only category cards carry a scope");
  assert.equal(cards.find((c) => c.id === "dddddddddddd")?.qty, 2);
});

test("staffCardsOf: soonest use-by first, a category past the claim ceiling is dropped, the deadline instant still lists", () => {
  const soon = new Date(NOW.getTime() + 1000);
  const sorted = staffCardsOf([WALLET[0], card({ id: "999999999999", kind: "bill-flat", validUntil: soon })], SCOPES, NOW);
  assert.deepEqual(sorted.map((c) => c.id), ["999999999999", "aaaaaaaaaaaa"]);
  const many = Array.from({ length: REWARD_SCOPE_PRODUCTS_MAX + 1 }, (_, i) => `p${i}`);
  assert.deepEqual(staffCardsOf([WALLET[2]], new Map([["c1", many]]), NOW), [], "the server would refuse it, so it is not offered");
  assert.equal(staffCardsOf([WALLET[2]], new Map(), NOW)[0]?.scopeProductIds?.length, 0, "unknown category = empty scope");
  const atDeadline = card({ id: "888888888888", kind: "bill-flat", validUntil: NOW });
  assert.equal(staffCardsOf([atDeadline], SCOPES, NOW).length, 1, "strict >: the deadline instant is still usable");
  assert.deepEqual(staffCardCategoryIds(WALLET, NOW), ["c1"], "only usable category cards ask for a product scope");
});

test("cardOffers: the client verdict mirrors the claim gates (use-by, minimum bill, nothing to discount)", () => {
  const cards = staffCardsOf(WALLET, SCOPES, NOW);
  const lines = [{ price: 100, qty: 2, productId: "p1" }];
  const byId = (bill: number, ls: typeof lines, now = NOW.getTime()) =>
    new Map(cardOffers(cards, bill, ls, now).map((o) => [o.card.id, o]));
  const ok = byId(200, lines);
  assert.equal(ok.get("aaaaaaaaaaaa")?.usable, false, "minBill 300 on a 200 bill");
  assert.match(ok.get("aaaaaaaaaaaa")?.reason ?? "", /too small/i);
  assert.equal(ok.get("bbbbbbbbbbbb")?.usable, true);
  assert.equal(ok.get("cccccccccccc")?.usable, true);
  assert.equal(byId(300, lines).get("aaaaaaaaaaaa")?.usable, true, "minBill is inclusive");
  const none = byId(200, [{ price: 100, qty: 2, productId: "p9" }]);
  assert.equal(none.get("bbbbbbbbbbbb")?.usable, false, "a product card with no such dish on the bill");
  assert.match(none.get("bbbbbbbbbbbb")?.reason ?? "", /nothing on this bill/i);
  assert.equal(none.get("cccccccccccc")?.usable, false);
  assert.equal(none.get("dddddddddddd")?.usable, true, "a free dish needs no matching line");
  assert.equal(byId(200, lines, LATER.getTime() + 1).get("bbbbbbbbbbbb")?.usable, false, "past its use-by");
  const nan = cardOffers(cards, Number.NaN, lines, NOW.getTime()).find((o) => o.card.id === "aaaaaaaaaaaa");
  assert.equal(nan?.usable, false, "a corrupt bill total never makes a minimum look met");
});

test("preview == server pipeline: staffCardReward over the staff row prices exactly like cardRedeemedReward over the stored card", () => {
  const lines = [
    { price: 120, qty: 1, productId: "p1" },
    { price: 80, qty: 1, productId: "p1" },
    { price: 50, qty: 2, productId: "p3" },
    { price: 40, qty: 1, productId: "p7" },
  ];
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  for (const stored of WALLET.slice(0, 4)) {
    const staff = staffCardsOf([stored], SCOPES, NOW)[0] as StaffRewardCard;
    const preview = rewardDiscountAmount(subtotal, staffCardReward(staff) ?? undefined, lines);
    const server = rewardDiscountAmount(subtotal, cardRedeemedReward(stored, SCOPES.get(stored.categoryId ?? "")) ?? undefined, lines);
    assert.equal(preview, server, `${stored.kind}: one builder, one function`);
  }
  const product = staffCardsOf([WALLET[1]], SCOPES, NOW)[0] as StaffRewardCard;
  assert.equal(rewardDiscountAmount(subtotal, staffCardReward(product) ?? undefined, lines), 24, "20% of the DEAREST p1 unit (120)");
  const cat = staffCardsOf([WALLET[2]], SCOPES, NOW)[0] as StaffRewardCard;
  assert.equal(rewardDiscountAmount(subtotal, staffCardReward(cat) ?? undefined, lines), 60, "20% of p1 + p3 lines (300)");
});

// ── route ──
test("PIN: the rewards route lists cards only behind dinerAccountsOn, through the allowlist builder and the holder-file reader", () => {
  const src = code(ROUTE);
  const pin: Pin = (s) => {
    const body = sliceFrom(s, "async function loadStaffCards(", "export async function GET");
    const gate = body.indexOf("if (!dinerAccountsOn(settings)) return [];");
    const read = body.indexOf("readWalletCardsOf(customerId)");
    return (
      gate >= 0 && read > gate && body.includes("staffCardsOf(wallet, scopeByCategory, now)") &&
      /Product\.find\(\{ categoryId: \{ \$in: categoryIds \} \}\)\.select\("_id categoryId"\)\.lean\(\)/.test(body) &&
      (body.match(/Product\.find\(/g) ?? []).length === 1 &&
      /const cards = await loadStaffCards\(id, settings\);\s*const response: CustomerRewardsResponse = \{ stamps, rungs, cards \};/.test(s) &&
      /cards: StaffRewardCard\[\];/.test(s) && !s.includes("+reward" + "Cards")
    );
  };
  pinned(
    ROUTE, src, pin,
    swap("if (!dinerAccountsOn(settings)) return [];", ""), swap("readWalletCardsOf(customerId)", "readCardsRaw(customerId)"),
    swap("staffCardsOf(wallet, scopeByCategory, now)", "wallet"), swap(".select(\"_id categoryId\")", ""),
    swap("{ stamps, rungs, cards }", "{ stamps, rungs }"), (s) => `${s}\nconst leak = "+reward" + "Cards"; const raw = "${"+reward" + "Cards"}";`,
  );
});

test("PIN: the staff builder never spreads a stored card and is client-isolated from the IO files", () => {
  const src = code(STAFF_LIB);
  const pin: Pin = (s) => s.includes("cardUsableAt(card, now)") && s.includes("isCardUseKind(card.kind)") && !/\.\.\.card\b/.test(s) && !s.includes("pool");
  pinned(STAFF_LIB, src, pin, (s) => s.split("cardUsableAt(card, now)").join("true"), (s) => s.replace("return {", "return { ...card,"), (s) => `${s}\nconst x = card.pool;`);
});

// ── hook ──
test("PIN: a card is never auto-armed, and picking a card and picking a rung exclude each other", () => {
  const src = code(HOOK);
  const pin: Pin = (s) => {
    const effect = sliceFrom(s, "useEffect(", "}, [rewardOffers");
    const pickCard = sliceFrom(s, "const onSelectCard = (", "\n  };");
    const pickRung = sliceFrom(s, "const onSelectReward = (", "\n  };");
    return (
      !/cardPick|setCardPick|onSelectCard|pickedOffer/.test(effect) &&
      /autoPickedRef\.current = true;/.test(pickCard) && /setRewardAt\(null\);/.test(pickCard) &&
      /setCardPick\(null\);/.test(pickRung) && /if \(blocked\) return;/.test(pickRung) &&
      pickCard.includes("if (blocked) return;") && pickCard.indexOf("if (blocked) return;") < pickCard.indexOf("setCardPick(")
    );
  };
  pinned(
    HOOK, src, pin,
    swap("autoPickedRef.current = true;\n    if (id !== null)", "if (id !== null)"),
    swap("      setRewardAt(null);\n    }\n    setCardPick(", "    }\n    setCardPick("),
    swap("      setDiscountUnit(\"₹\");\n      setCardPick(null);", "      setDiscountUnit(\"₹\");"),
    swap("const onSelectCard = (id: string | null) => {", "const onSelectCard = (id: string | null) => {\n    setCardPick({ id, tabKey: null });"),
  );
});

test("PIN: P2 + F6 — a promo on the bill (a resumed tab's marker OR a code typed on the cart) blocks both pickers, the stamp auto-default and the GST preset", () => {
  const src = code(HOOK);
  const pin: Pin = (s) => {
    const effect = sliceFrom(s, "useEffect(", "}, [rewardOffers");
    return (
      s.includes("const promoLocked = resumedOrder?.promoCode !== undefined || promoCode !== null;") &&
      /^  promoCode: string \| null,$/m.test(sliceFrom(s, "export function useRewardSelection(", "): RewardSelection")) &&
      s.includes("const blocked = locked || promoLocked || noRound;") &&
      s.includes("const locked = resumedOrder ? hasOrderReward(resumedOrder) : false;") &&
      /if \(blocked\) return;/.test(effect) &&
      s.includes("rewardBlockedReason: promoLocked ? PROMO_BLOCKS_REWARD : noRound ? REWARD_NEEDS_NEW_ITEMS : null,") &&
      s.includes("pendingCardId: blocked || manualDiscountActive ? undefined : pickedOffer?.card.id,") &&
      s.includes("staffCardReward(pickedOffer.card)") &&
      /from "@pos\/shared\/public-promo"/.test(s)
    );
  };
  pinned(
    HOOK, src, pin,
    swap("resumedOrder?.promoCode !== undefined", "false"), swap(" || promoCode !== null;", ";"),
    swap("promoCode !== null;", "false;"), swap("  promoCode: string | null,", "  promoCodeX: string | null,"),
    swap("const blocked = locked || promoLocked || noRound;", "const blocked = locked || noRound;"),
    swap("hasOrderReward(resumedOrder)", "(resumedOrder.rewardAt !== undefined)"), swap("pendingCardId: blocked ||", "pendingCardId:"),
    swap("promoLocked ? PROMO_BLOCKS_REWARD : noRound", "noRound"), swap("staffCardReward(pickedOffer.card)", "undefined"),
  );
});

test("PIN: F6 — use-pos-tab hands the cart's own promo code to the reward selection, and the GST button reads the one resulting flag", () => {
  const tab = code(TAB);
  const call = sliceFrom(tab, "const reward = useRewardSelection(", ");");
  assert.ok(tab.includes("const [promoCode, setPromoCode] = useState<string | null>(null);"), "landmark: the cart's promo state");
  pinned("call site", call, (s) => /setDiscountUnit, cart, promoCode,/.test(s), swap("cart, promoCode,", "cart,"));
  // The flag the pickers and the GST button share is the hook's single `promoLocked`, so a fresh cart's code reaches both.
  assert.match(code(PROPS), /promoLocked: pos\.promoLocked,/, "the flag reaches the Cart");
  assert.match(code(HOOK), /rewardBlockedReason: promoLocked \? PROMO_BLOCKS_REWARD : noRound \? REWARD_NEEDS_NEW_ITEMS : null,\s*promoLocked,/, "one flag drives the reason and the Cart");
});

// ── payload + preview ──
test("PIN: rewardCardId rides the create and add-round payloads only — never settle", () => {
  const src = code(TAB);
  const pin: Pin = (s) => {
    const create = sliceFrom(s, "const buildCreatePayload = (", "...overrides,");
    const round = sliceFrom(s, "const round = resumedOrder", "const create = buildCreatePayload");
    const settle = sliceFrom(s, "const settlePayload = (", "\n  });");
    return create.includes("rewardCardId: reward.pendingCardId,") && round.includes("rewardCardId: reward.pendingCardId") && !settle.includes("rewardCardId") && settle.length > 40;
  };
  pinned(
    TAB, src, pin,
    swap("rewardCardId: reward.pendingCardId,", "rewardCardId: undefined,"),
    swap("rewardAt: reward.pendingRewardAt, rewardCardId: reward.pendingCardId }", "rewardAt: reward.pendingRewardAt }"),
    swap("splitOnline: result.splitOnline,", "splitOnline: result.splitOnline, rewardCardId: reward.pendingCardId,"),
  );
});

test("PIN: the preview prices with the cart lines through the shared rewardDiscountAmount (3 args)", () => {
  const totals = code(TOTALS);
  pinned(TOTALS, totals, (s) => s.includes("rewardDiscountAmount(subtotal, reward, lines)") && /lines\?: readonly RewardBaseLine\[\];/.test(s) && /\[discountRaw, discountUnit, subtotal, gstCfg, reward, lines\]/.test(s),
    swap("rewardDiscountAmount(subtotal, reward, lines)", "rewardDiscountAmount(subtotal, reward)"), swap("reward, lines]", "reward]"));
  const tab = code(TAB);
  pinned(TAB, tab, (s) => /setDiscountUnit, cart, promoCode,\s*\)/.test(s) && /reward: reward\.selectedReward,\s*lines: cart,/.test(s),
    swap("setDiscountUnit, cart, promoCode,", "setDiscountUnit, promoCode,"), swap("cart, promoCode,", "cart,"), swap("lines: cart,", ""));
  assert.ok(code(HOOK).includes("staffCardReward("), "the picked card is priced through the shared builder");
});

// ── cart ──
test("PIN: O2 — the GST button is disabled on a promo tab unless the preset is already on, with the plain hint", () => {
  const src = code(CART);
  const pin: Pin = (s) =>
    /disabled=\{items\.length === 0 \|\| \(\(rewardLocked \|\| promoLocked\) && !gstActive\)\}/.test(s) &&
    /\{canGstDiscount && \(rewardLocked \|\| promoLocked\) && \(/.test(s) &&
    s.includes("PROMO_BLOCKS_GST_DISCOUNT_MESSAGE") && s.includes("promoLocked = false,") &&
    /rewardActive=\{selectedRewardAt !== null \|\| selectedCardId !== null\}/.test(s);
  pinned(
    CART, src, pin,
    swap("((rewardLocked || promoLocked) && !gstActive)", "(rewardLocked && !gstActive)"),
    swap("((rewardLocked || promoLocked) && !gstActive)", "(rewardLocked || promoLocked)"),
    swap("(rewardLocked || promoLocked) && (", "rewardLocked && ("),
    swap("selectedRewardAt !== null || selectedCardId !== null}", "selectedRewardAt !== null}"),
  );
  assert.match(code(PROPS), /promoLocked: pos\.promoLocked,/, "the flag reaches the Cart");
});

test("PIN: the card props flow hook -> pos-cart-props -> Cart -> CartReward, and a picked card counts as a pending adjustment", () => {
  const props = code(PROPS);
  const pin: Pin = (s) =>
    ["cardOffers: pos.cardOffers,", "selectedCardId: pos.selectedCardId,", "onSelectCard: pos.onSelectCard,", "rewardBlockedReason: pos.rewardBlockedReason,"].every((n) => s.includes(n)) &&
    /input\.selectedCardId != null/.test(sliceFrom(s, "return (", "\n  );"));
  pinned(PROPS, props, pin, swap("selectedCardId: pos.selectedCardId,", ""), swap("input.selectedCardId != null ||", ""));
  const cart = code(CART);
  assert.ok(cart.includes("cards={{ offers: cardOffers, selectedId: selectedCardId") && cart.includes("blockedReason={rewardBlockedReason}"), "Cart hands both to CartReward");
  const reward = code(CART_REWARD);
  assert.ok(/blockedReason !== null \?/.test(reward) && reward.includes("<CartRewardCards {...cards}"), "CartReward shows the hint and the list");
});

test("PIN: card rows are whole-row 44px buttons whose handler refuses an unusable card; no native pickers", () => {
  const src = code(CART_CARDS);
  const pin: Pin = (s) =>
    s.includes("min-h-11") && /if \(!usable\) return;/.test(sliceFrom(s, "const handleClick = () => {", "\n  };")) &&
    /disabled=\{disabled \|\| !usable\}/.test(s) && /aria-pressed=\{selected\}/.test(s) && s.includes('deadlineLine("use"') &&
    !/<select|type="date"|type="time"|<datalist/.test(s);
  pinned(CART_CARDS, src, pin, swap("min-h-11", "min-h-8"), swap("if (!usable) return;", ""), (s) => `${s}\nconst x = <select />;`, swap('deadlineLine("use"', 'deadlineLine("scratch"'));
});

test("PIN: no Mongoose model, DB, or server-only card lib is value-imported into a client file this slice touched", () => {
  const client = [HOOK, TOTALS, TAB, CART, CART_CARDS, CART_REWARD, PROPS, OFFERS];
  const banned = /from "(?:mongoose|@\/models\/[^"]*|@\/lib\/db|@\/lib\/reward-cards-read|@\/lib\/reward-cards-staff|@\/lib\/reward-card-claim|@\/lib\/reward-claim)"/;
  for (const rel of client) {
    const src = code(rel);
    assert.ok(src.length > 500, `landmark: ${rel} was read`);
    assert.ok(!banned.test(src), `${rel}: stays client-safe`);
    assert.ok(banned.test(`${src}\nimport { Customer } from "@/models/Customer";`), "mutation: a model import is caught");
  }
});
