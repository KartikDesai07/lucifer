import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  computeOrderTotals,
  receiptGst,
  tableChargeOf,
  resolveDiscountKind,
  rewardBlocksDiscountKind,
  REWARD_BLOCKS_GST_DISCOUNT_MESSAGE,
  NO_TABLE_CHARGE,
  type GstConfig,
} from "./receipt";
import { rewardFromOrderSnapshot, type RedeemedReward } from "@pos/shared/reward-redemption";
import type { DiscountKind } from "@/lib/constants";
import { TABLE_CHARGE_MAX } from "@/lib/constants";
import { stripComments } from "@/lib/source-pin-utils";

// Per-table extra charge (owner decision, 2026-08-16): subtotal → discount
// (clamped to subtotal) → base → GST on base (exclusive only) → +charge →
// total. The charge is NOT taxed and NOT discounted — it lands on top of the
// taxed bill. These tests pin computeOrderTotals + receiptGst against that
// exact ordering, plus tableChargeOf's "a charge must be NAMED" rule.

const GST_OFF: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };
const GST_5_EXCLUSIVE: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
const GST_10_EXCLUSIVE: GstConfig = { gstEnabled: true, gstRate: 10, gstMode: "exclusive" };

// ── computeOrderTotals ────────────────────────────────────────────────────────

test("computeOrderTotals: the worked example — items 1000, discount 100, GST 5% exclusive, charge 50 — pins discount 100, base 900, gstAmount 45, charge 50, total 995", () => {
  const totals = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 100,
    discountKind: undefined,
    charge: 50,
    cfg: GST_5_EXCLUSIVE,
  });
  assert.deepEqual(totals, {
    subtotal: 1000,
    discount: 100,
    gstAmount: 45,
    charge: 50,
    total: 995,
  });
});

test("computeOrderTotals: the charge is OUTSIDE the discount — a 10% discount on subtotal 1000 with a 100 charge discounts the food only, never the charge", () => {
  const totals = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 100, // 10% of the 1000 subtotal
    discountKind: undefined,
    charge: 100,
    cfg: GST_5_EXCLUSIVE,
  });
  assert.equal(totals.discount, 100, "the discount itself must not grow just because a charge is present");
  assert.equal(totals.gstAmount, 45, "GST is 5% of the 900 discounted base, untouched by the charge");
  assert.equal(totals.total, 1045, "900 (base) + 45 (gst) + 100 (charge), NOT 10% off the combined 1100");
});

test("computeOrderTotals: the charge is OUTSIDE GST — gstAmount is identical whether the charge is 0 or 500", () => {
  const withoutCharge = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg: GST_10_EXCLUSIVE,
  });
  const withCharge = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 0,
    discountKind: undefined,
    charge: 500,
    cfg: GST_10_EXCLUSIVE,
  });
  assert.equal(withoutCharge.gstAmount, 100, "10% of the 1000 base");
  assert.equal(withCharge.gstAmount, 100, "the charge must never inflate the taxable base");
  assert.equal(withCharge.total, withoutCharge.total + 500, "only the total moves by exactly the charge");
});

test("computeOrderTotals: charge is clamped — negative floors to 0, above TABLE_CHARGE_MAX ceils to TABLE_CHARGE_MAX, fractional rounds", () => {
  const negative = computeOrderTotals({
    items: [{ price: 100, qty: 1 }], discount: 0, discountKind: undefined, charge: -50, cfg: GST_OFF,
  });
  assert.equal(negative.charge, 0, "a negative charge must floor to 0, never go negative onto the bill");

  const overMax = computeOrderTotals({
    items: [{ price: 100, qty: 1 }],
    discount: 0,
    discountKind: undefined,
    charge: TABLE_CHARGE_MAX + 5000,
    cfg: GST_OFF,
  });
  assert.equal(overMax.charge, TABLE_CHARGE_MAX, "a charge above TABLE_CHARGE_MAX must clamp to the ceiling");

  const fractional = computeOrderTotals({
    items: [{ price: 100, qty: 1 }], discount: 0, discountKind: undefined, charge: 49.6, cfg: GST_OFF,
  });
  assert.equal(fractional.charge, 50, "a fractional charge must round to whole rupees");
});

