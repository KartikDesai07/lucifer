import { test } from "node:test";
import assert from "node:assert/strict";
import { orderLineKey } from "@pos/shared/utils";
import {
  resolveItemVoid,
  voidGuardFilter,
  isLastLine,
  type VoidableLine,
  type ItemVoidRequest,
} from "./order-void";
import type { GstConfig } from "./receipt";

// CR1.3 — `resolveItemVoid` is the ENTIRE money/trail contract for voiding or
// qty-reducing one already-fired line on an open tab; the route is just auth +
// the conditional write. This file is the DB-free proof that:
//   (a) a full void splices the line out, a partial void just reduces qty, and
//       everything else in the order is left byte-for-byte alone;
//   (b) totals are recomputed from what REMAINS using the passed (tab-snapshot)
//       gstCfg, including the discount-re-clamp / never-negative edge;
//   (c) the appended trail entry snapshots the VOIDED quantity (and prep fields),
//       not what's left, and omits prep fields the line never had;
//   (d) every rejection path (stale view, unfired line, over-void, empty-tab) is
//       DECIDED before any items/totals are touched — the error variant carries
//       no partial `nextItems`;
//   (e) the request identifies a line by `lineKey` (orderLineKey), NOT by
//       productId — the REVIEW-CONFIRMED bug this closes is a stale index
//       pointing at a DIFFERENT line of the SAME product (two covers with
//       different instructions) silently voiding the wrong one.
// `voidGuardFilter` (the CAS term the route uses to serialize concurrent voids)
// is pinned separately at the bottom.

const AT = new Date("2026-08-09T12:00:00.000Z");
const REASON = "Sent to wrong table";
const VOIDED_BY = "Asha";

const GST_OFF: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };
const GST_INCLUSIVE_5PC: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "inclusive" };
const GST_EXCLUSIVE_10PC: GstConfig = { gstEnabled: true, gstRate: 10, gstMode: "exclusive" };

function line(over: Partial<VoidableLine> = {}): VoidableLine {
  return { productId: "p1", name: "Tea", price: 20, qty: 1, kotRound: 1, ...over };
}

// Defaults `lineKey` to the identity of the default `line()` — every call site
// that targets a REAL line overrides it with `orderLineKey(thatLine)` so the
// request always says what it's actually looking at.
function request(over: Partial<ItemVoidRequest> = {}): ItemVoidRequest {
  return {
    index: 0,
    lineKey: orderLineKey(line()),
    qty: 1,
    reason: REASON,
    voidedBy: VOIDED_BY,
    at: AT,
    ...over,
  };
}

// ── Splice / reduce mechanics ────────────────────────────────────────────────

test("full void (qty === line.qty) splices the line out and leaves the other lines untouched", () => {
  const lineA = line({ productId: "p1", name: "Tea", price: 20, qty: 2, kotRound: 1 });
  const lineB = line({ productId: "p2", name: "Coffee", price: 40, qty: 1, kotRound: 1 });
  const lineC = line({ productId: "p3", name: "Samosa", price: 15, qty: 3, kotRound: 2 });
  const items = [lineA, lineB, lineC];

  const result = resolveItemVoid({
    items,
    request: request({ index: 1, lineKey: orderLineKey(lineB), qty: 1 }), // voids ALL of lineB
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });

  assert.ok("nextItems" in result, "a valid full void must not error");
  if (!("nextItems" in result)) return;
  assert.deepEqual(result.nextItems, [lineA, lineC], "lineB is spliced out; lineA/lineC are unchanged");
});

test("qty-reduce (qty < line.qty) leaves the line in place with qty reduced by exactly the voided amount", () => {
  const target = line({ productId: "p1", name: "Tea", price: 20, qty: 3, kotRound: 1 });
  const other = line({ productId: "p2", name: "Coffee", price: 40, qty: 1, kotRound: 1 });
  const items = [target, other];

  const result = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(target), qty: 2 }), // void 2 off a qty-3 line
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });

  assert.ok("nextItems" in result, "a valid qty-reduce must not error");
  if (!("nextItems" in result)) return;
  assert.equal(result.nextItems.length, 2, "the line stays — this is a reduce, not a splice");
  assert.equal(result.nextItems[0].qty, 1, "3 - 2 voided = 1 remaining, exactly");
  assert.deepEqual(
    { ...result.nextItems[0], qty: target.qty },
    target,
    "every other field on the reduced line (name/price/productId/kotRound) is untouched",
  );
  assert.deepEqual(result.nextItems[1], other, "the untouched line is not touched");
});

