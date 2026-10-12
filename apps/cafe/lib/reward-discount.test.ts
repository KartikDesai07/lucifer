import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import { stripComments } from "@/lib/source-pin-utils";
import { PROMO_BLOCKS_GST_DISCOUNT_MESSAGE, promoBlocksDiscountKind, rewardDiscountAmount } from "./reward-discount";
import * as receipt from "./receipt";
import { computeOrderTotals, type GstConfig } from "./receipt";

// CB-7 S5 (§2.6, owner O1 + O2) — the scoped-card money core. Every number below is worked by hand from the rules in
// reward-discount.ts: eligible = non-reward lines whose productId is in scope; maxUnits = the DEAREST units, taken
// across lines by unit price; cap bounds a percent card; a scoped flat never exceeds its base.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = "60a1b2c3d4e5f60718293a4b";
const B = "60a1b2c3d4e5f60718293a4c";
const C = "60a1b2c3d4e5f60718293a4d";
const CARD_ID = "a1b2c3d4e5f6";

const line = (productId: string | undefined, price: number, qty = 1, reward?: boolean) => ({
  ...(productId === undefined ? {} : { productId }),
  price,
  qty,
  ...(reward ? { reward: true } : {}),
});
const sum = (items: ReadonlyArray<{ price: number; qty: number; reward?: boolean }>) =>
  Math.round(items.reduce((s, i) => s + (i.reward ? 0 : i.price * i.qty), 0));
const card = (over: Partial<RedeemedReward>): RedeemedReward => ({
  at: 0,
  kind: "percent",
  value: 20,
  item: "",
  cardId: CARD_ID,
  ...over,
});
const scope = (productIds: string[], maxUnits?: number) => ({
  productIds,
  ...(maxUnits === undefined ? {} : { maxUnits }),
  label: "Scoped",
});

// ── unscoped: byte-for-byte the pre-change formula ─────────────────────────────────────────────────────────────────

test("unscoped: percent / flat / item / absent behave exactly as before (concrete numbers)", () => {
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 20 })), 80);
  assert.equal(rewardDiscountAmount(333, card({ kind: "percent", value: 15 })), 50, "round(49.95)");
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 150 })), 400, "percent clamps at 100");
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: -5 })), 0);
  assert.equal(rewardDiscountAmount(400, card({ kind: "flat", value: 100 })), 100);
  assert.equal(rewardDiscountAmount(400, card({ kind: "flat", value: 1000 })), 1000, "an unscoped flat is NOT clamped here");
  assert.equal(rewardDiscountAmount(400, card({ kind: "flat", value: -10 })), 0);
  assert.equal(rewardDiscountAmount(400, card({ kind: "flat", value: 99.6 })), 100);
  assert.equal(rewardDiscountAmount(400, card({ kind: "item", value: 50 })), 0, "item derives 0 by design");
  assert.equal(rewardDiscountAmount(400, undefined), 0);
  assert.equal(rewardDiscountAmount(0, card({ kind: "flat", value: 100 })), 0);
  assert.equal(rewardDiscountAmount(-5, card({ kind: "percent", value: 20 })), 0);
});

test("unscoped: the third argument is ignored (the lines never change an unscoped answer)", () => {
  const items = [line(A, 100, 2)];
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 20 }), items), 80);
  assert.equal(rewardDiscountAmount(400, card({ kind: "flat", value: 100 }), items), 100);
});

test("unscoped percent card: capRupees bounds it (below and above the cap)", () => {
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 50, capRupees: 150 })), 150, "200 capped to 150");
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 50, capRupees: 250 })), 200, "cap above: unchanged");
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 50, capRupees: 0 })), 0);
  assert.equal(rewardDiscountAmount(400, card({ kind: "percent", value: 50, capRupees: -9 })), 0, "a negative cap is 0, never a credit");
});

// ── scoped percent ─────────────────────────────────────────────────────────────────────────────────────────────────

test("scoped percent: only in-scope lines form the base", () => {
  const items = [line(A, 120), line(B, 180), line(C, 50)];
  assert.equal(rewardDiscountAmount(sum(items), card({ scope: scope([A, B]) }), items), 60, "20% of 300, C excluded");
});