test("computeOrderTotals: charge 0 reproduces the pre-feature totals exactly — an ordinary bill with no table charge is unaffected", () => {
  const totals = computeOrderTotals({
    items: [{ price: 500, qty: 2 }],
    discount: 50,
    discountKind: undefined,
    charge: 0,
    cfg: GST_5_EXCLUSIVE,
  });
  assert.deepEqual(totals, {
    subtotal: 1000,
    discount: 50,
    gstAmount: 48, // round(950 * 5 / 100) = round(47.5) = 48
    charge: 0,
    total: 998, // base 950 + gst 48 + charge 0
  });
});

// ── receiptGst ────────────────────────────────────────────────────────────────

test("receiptGst EXCLUSIVE with a charge: taxable EXCLUDES the untaxed charge — a real bug caught during implementation (total 995, gstAmount 45, chargeAmount 50 -> taxable 900, NOT 950)", () => {
  const breakdown = receiptGst(
    { total: 995, gstAmount: 45, gstRate: 5, gstMode: "exclusive", chargeAmount: 50 },
    GST_5_EXCLUSIVE,
  );
  assert.deepEqual(breakdown, {
    show: true,
    inclusive: false,
    taxable: 900,
    gstAmount: 45,
    rate: 5,
  });
});

test("receiptGst INCLUSIVE with a charge: the back-calculation runs on (total - chargeAmount), not on the raw total", () => {
  // total 1050 = 1000 taxed food (inclusive of 5% GST) + a 50 untaxed charge.
  const breakdown = receiptGst(
    { total: 1050, gstRate: 5, gstMode: "inclusive", chargeAmount: 50 },
    { gstEnabled: true, gstRate: 5, gstMode: "inclusive" },
  );
  // Correct: back-calculate off 1000 (1050 - 50 charge) -> taxable 952, gst 48.
  assert.equal(breakdown.taxable, 952, "back-calculation must run on total minus the untaxed charge");
  assert.equal(breakdown.gstAmount, 48);
  // The WRONG calculation (ignoring the charge) would back-calculate off the
  // raw 1050 and land on a different pair of numbers — assert we are NOT there.
  assert.notEqual(breakdown.taxable, 1000, "must not back-calculate off the raw total including the charge");
  assert.notEqual(breakdown.gstAmount, 50);
});

test("receiptGst with chargeAmount absent behaves exactly as before — identical to an explicit chargeAmount: 0", () => {
  const withoutField = receiptGst(
    { total: 1050, gstAmount: 50, gstRate: 5, gstMode: "exclusive" },
    GST_5_EXCLUSIVE,
  );
  const withZero = receiptGst(
    { total: 1050, gstAmount: 50, gstRate: 5, gstMode: "exclusive", chargeAmount: 0 },
    GST_5_EXCLUSIVE,
  );
  assert.deepEqual(withoutField, withZero);
  assert.equal(withoutField.taxable, 1000);
  assert.equal(withoutField.gstAmount, 50);
});

// ── tableChargeOf ─────────────────────────────────────────────────────────────

test("tableChargeOf: an amount > 0 with a real label returns that config", () => {
  assert.deepEqual(
    tableChargeOf({ chargeAmount: 50, chargeLabel: "Rooftop charge" }),
    { amount: 50, label: "Rooftop charge" },
  );
});

test("tableChargeOf: an amount > 0 with an EMPTY label is NO_TABLE_CHARGE — a charge must be NAMED to be chargeable", () => {
  assert.deepEqual(tableChargeOf({ chargeAmount: 50, chargeLabel: "" }), NO_TABLE_CHARGE);
});

test("tableChargeOf: an amount > 0 with a WHITESPACE-ONLY label is NO_TABLE_CHARGE", () => {
  assert.deepEqual(tableChargeOf({ chargeAmount: 50, chargeLabel: "   " }), NO_TABLE_CHARGE);
});

test("tableChargeOf: an amount > 0 with an ABSENT label is NO_TABLE_CHARGE", () => {
  assert.deepEqual(tableChargeOf({ chargeAmount: 50 }), NO_TABLE_CHARGE);
});