// ── Totals recompute from what REMAINS ───────────────────────────────────────

test("totals are recomputed from the remaining lines only, using the passed (tab-snapshot) gstCfg", () => {
  // p1: 100x2=200, p2: 50x1=50, p3: 30x3=90 -> subtotal 340. Void p1 down by 1
  // (voids 100 off the bill) -> remaining subtotal 240.
  const items = [
    line({ productId: "p1", name: "Biryani", price: 100, qty: 2, kotRound: 1 }),
    line({ productId: "p2", name: "Lassi", price: 50, qty: 1, kotRound: 1 }),
    line({ productId: "p3", name: "Naan", price: 30, qty: 3, kotRound: 1 }),
  ];

  const result = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(items[0]), qty: 1 }),
    discount: 20,
    charge: 0,
    gstCfg: GST_EXCLUSIVE_10PC,
  });

  assert.ok("totals" in result, "must not error");
  if (!("totals" in result)) return;
  assert.equal(result.totals.subtotal, 240, "recomputed from what remains: 100 + 50 + 90");
  assert.equal(result.totals.discount, 20, "well under the new subtotal — passes through unclamped");
  assert.equal(result.totals.gstAmount, 22, "10% exclusive GST on the discounted base (240-20=220)");
  assert.equal(result.totals.total, 242, "220 base + 22 GST");
});

test("an order-level discount that now EXCEEDS the reduced subtotal is re-clamped, and the total never goes negative", () => {
  const items = [
    line({ productId: "p1", name: "Thali", price: 300, qty: 1, kotRound: 1 }),
    line({ productId: "p2", name: "Water", price: 50, qty: 1, kotRound: 1 }),
  ];

  const result = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(items[0]), qty: 1 }), // full void of the 300 line
    discount: 100, // fit comfortably under the ORIGINAL 350 subtotal
    charge: 0,
    gstCfg: GST_EXCLUSIVE_10PC,
  });

  assert.ok("totals" in result, "must not error — one line (Water) survives");
  if (!("totals" in result)) return;
  assert.equal(result.totals.subtotal, 50, "only the surviving Water line remains");
  assert.equal(result.totals.discount, 50, "the stale 100 discount is re-clamped down to the new 50 subtotal");
  assert.equal(result.totals.gstAmount, 0, "10% of a zero base is zero");
  assert.equal(result.totals.total, 0, "base is 0 after the clamp — never negative");
});

test("inclusive GST config: recompute adds no on-top tax (already priced in), matching a live tab's snapshot", () => {
  const items = [
    line({ productId: "p1", name: "Thali", price: 200, qty: 1, kotRound: 1 }),
    line({ productId: "p2", name: "Water", price: 20, qty: 2, kotRound: 1 }),
  ];
  const result = resolveItemVoid({
    items,
    request: request({ index: 1, lineKey: orderLineKey(items[1]), qty: 1 }), // reduce Water 2 -> 1
    discount: 0,
    charge: 0,
    gstCfg: GST_INCLUSIVE_5PC,
  });
  assert.ok("totals" in result, "must not error");
  if (!("totals" in result)) return;
  assert.equal(result.totals.subtotal, 220, "200 + 20 (one Water remains)");
  assert.equal(result.totals.gstAmount, 0, "inclusive mode adds nothing on top");
  assert.equal(result.totals.total, 220, "total equals subtotal minus discount — no tax added");
});

// ── Trail entry snapshot ──────────────────────────────────────────────────────