test("O1: maxUnits=1 takes the DEAREST unit across two lines (Rs 120 + Rs 180 -> 20% of 180 = 36)", () => {
  const items = [line(A, 120), line(B, 180)];
  const reward = card({ scope: scope([A, B], 1) });
  assert.equal(rewardDiscountAmount(sum(items), reward, items), 36);
});

test("O1: the dearest-unit answer is independent of line order", () => {
  const forward = [line(A, 120), line(B, 180), line(C, 150)];
  const reverse = [...forward].reverse();
  const reward = card({ scope: scope([A, B, C], 1) });
  assert.equal(rewardDiscountAmount(sum(forward), reward, forward), 36);
  assert.equal(rewardDiscountAmount(sum(reverse), reward, reverse), 36);
});

test("O1: maxUnits spans a qty>1 line, then continues to the next-dearest line", () => {
  const items = [line(A, 100, 3), line(B, 80, 2)];
  // 4 units: 3 x 100 + 1 x 80 = 380; 10% = 38.
  assert.equal(rewardDiscountAmount(sum(items), card({ value: 10, scope: scope([A, B], 4) }), items), 38);
  // 2 units: both from the dearest line = 200; 10% = 20.
  assert.equal(rewardDiscountAmount(sum(items), card({ value: 10, scope: scope([A, B], 2) }), items), 20);
  // more units than exist: every eligible unit = 300 + 160 = 460; 10% = 46.
  assert.equal(rewardDiscountAmount(sum(items), card({ value: 10, scope: scope([A, B], 99) }), items), 46);
});

test("scoped: one product on two separate lines (two rounds) counts as one pool of units", () => {
  const items = [line(A, 100, 1), line(A, 100, 1), line(B, 40)];
  assert.equal(rewardDiscountAmount(sum(items), card({ value: 50, scope: scope([A], 2) }), items), 100, "50% of 200");
  assert.equal(rewardDiscountAmount(sum(items), card({ value: 50, scope: scope([A], 1) }), items), 50, "50% of 100");
});

test("scoped: a reward (free-dish) line is never eligible", () => {
  const items = [line(A, 500, 1, true), line(A, 100, 1), line(B, 40)];
  assert.equal(rewardDiscountAmount(sum(items), card({ scope: scope([A]) }), items), 20, "20% of the SOLD 100 only");
  assert.equal(rewardDiscountAmount(sum(items), card({ scope: scope([A], 1) }), items), 20, "maxUnits skips it too");
});

test("scoped: a line with no productId is not eligible (fails closed to 0)", () => {
  const items = [line(undefined, 200), line(undefined, 100, 2)];
  assert.equal(rewardDiscountAmount(sum(items), card({ scope: scope([A, B]) }), items), 0);
  assert.equal(rewardDiscountAmount(sum(items), card({ kind: "flat", value: 50, scope: scope([A]) }), items), 0);
  const nulled = [{ productId: null, price: 200, qty: 1 }];
  assert.equal(rewardDiscountAmount(200, card({ scope: scope([A, "null"]) }), nulled), 0, "a null id never matches, even a scope id spelled null");
});

test("scoped: zero eligible lines -> 0, and no lines passed at all -> 0 (never the whole subtotal)", () => {
  const items = [line(C, 300)];
  assert.equal(rewardDiscountAmount(300, card({ scope: scope([A, B]) }), items), 0);
  assert.equal(rewardDiscountAmount(300, card({ scope: scope([A, B]) })), 0, "a caller that forgot the lines fails closed");
  assert.equal(rewardDiscountAmount(300, card({ scope: scope([]) }), items), 0, "an empty scope matches nothing");
});

test("scoped: an ObjectId-like productId (toString) matches by its string form", () => {
  const oid = { toString: () => A };
  const items = [{ productId: oid, price: 200, qty: 1 }];
  assert.equal(rewardDiscountAmount(200, card({ scope: scope([A]) }), items), 40);
});