test("tableChargeOf: amount 0 (with a label present) is NO_TABLE_CHARGE", () => {
  assert.deepEqual(tableChargeOf({ chargeAmount: 0, chargeLabel: "Rooftop charge" }), NO_TABLE_CHARGE);
});

test("tableChargeOf: amount ABSENT (with a label present) is NO_TABLE_CHARGE", () => {
  assert.deepEqual(tableChargeOf({ chargeLabel: "Rooftop charge" }), NO_TABLE_CHARGE);
});

test("tableChargeOf: a NEGATIVE amount (with a label present) is NO_TABLE_CHARGE", () => {
  assert.deepEqual(tableChargeOf({ chargeAmount: -10, chargeLabel: "Rooftop charge" }), NO_TABLE_CHARGE);
});

test("tableChargeOf: a null or undefined table is NO_TABLE_CHARGE", () => {
  assert.deepEqual(tableChargeOf(null), NO_TABLE_CHARGE);
  assert.deepEqual(tableChargeOf(undefined), NO_TABLE_CHARGE);
});

test("tableChargeOf: the label is TRIMMED", () => {
  assert.deepEqual(
    tableChargeOf({ chargeAmount: 50, chargeLabel: "  Rooftop charge  " }),
    { amount: 50, label: "Rooftop charge" },
  );
});

test("tableChargeOf: the amount is ROUNDED to whole rupees", () => {
  assert.deepEqual(
    tableChargeOf({ chargeAmount: 49.6, chargeLabel: "Rooftop charge" }),
    { amount: 50, label: "Rooftop charge" },
  );
});

// ── One bill, one total: source pins ─────────────────────────────────────────
// An adversarial review caught the charge being rendered as its own row in the
// cart footer while the bold "Total" beneath it silently left the charge out —
// the panel kept a PRIVATE copy of the bill arithmetic. Nothing above could
// catch it: these functions were right, the fourth mirror of them was not, and
// there is no React test framework here by design. So the rule is pinned at
// the source level instead: the money math lives in usePosTotals /
// computeOrderTotals, and a component may only PRINT what they return.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

// These pins forbid a FORMULA, so they must look at code and not at prose —
// the comment explaining why the formula is gone would otherwise trip the pin
// that removed it. (This bit us once already on a banned-string pin.)

test("PIN: Cart.tsx never re-derives the bill total — it takes `total` as a required prop", () => {
  const raw = readSrc("components/pos/Cart.tsx");
  const src = stripComments(raw);

  assert.ok(
    !/const\s+total\s*=/.test(src),
    "Cart.tsx computes its own total again. That is exactly how the table charge came to be printed as a row and then excluded from the total directly beneath it. Take `total` from usePosTotals instead.",
  );
  assert.ok(
    !/subtotal\s*-\s*discount/.test(src),
    "Cart.tsx is doing bill arithmetic. Subtotal/discount/GST/charge are combined in usePosTotals (and, authoritatively, in computeOrderTotals) — the panel only prints the result.",
  );
  assert.match(
    raw,
    /^\s*total:\s*number;/m,
    "CartProps must declare `total: number` as REQUIRED, so a caller cannot mount the cart without the figure every other surface is showing.",
  );
});