test("the returned entry snapshots the VOIDED qty (not what remains) plus name/price/kotRound/reason/voidedBy/at", () => {
  const target = line({ productId: "p1", name: "Biryani", price: 150, qty: 3, kotRound: 2 });
  const other = line({ productId: "p2", name: "Raita", price: 25, qty: 1, kotRound: 2 });

  const result = resolveItemVoid({
    items: [target, other],
    request: request({
      index: 0,
      lineKey: orderLineKey(target),
      qty: 2,
      reason: REASON,
      voidedBy: VOIDED_BY,
      at: AT,
    }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });

  assert.ok("entry" in result, "must not error");
  if (!("entry" in result)) return;
  assert.equal(result.entry.qty, 2, "entry.qty is the VOIDED amount (2), not the 1 that remains on the line");
  assert.equal(result.entry.productId, "p1");
  assert.equal(result.entry.name, "Biryani", "name is snapshotted off the line, not the request");
  assert.equal(result.entry.price, 150, "unit price is snapshotted off the line");
  assert.equal(result.entry.kotRound, 2, "the round that fired the line, so the trail says which KOT it left");
  assert.equal(result.entry.reason, REASON);
  assert.equal(result.entry.voidedBy, VOIDED_BY);
  assert.equal(result.entry.at, AT);
});

test("the entry snapshot carries instructions/modifiers off the VOIDED line when it had them", () => {
  const target = line({
    productId: "p1",
    name: "Biryani",
    price: 150,
    qty: 2,
    kotRound: 1,
    instructions: "extra spicy",
    modifiers: ["no onion", "extra raita"],
  });
  const other = line({ productId: "p2", name: "Water", price: 10, qty: 1, kotRound: 1 });

  const result = resolveItemVoid({
    items: [target, other],
    request: request({ index: 0, lineKey: orderLineKey(target), qty: 1 }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });

  assert.ok("entry" in result, "must not error");
  if (!("entry" in result)) return;
  assert.equal(result.entry.instructions, "extra spicy", "the kitchen's VOID slip must name the exact preparation");
  assert.deepEqual(result.entry.modifiers, ["no onion", "extra raita"]);
});

test("the entry OMITS instructions/modifiers when the voided line carried none — omit-empty, not empty-string/empty-array", () => {
  const target = line({ productId: "p1", name: "Tea", price: 20, qty: 2, kotRound: 1 }); // no instructions/modifiers
  const other = line({ productId: "p2", name: "Water", price: 10, qty: 1, kotRound: 1 });

  const result = resolveItemVoid({
    items: [target, other],
    request: request({ index: 0, lineKey: orderLineKey(target), qty: 1 }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });

  assert.ok("entry" in result, "must not error");
  if (!("entry" in result)) return;
  assert.ok(!("instructions" in result.entry), "must be ABSENT, not an empty string");
  assert.ok(!("modifiers" in result.entry), "must be ABSENT, not an empty array");
});

// ── Rejection paths — decided BEFORE any items/totals are touched ───────────

test("index out of range -> 409 (a stale view of the tab, not a bad request), no nextItems returned", () => {
  const items = [line({ productId: "p1" })];
  const result = resolveItemVoid({
    items,
    request: request({ index: 5, lineKey: orderLineKey(items[0]) }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("error" in result, "an out-of-range index must error");
  if (!("error" in result)) return;
  assert.equal(result.status, 409, "stale-view errors are 409, not 400");
  assert.match(result.error, /reopen it/i, "message must explain the tab changed under the operator");
  assert.ok(!("nextItems" in result), "an error resolution carries no partial nextItems");
});

test("lineKey mismatch at that index -> 409 (another device changed the tab), no nextItems returned", () => {
  const items = [line({ productId: "p1" }), line({ productId: "p2" })];
  const result = resolveItemVoid({
    items,
    // lineKey describes a line that isn't at index 0 at all.
    request: request({ index: 0, lineKey: orderLineKey(line({ productId: "p9" })) }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("error" in result, "a lineKey that doesn't match the line at that index must error");
  if (!("error" in result)) return;
  assert.equal(result.status, 409);
  assert.ok(!("nextItems" in result));
});

// ── THE CONFIRMED BUG (arbiter live-probe, CR1.3 review) ────────────────────
// A bare productId echo cannot distinguish two lines of the SAME dish that
// differ only in preparation. A device holding a stale index that now points at
// the WRONG one of those two lines must be rejected, not silently honored.

test("WRONG-LINE regression: a stale index pointing at the OTHER same-product line is rejected by the lineKey comparison, not silently voided", () => {
  const lineA = line({ productId: "p1", name: "Tea", price: 20, qty: 1, kotRound: 1, instructions: "less sugar" });
  const lineB = line({ productId: "p1", name: "Tea", price: 20, qty: 1, kotRound: 1, instructions: "extra hot" });
  const items = [lineA, lineB];

  // The operator was looking at lineB, but the request's index is stale and now
  // points at lineA's slot. With a bare productId echo this would have matched
  // ("same product") and voided the WRONG line — the exact bug the arbiter's
  // live-probe reproduced. The lineKey comparison must reject it instead.
  const staleResult = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(lineB), qty: 1 }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("error" in staleResult, "index/lineKey disagree — must reject, not silently void whatever sits at the index");
  if (!("error" in staleResult)) return;
  assert.equal(staleResult.status, 409);

  // Control: the SAME lineKey against the CORRECT index voids the intended line
  // and leaves the other, same-product line completely untouched — proving the
  // rejection above is about identity, not about some unrelated brokenness.
  const correctResult = resolveItemVoid({
    items,
    request: request({ index: 1, lineKey: orderLineKey(lineB), qty: 1 }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("nextItems" in correctResult, "the correct index+lineKey pair must succeed");
  if (!("nextItems" in correctResult)) return;
  assert.deepEqual(correctResult.nextItems, [lineA], "lineB (index 1) is voided; lineA is untouched, byte-for-byte");
});

test("a line with kotRound 0 (never fired to the kitchen) is not voidable -> 400, no nextItems returned", () => {
  const target = line({ productId: "p1", kotRound: 0 });
  const items = [target];
  const result = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(target) }),
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("error" in result, "an unfired line has no kitchen ticket to cancel");
  if (!("error" in result)) return;
  assert.equal(result.status, 400);
  assert.match(result.error, /hasn't been sent/i);
  assert.ok(!("nextItems" in result));
});

test("qty greater than the line's remaining qty -> 400, no nextItems returned", () => {
  const target = line({ productId: "p1", qty: 2, kotRound: 1 });
  const items = [target];
  const result = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(target), qty: 3 }), // more than the line has
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("error" in result, "cannot void more than what's on the line");
  if (!("error" in result)) return;
  assert.equal(result.status, 400);
  assert.match(result.error, /cannot void more/i);
  assert.ok(!("nextItems" in result));
});

test("voiding the only remaining line -> 400 (that's a cancellation, not a void), names who CAN do it, no nextItems returned", () => {
  const target = line({ productId: "p1", qty: 1, kotRound: 1 });
  const items = [target];
  const result = resolveItemVoid({
    items,
    request: request({ index: 0, lineKey: orderLineKey(target), qty: 1 }), // full void, and it's the ONLY line
    discount: 0,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("error" in result, "emptying the tab this way must be rejected");
  if (!("error" in result)) return;
  assert.equal(result.status, 400);
  // The old wording ("cancel the order instead") pointed a cashier at an
  // admin-only action with no way to act on it — the fix names who can (CR1.3
  // review). Pin the ACTUAL message, since the review finding was about wording.
  assert.match(result.error, /ask an admin to cancel the order/i);
  assert.ok(!("nextItems" in result));
});

// ── isLastLine — the UI predicate that disables the option up front ─────────

test("isLastLine: true only when ONE line remains AND the whole of it is being voided", () => {
  assert.equal(isLastLine([{ qty: 2 }], 0, 2), true, "one line, voiding all of it");
});

test("isLastLine: false for a qty-reduce on the last line — some of it survives", () => {
  assert.equal(isLastLine([{ qty: 3 }], 0, 1), false, "voiding 1 of 3 leaves the line (and the tab) non-empty");
});

test("isLastLine: false when other lines exist, even when voiding all of index 0", () => {
  assert.equal(
    isLastLine([{ qty: 2 }, { qty: 1 }], 0, 2),
    false,
    "a second line survives — this is an ordinary full void, not a cancellation",
  );
});

// ── The CAS filter that serializes concurrent voids ──────────────────────────

test("voidGuardFilter(0) matches BOTH a missing `voids` field and an empty array — {$size:0} alone would miss the storage default", () => {
  const filter = voidGuardFilter(0);
  assert.deepEqual(
    filter,
    { $or: [{ voids: { $exists: false } }, { voids: { $size: 0 } }] },
    "voids is ABSENT (not []) until the first $push — a bare {$size:0} would never match a missing field",
  );
});

test("voidGuardFilter(n) for n > 0 matches an exact trail length", () => {
  assert.deepEqual(voidGuardFilter(3), { voids: { $size: 3 } });
  assert.deepEqual(voidGuardFilter(1), { voids: { $size: 1 } });
});