test("scoped: maxUnits 0 discounts nothing; a fractional maxUnits floors", () => {
  const items = [line(A, 100, 3)];
  assert.equal(rewardDiscountAmount(300, card({ scope: scope([A], 0) }), items), 0);
  assert.equal(rewardDiscountAmount(300, card({ value: 50, scope: scope([A], 1.9) }), items), 50, "1 unit = 100, 50%");
});

// ── cap (scoped) ───────────────────────────────────────────────────────────────────────────────────────────────────

test("scoped percent with a cap: below the cap unchanged, above the cap bounded, exactly at the cap equal", () => {
  const items = [line(A, 400)];
  const at = (cap: number) => rewardDiscountAmount(400, card({ value: 50, capRupees: cap, scope: scope([A]) }), items);
  assert.equal(at(500), 200, "cap above the 200 discount");
  assert.equal(at(200), 200, "cap equal");
  assert.equal(at(80), 80, "cap below");
  assert.equal(at(80.4), 80, "a fractional cap rounds");
});

// ── scoped flat ────────────────────────────────────────────────────────────────────────────────────────────────────

test("scoped flat: min(value, eligible base) — never more than the in-scope dishes cost", () => {
  const items = [line(A, 60), line(C, 500)];
  assert.equal(rewardDiscountAmount(560, card({ kind: "flat", value: 100, scope: scope([A]) }), items), 60, "clamped to base");
  const big = [line(A, 300), line(C, 500)];
  assert.equal(rewardDiscountAmount(800, card({ kind: "flat", value: 100, scope: scope([A]) }), big), 100, "value below base");
  assert.equal(rewardDiscountAmount(800, card({ kind: "flat", value: -3, scope: scope([A]) }), big), 0);
});

// ── eligible base can never exceed the subtotal ────────────────────────────────────────────────────────────────────

test("scoped: the eligible base is clamped to the subtotal passed in (a stale/short subtotal cannot be exceeded)", () => {
  const items = [line(A, 400)];
  assert.equal(rewardDiscountAmount(100, card({ value: 100, scope: scope([A]) }), items), 100);
  assert.equal(rewardDiscountAmount(100, card({ kind: "flat", value: 400, scope: scope([A]) }), items), 100);
});

test("scoped: for a consistent bill, the discount never exceeds the subtotal the reducer produced", () => {
  const items = [line(A, 120, 2), line(B, 180), line(C, 7.5, 3), line(A, 999, 1, true)];
  const subtotal = sum(items);
  for (const maxUnits of [undefined, 1, 2, 3, 50]) {
    for (const kind of ["percent", "flat"] as const) {
      const value = kind === "percent" ? 100 : 10_000;
      const d = rewardDiscountAmount(subtotal, card({ kind, value, scope: scope([A, B, C], maxUnits) }), items);
      assert.ok(d >= 0 && d <= subtotal, `${kind}/${maxUnits}: ${d} within [0, ${subtotal}]`);
    }
  }
});

// ── item kind ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("item card: 0 even when scoped fields are present", () => {
  const items = [line(A, 100)];
  assert.equal(rewardDiscountAmount(100, card({ kind: "item", value: 0, item: "Chai", itemProductId: A, qty: 1 }), items), 0);
  assert.equal(rewardDiscountAmount(100, card({ kind: "item", value: 40, scope: scope([A]) }), items), 0);
});

// ── O2: the promo-marker discount-kind fence ───────────────────────────────────────────────────────────────────────