// The second confirmed defect: the POS cleared the operator's charge waiver
// after EVERY server round-trip, but only some of those round-trips can carry a
// charge. A waiver made mid-tab was therefore promised to the guest, dropped,
// and billed back at settle. The schema and route halves of the fix are covered
// by order.schema.test.ts and live leg 15; this pins the client half, which has
// no test home of its own.
test("PIN: the POS drops a charge waiver only when the request it just made could actually carry it", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));

  // 2026-09-29 (smooth-writes C2, F4 "pins that must change"): a send no longer
  // re-syncs the tab — the server's answer frees the whole cart (resetOrder), so
  // the waiver goes with it exactly when the server has stored the request that
  // carried it, and applyTabUpdate (void / move / refresh, none of which carry a
  // charge) never touches it at all. Pinned both ways.
  const apply = src.slice(src.indexOf("const applyTabUpdate"), src.indexOf("const sendToKitchen"));
  assert.match(apply, /resync\(order\.items, keepUnfired\)/, "landmark: the applyTabUpdate slice must be the real re-sync");
  assert.ok(
    !apply.includes("setChargeOverride("),
    "applyTabUpdate must never clear the local waiver: a void or move cannot send one, so clearing there throws away a waiver the operator promised — the guest is then billed a charge the operator waived.",
  );
  // WIDENED (CB-5B S9), never loosened: the original needle pinned the literal
  // as a CLOSED four-key object — a `}` immediately after chargeOverride — so
  // adding ANY fifth key tripped it. That arity was incidental to how the
  // needle was written, never to what it protects: both defects named below
  // are about a key being PRESENT, not about the object being exactly four
  // keys wide. The add-round route accepts an optional, intent-only `rewardAt`
  // (app/api/orders/[id]/items/route.ts resolves it and 409s a second claim;
  // addItemsSchema is .strict() and lists it), so the closed needle was the
  // only thing keeping the CLIENT half of a shipped server feature unwired —
  // a staff reward could be claimed on a new order but never on an open tab.
  //
  // Scoped to sendToKitchen DELIBERATELY. The settle payload lower in this same
  // file also carries `discountKind: discountKind ?? null` and `chargeAmount:
  // chargeOverride`, so a file-wide needle would match THAT block and keep
  // passing even with the add-round payload's keys deleted — strictly weaker
  // than the pin it replaced. Proven by probe before this was written.
  // Each key is asserted separately so a failure names the key that went
  // missing instead of pointing at one opaque literal.
  const kitchenPayload = src.slice(
    src.indexOf("const sendToKitchen"),
    src.indexOf("const payNow"),
  );
  assert.match(
    kitchenPayload,
    /addItems\.mutateAsync/,
    "landmark: sendToKitchen must still fire the add-round via addItems.mutateAsync — without this the key assertions below could pass vacuously against an empty slice.",
  );
  assert.match(
    kitchenPayload,
    /data:\s*\{[^}]*\bitems:\s*newItems\b/,
    "The add-a-round payload must carry the unfired lines as `items: newItems`.",
  );
  assert.match(
    kitchenPayload,
    /data:\s*\{[^}]*\bdiscount,/,
    "The add-a-round payload must carry `discount`, or an edited discount never re-clamps against the new subtotal.",
  );
  assert.match(
    kitchenPayload,
    /data:\s*\{[^}]*\bdiscountKind:\s*discountKind\s*\?\?\s*null/,
    "The add-a-round payload must carry discountKind (null = explicit clear), or the server treats the derived GST figure as a manual discount, stores no kind, and the GST Discount toggle silently reverts to ₹ after every fired round (CB-2).",
  );
  assert.match(
    kitchenPayload,
    /data:\s*\{[^}]*\bchargeAmount:\s*chargeOverride\b/,
    "The add-a-round payload must carry chargeAmount, or a waiver made mid-tab never reaches the server and dies with this browser tab.",
  );
  // The waiver is cleared only by the confirm that runs on the server's answer.
  const confirm = kitchenPayload.slice(kitchenPayload.indexOf("confirm: (order"));
  assert.ok(kitchenPayload.includes("confirm: (order"), "landmark: sendToKitchen frees the cart in its confirm");
  assert.match(
    confirm,
    /if \(tabIdRef\.current === startedFor\) resetOrder\(\);/,
    "sendToKitchen must free the cart (and with it the waiver) inside its confirm — exactly when the server has acknowledged the request that carried the charge.",
  );
  assert.ok(!kitchenPayload.includes("applyTabUpdate("), "the fire path no longer re-syncs the tab (that dropped lines added during the flight)");
  assert.match(
    src.slice(src.indexOf("const buildCreatePayload"), src.indexOf("const applyTabUpdate")),
    /chargeAmount: chargeOverride,/,
    "the create payload carries the waiver too, so freeing the cart after a NEW order's answer never drops an unsent waiver",
  );
});

test("PIN: the void path does NOT claim to have sent a charge — voidItemSchema carries none", () => {
  const src = stripComments(readSrc("app/(dashboard)/pos/page.tsx"));

  const voidCall = src.match(/applyTabUpdate\(order,\s*\{[^}]*\}\)/);
  assert.ok(voidCall, "the void handler must still call applyTabUpdate");
  // The option itself is gone (C2): no caller may bring a "clear the waiver" flag back.
  assert.ok(!stripComments(readSrc("hooks/use-pos-tab.ts")).includes("chargeSent"), "applyTabUpdate takes no chargeSent option any more");
  assert.ok(
    !/chargeSent/.test(voidCall[0]),
    "The void re-sync must not set chargeSent: a void request carries no charge, so clearing the waiver there throws away money the operator already promised to waive.",
  );
});

test("PIN: the POS page hands the cart the same total as the mobile bar and the payment modal", () => {
  // CR2.3 S2 split cartProps construction into lib/pos-cart-props.ts to keep
  // the page under the line cap — the invariant moved with it, so this pin
  // anchors BOTH halves: the wiring itself, and the page actually using it.
  const builder = stripComments(readSrc("lib/pos-cart-props.ts"));
  assert.match(
    builder,
    /total:\s*pos\.total,/,
    "cartProps must carry `total: pos.total`. Both the desktop column and the mobile sheet spread this one object, so passing it here is what makes the cart footer, the sticky bar and the payment modal the same number by construction.",
  );

  const page = stripComments(readSrc("app/(dashboard)/pos/page.tsx"));
  // Matches the import BLOCK, not a single-name destructuring: D9.8c added
  // hasPendingAdjustment to the same line (one shared "is anything applied"
  // predicate, so the More menu, the mobile bar and the sheet's auto-close
  // cannot drift). The subject of this pin is that the money figures come from
  // ONE assembler — proven by the buildCartProps(pos, ...) call below — not by
  // how many names the import happens to list.
  const propsImport = page.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/pos-cart-props"/);
  assert.ok(propsImport, 'pos/page.tsx must import from "@/lib/pos-cart-props"');
  assert.match(
    propsImport![1],
    /(^|[\s,])buildCartProps([\s,]|$)/,
    "pos/page.tsx must import buildCartProps from lib/pos-cart-props — the one place the cart's money figures are assembled.",
  );
  assert.match(
    page,
    /const\s+cartProps\s*=\s*buildCartProps\(pos\b/,
    "pos/page.tsx must build cartProps via buildCartProps(pos, ...) so the desktop column and the mobile sheet spread the SAME object derived from the SAME pos state — reachability, not just existence.",
  );
});

// The corrected arithmetic itself, so the pins above are anchored to a real
// figure rather than only to the absence of a formula.
test("the cart footer's total is exactly what usePosTotals returns: 1000 of items, 100 off, 5% GST and a 50 charge is 995", () => {
  const totals = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 100,
    discountKind: undefined,
    charge: 50,
    cfg: GST_5_EXCLUSIVE,
  });
  // The rows a cashier reads off the panel must sum to the total printed under
  // them — subtotal − discount + GST + charge, with nothing dropped.
  assert.equal(
    totals.subtotal - totals.discount + totals.gstAmount + totals.charge,
    totals.total,
  );
  assert.equal(totals.total, 995);
});

// ── resolveDiscountKind (CB-5B fix: a stored reward is STICKY against a client null) ──
// THE BUG: resolveDiscountKind returned `supplied ?? undefined` for ANY
// non-undefined `supplied` — so a request sending `discountKind: null` plus a
// manual `discount` on a tab carrying a stamp-funded "reward" would CLEAR the
// server-owned reward kind and re-price the bill with an arbitrary
// operator-chosen discount. The reward's value would be reinstated (or
// INFLATED) with no stamp check, while the order's own reward snapshot still
// claimed the redemption — and the stamps stay spent either way. THE FIX: a
// stored "reward" is now sticky against a client `null`; it is removed only by
// cancelling the order (S6), which returns the stamps. These are the first
// tests for resolveDiscountKind's null semantics — no prior test asserted
// "null always clears", so there is nothing here to widen or conflict with.

test("resolveDiscountKind (CB-5B fix): stored reward + supplied null -> STAYS reward — a client null must never clear a stamp-funded redemption", () => {
  assert.equal(resolveDiscountKind(null, "reward"), "reward");
});

test("resolveDiscountKind: stored reward + supplied undefined -> stays reward (unchanged: an absent key always leaves the stored kind alone)", () => {
  assert.equal(resolveDiscountKind(undefined, "reward"), "reward");
});