// The truth table changed DELIBERATELY with the third argument (the tab's stored kind): every row that passed no stored kind
// (a promo tab carrying none) is unchanged; the ONE row that flipped is a supplied kind EQUAL to the stored one - it was
// true (refused), now false, because a resumed POS re-sends the kind its tab already has on every add-round and settle, and
// refusing it locked a promo tab that already stored "gst" out of every later write. A switch to a DIFFERENT kind is
// still refused.
test("O2: promoBlocksDiscountKind truth table", () => {
  const stored = "SAVE50";
  assert.equal(promoBlocksDiscountKind("gst", stored, undefined), true, "a supplied gst would replace the promo's money");
  assert.equal(promoBlocksDiscountKind("reward", stored, undefined), true, "a supplied reward would too");
  assert.equal(promoBlocksDiscountKind(null, stored, undefined), false, "null clears a preset; it cannot touch a promo");
  assert.equal(promoBlocksDiscountKind(undefined, stored, undefined), false, "absent leaves the kind alone");
  for (const supplied of ["gst", "reward", null, undefined] as const) {
    assert.equal(promoBlocksDiscountKind(supplied, undefined, undefined), false, `no promo marker: ${String(supplied)} is never refused`);
    assert.equal(promoBlocksDiscountKind(supplied, undefined, "gst"), false, `no promo marker: ${String(supplied)} is never refused, whatever kind is stored`);
  }
  // CHANGED row: re-sending the kind the promo tab already stores is not a switch.
  assert.equal(promoBlocksDiscountKind("gst", stored, "gst"), false, "re-sending the stored gst is no switch");
  assert.equal(promoBlocksDiscountKind("reward", stored, "gst"), true, "a switch to a different kind is still refused");
  assert.equal(promoBlocksDiscountKind(null, stored, "gst"), false, "null stays unrefused");
  assert.equal(promoBlocksDiscountKind(undefined, stored, "gst"), false, "absent stays unrefused");
});

test("O2: the message is plain English and receipt.ts re-exports both symbols", () => {
  assert.equal(PROMO_BLOCKS_GST_DISCOUNT_MESSAGE, "This bill used a promo code, so the GST discount can't be added to it");
  assert.equal(receipt.PROMO_BLOCKS_GST_DISCOUNT_MESSAGE, PROMO_BLOCKS_GST_DISCOUNT_MESSAGE);
  assert.equal(receipt.promoBlocksDiscountKind, promoBlocksDiscountKind);
});

// ── computeOrderTotals end to end: ONE tax pipeline ────────────────────────────────────────────────────────────────

const GST_EXCLUSIVE: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
const GST_INCLUSIVE: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "inclusive" };

test("computeOrderTotals: a scoped card's discount + GST base equal an equal MANUAL discount, exclusive and inclusive", () => {
  const items = [line(A, 120), line(B, 180), line(C, 50, 2)];
  const reward = card({ scope: scope([A, B], 1) }); // dearest unit 180 -> 20% = 36
  for (const cfg of [GST_EXCLUSIVE, GST_INCLUSIVE]) {
    const viaCard = computeOrderTotals({ items, discount: 0, discountKind: "reward", charge: 0, cfg, reward });
    const manual = computeOrderTotals({ items, discount: 36, discountKind: undefined, charge: 0, cfg });
    assert.equal(viaCard.subtotal, 400);
    assert.equal(viaCard.discount, 36);
    assert.deepEqual(viaCard, manual, `${cfg.gstMode}: one tax pipeline — the card changes only the discount figure`);
  }
});

test("computeOrderTotals: without the card's lines (productId stripped) the scoped card discounts 0 — fails closed", () => {
  const items = [{ price: 120, qty: 1 }, { price: 180, qty: 1 }];
  const t = computeOrderTotals({
    items, discount: 0, discountKind: "reward", charge: 0, cfg: GST_EXCLUSIVE, reward: card({ scope: scope([A, B], 1) }),
  });
  assert.equal(t.discount, 0);
  assert.equal(t.total, t.subtotal + t.gstAmount);
});

test("computeOrderTotals: an unscoped card keeps the shipped clamp (a flat above the subtotal is clamped to it)", () => {
  const items = [line(A, 100)];
  const t = computeOrderTotals({
    items, discount: 0, discountKind: "reward", charge: 0, cfg: GST_EXCLUSIVE, reward: card({ kind: "flat", value: 500 }),
  });
  assert.equal(t.discount, 100);
  assert.equal(t.gstAmount, 0);
});

test("source pin: computeOrderTotals hands its items to rewardDiscountAmount and the clamp line is untouched", () => {
  const code = stripComments(readFileSync(path.join(HERE, "receipt.ts"), "utf8"));
  assert.ok(code.includes("rewardDiscountAmount(subtotal, reward, items)"), "the scoped base needs the lines");
  assert.ok(
    code.includes("const clampedDiscount = Math.min(Math.max(0, Math.round(rawDiscount)), subtotal);"),
    "the one clamp stays byte-identical",
  );
});