test("resolveDiscountKind (P4, s87): stored reward + supplied \"gst\" -> STAYS reward — a supplied GST preset must not replace a stamp-funded redemption", () => {
  // P4 (s87, arbiter-confirmed s86): this test used to expect "gst" ("an
  // explicit DIFFERENT kind is still allowed") — that expectation WAS the bug.
  // A "gst" supplied on add-round / settle replaced the stored reward, so the
  // reward's money vanished from the bill while the diner's stamps stayed spent.
  assert.equal(resolveDiscountKind("gst", "reward"), "reward");
});

test("resolveDiscountKind (P4): stored reward + supplied \"reward\" -> reward (a re-sent reward kind is a no-op, not a switch)", () => {
  assert.equal(resolveDiscountKind("reward", "reward"), "reward");
});

test("resolveDiscountKind (P4 guard): a stored reward answers \"reward\" for EVERY supplied value — and gst/undefined behaviour for a non-reward stored kind is unchanged", () => {
  const supplied: Array<DiscountKind | null | undefined> = [undefined, null, "gst", "reward"];
  for (const s of supplied) {
    assert.equal(resolveDiscountKind(s, "reward"), "reward", `stored reward, supplied ${String(s)}`);
  }
  // Positive landmarks that the non-reward paths still behave as shipped.
  assert.equal(resolveDiscountKind("gst", undefined), "gst");
  assert.equal(resolveDiscountKind("gst", "gst"), "gst");
  assert.equal(resolveDiscountKind(undefined, "gst"), "gst");
  assert.equal(resolveDiscountKind(null, "gst"), undefined);
  assert.equal(resolveDiscountKind("reward", undefined), "reward");
});

// ── rewardBlocksDiscountKind (P4): the 409 predicate both writers share ───────
// True IFF the order STORES a reward and the client SUPPLIED a different kind
// (today only "gst"). Absent / null / "reward" supplied never block — null is
// already held sticky by resolveDiscountKind, and a re-sent "reward" is a no-op.

test("rewardBlocksDiscountKind (P4): the full truth table — only stored reward x supplied gst blocks", () => {
  const supplied: Array<DiscountKind | null | undefined> = [undefined, null, "gst", "reward"];
  const stored: Array<DiscountKind | undefined> = [undefined, "gst", "reward"];
  for (const st of stored) {
    for (const su of supplied) {
      const expected = st === "reward" && su === "gst";
      assert.equal(
        rewardBlocksDiscountKind(su, st),
        expected,
        `stored ${String(st)} x supplied ${String(su)} -> ${expected}`,
      );
    }
  }
  // Vision-guard: the loop above must have exercised the one TRUE cell, or an
  // always-false stub would pass every negative row vacuously.
  assert.equal(rewardBlocksDiscountKind("gst", "reward"), true);
});

test("REWARD_BLOCKS_GST_DISCOUNT_MESSAGE (P4): the one refusal sentence both writers and the Cart hint share", () => {
  assert.equal(
    REWARD_BLOCKS_GST_DISCOUNT_MESSAGE,
    "This bill already has a reward, so the GST discount can't be added to it",
  );
});

// ── P4 money repros: the stamp reward must survive a supplied "gst" ───────────
// Real functions end to end (resolveDiscountKind -> rewardFromOrderSnapshot ->
// computeOrderTotals), priced exactly as app/api/orders/[id]/items/route.ts
// does it. Probed against the live bug: a flat Rs 100 reward tab (Rs 300) + a
// Rs 50 round, GST 5% exclusive, subtotal 350, priced discount 17 / total 350
// instead of 100 / 263 (the "gst" kind replaced the reward, so
// gstEquivalentDiscount(350) = 17 was taken and the Rs 100 the stamps bought
// vanished). Expected numbers derived by hand from the pricing rules: flat 100
// -> base 250, GST round(12.5) = 13, total 263; percent 20 -> discount 70, base
// 280, GST 14, total 294; item reward -> discount 0, GST round(17.5) = 18,
// total 368.

interface RewardTab {
  discountKind: DiscountKind;
  rewardAt: number;
  rewardKind: RedeemedReward["kind"];
  rewardValue: number;
  rewardItem?: string;
}

const FLAT_100_TAB: RewardTab = { discountKind: "reward", rewardAt: 5, rewardKind: "flat", rewardValue: 100 };
const PERCENT_20_TAB: RewardTab = { discountKind: "reward", rewardAt: 8, rewardKind: "percent", rewardValue: 20 };
const ITEM_TAB: RewardTab = {
  discountKind: "reward", rewardAt: 10, rewardKind: "item", rewardValue: 0, rewardItem: "Cake",
};

// The add-round route's pricing, step for step: the kind it resolves from the
// body + the stored tab, then the reward REBUILT from the stored snapshot.
function priceAddRound(
  tab: RewardTab,
  oldItems: Array<{ price: number; qty: number; reward?: boolean }>,
  roundItems: Array<{ price: number; qty: number }>,
  suppliedKind: DiscountKind | null | undefined,
) {
  const discountKind = resolveDiscountKind(suppliedKind, tab.discountKind);
  const totals = computeOrderTotals({
    items: [...oldItems, ...roundItems],
    discount: 0,
    discountKind,
    charge: 0,
    cfg: GST_5_EXCLUSIVE,
    reward: rewardFromOrderSnapshot(tab),
  });
  return { discountKind, totals };
}

test("P4 repro (add-round): a flat Rs 100 reward tab + a Rs 50 round with a supplied \"gst\" still prices discount 100 / total 263 — not 17 / 350", () => {
  const { discountKind, totals } = priceAddRound(FLAT_100_TAB, [{ price: 300, qty: 1 }], [{ price: 50, qty: 1 }], "gst");
  assert.equal(totals.subtotal, 350);
  assert.equal(totals.discount, 100, "the Rs 100 the stamps bought must still be on the bill (the bug priced 17)");
  assert.equal(totals.total, 263, "(350 - 100) + GST 13 (the bug billed 350)");
  assert.equal(discountKind, "reward", "the stored reward kind must survive a supplied gst");
});

test("P4 repro (add-round): a percent 20% reward tab survives a supplied \"gst\" — discount 70 / total 294", () => {
  const { discountKind, totals } = priceAddRound(PERCENT_20_TAB, [{ price: 300, qty: 1 }], [{ price: 50, qty: 1 }], "gst");
  assert.equal(totals.discount, 70, "20% of the 350 subtotal");
  assert.equal(totals.total, 294, "(350 - 70) + GST 14");
  assert.equal(discountKind, "reward");
});

test("P4 repro (add-round): an item reward tab keeps kind reward and a derived discount of 0 under a supplied \"gst\" — no GST discount appears", () => {
  const { discountKind, totals } = priceAddRound(
    ITEM_TAB,
    [{ price: 300, qty: 1 }, { price: 150, qty: 1, reward: true }],
    [{ price: 50, qty: 1 }],
    "gst",
  );
  assert.equal(totals.subtotal, 350, "the free dish is priced but never totalled");
  assert.equal(totals.discount, 0, "an item reward's rupee discount is always 0 (the bug derived a GST discount of 17)");
  assert.equal(totals.total, 368, "350 + GST round(17.5) = 18");
  assert.equal(discountKind, "reward");
});

test("P4 control (add-round): the SAME flat reward tab with the key absent or null prices 100 / 263 today — so the repros above differ only by the supplied \"gst\"", () => {
  for (const supplied of [undefined, null] as const) {
    const { totals } = priceAddRound(FLAT_100_TAB, [{ price: 300, qty: 1 }], [{ price: 50, qty: 1 }], supplied);
    assert.equal(totals.discount, 100, `supplied ${String(supplied)}`);
    assert.equal(totals.total, 263, `supplied ${String(supplied)}`);
  }
});

test("resolveDiscountKind (regression risk of the fix): stored gst + supplied null -> CLEARED to undefined — the original operator-clears-preset behaviour must still work for a NON-reward stored kind", () => {
  assert.equal(resolveDiscountKind(null, "gst"), undefined);
});

test("resolveDiscountKind: stored undefined + supplied null -> undefined (nothing to protect, nothing to clear)", () => {
  assert.equal(resolveDiscountKind(null, undefined), undefined);
});
