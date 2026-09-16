import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

import {
  REQUEST_REJECTED_ERROR,
  REQUEST_GONE_ERROR,
  TABLE_STATE_CONFLICT_ERROR,
  TAB_CHANGED_ERROR,
  REQUEST_TOO_OLD_ERROR,
  PROMO_DRIFT_ERROR,
  acceptGuardFilter,
  classifyTarget,
  buildAddRoundFilter,
  buildKotNumbers,
  decideOnStatus,
} from "./order-request-accept";
import {
  createTotalsMatchQuote,
  isRequestTooOld,
  mergedNote,
  shouldClaimTable,
  tableClaimFilter,
  finalizeCasFilter,
} from "./order-request-accept-core";
import { buildFallbackRequest } from "./order-request-accept-fallback";
import type { PromoCodeConfig } from "@pos/shared/public";
import { guardedRejectDecision, isSourceRequestIdsDuplicate, gstConfigDrifted } from "./order-request-accept-write";
import { resolveAcceptPromo, decidePromoRedemption, promoIsClaimable, PROMO_USED_ERROR } from "./order-request-accept-promo";
import { PUBLIC_REQUEST_PENDING_TTL_MS } from "./order-request-intake";
import { voidGuardFilter } from "./order-void";
import type { IOrder } from "@/models/Order";
import type { GstConfig } from "@/lib/receipt";

// buildAddRoundFilter only reads _id/kotRounds/voids off its `old` param —
// this fixture builder casts a plain fixture to that Pick<IOrder, ...> shape
// so tests never need a real ObjectId or a full Order document.
type OldOrderFixture = Pick<IOrder, "_id" | "kotRounds" | "voids">;
function oldOrder(fields: { _id?: string; kotRounds?: number; voids?: unknown[] }): OldOrderFixture {
  return fields as unknown as OldOrderFixture;
}

// CR2.2 SLICE 4 — the accept bridge. DB-FREE: every test here exercises a
// pure decision/shape helper (lib/order-request-accept-core.ts) or a plain
// string/function constant re-exported from lib/order-request-accept.ts —
// nothing touches Mongo.
//
// NOT covered here — the DB-driven paths, which are a later (live-leg) slice's
// job:
//   - step 2's CAS entry into "accepting" and its re-enterable-after-a-crash resume
//   - step 3's repair-lookup-FIRST ordering (crash between the order write and
//     the request mark)
//   - step 4's live Product re-validation (isActive filter, priceRequestItems
//     rejections, and the revert-to-pending on both a pricing error and a drift)
//   - step 5's Customer attach/create/auto-mode-skip branches
//   - the add-round write's actual CAS filter match/miss against a live Order,
//     and its $set/$addToSet/$unset shape landing correctly
//   - the create write's table-free gate + the table-claim CAS
//   - step 7's duplicate-key repair on BOTH the add-round and create write paths
//   - step 8's finalizeAccept CAS mark + cache invalidation
//   - replayAccepted's live Order lookup
//   - two concurrent accepts racing the same request end to end

test("acceptGuardFilter: a $ne filter keyed on the given requestId", () => {
  assert.deepEqual(acceptGuardFilter("req-1"), { sourceRequestIds: { $ne: "req-1" } });
});

test("buildAddRoundFilter: carries status/payment/kotRounds from the old order", () => {
  const filter = buildAddRoundFilter(oldOrder({ _id: "o1", kotRounds: 2 }), "req-1");
  assert.equal(filter.status, "Pending");
  assert.equal(filter.payment, "Unpaid");
  assert.equal(filter.kotRounds, 2);
  assert.equal(filter._id, "o1");
});

test("buildAddRoundFilter: kotRounds defaults to 0 when the old order carries none", () => {
  const filter = buildAddRoundFilter(oldOrder({ _id: "o1" }), "req-1");
  assert.equal(filter.kotRounds, 0);
});

test("buildAddRoundFilter: merges voidGuardFilter's terms EXACTLY (zero and non-zero void counts)", () => {
  const zero = buildAddRoundFilter(oldOrder({ _id: "o1", kotRounds: 0 }), "req-1");
  for (const [k, v] of Object.entries(voidGuardFilter(0))) assert.deepEqual((zero as Record<string, unknown>)[k], v);

  const some = buildAddRoundFilter(oldOrder({ _id: "o1", kotRounds: 0, voids: [{}, {}] }), "req-1");
  for (const [k, v] of Object.entries(voidGuardFilter(2))) assert.deepEqual((some as Record<string, unknown>)[k], v);
});

test("buildAddRoundFilter: merges acceptGuardFilter's $ne term for THIS request id — the reciprocal-CAS fence", () => {
  const filter = buildAddRoundFilter(oldOrder({ _id: "o1", kotRounds: 0 }), "req-1") as Record<string, unknown>;
  assert.deepEqual(filter.sourceRequestIds, { $ne: "req-1" });
});

test("buildKotNumbers: returns undefined when the cafe doesn't number KOTs (ticket undefined)", () => {
  assert.equal(buildKotNumbers([1, 2], 3, undefined), undefined);
});

test("buildKotNumbers: round 1 with no existing array writes [ticket]", () => {
  assert.deepEqual(buildKotNumbers(undefined, 1, 42), [42]);
});

test("buildKotNumbers: a SHORT existing array fills the gap with 0, written at index round-1, never shifted", () => {
  // Round 3 fired, but the tab only carries a round-1 number (numbering was
  // switched on after round 1) — round 2's slot must be 0, not shifted.
  assert.deepEqual(buildKotNumbers([7], 3, 99), [7, 0, 99]);
});

test("classifyTarget: parcel always wins, regardless of hasOpenTab/tableFree", () => {
  assert.equal(classifyTarget("parcel", true, false), "parcel");
  assert.equal(classifyTarget("parcel", false, true), "parcel");
});

test("classifyTarget: table + an open tab → add-round", () => {
  assert.equal(classifyTarget("table", true, false), "add-round");
  assert.equal(classifyTarget("table", true, true), "add-round");
});

test("classifyTarget: table + no open tab + table free → create", () => {
  assert.equal(classifyTarget("table", false, true), "create");
});

test("classifyTarget: table + no open tab + table NOT free → table-conflict", () => {
  assert.equal(classifyTarget("table", false, false), "table-conflict");
});

test("decideOnStatus: accepted + an Order already carries the request → replay", () => {
  assert.equal(decideOnStatus("accepted", true), "replay");
});

test("decideOnStatus: accepted + no Order found → gone", () => {
  assert.equal(decideOnStatus("accepted", false), "gone");
});

test("decideOnStatus: rejected → rejected, regardless of orderExists", () => {
  assert.equal(decideOnStatus("rejected", true), "rejected");
  assert.equal(decideOnStatus("rejected", false), "rejected");
});

test("decideOnStatus: pending/accepting → null (proceed with the accept flow)", () => {
  assert.equal(decideOnStatus("pending", false), null);
  assert.equal(decideOnStatus("accepting", false), null);
});

test("createTotalsMatchQuote: exact match, plus the ONE tolerated delta — a charge-less quote picking up the table's one-time charge on an out-of-order first accept (field bug 2026-08-20)", () => {
  // Exact match always passes (charge quoted and unchanged).
  assert.equal(createTotalsMatchQuote(608, 150, 608, 150), true);
  // Charge-less sibling accepted FIRST: computed exceeds the quote by exactly
  // the live charge → tolerated; this order carries the table's charge once.
  assert.equal(createTotalsMatchQuote(250, 150, 100, 0), true);
  // Same shape but the delta is NOT the charge → real drift.
  assert.equal(createTotalsMatchQuote(260, 150, 100, 0), false);
  // A quote that DID carry a charge tolerates nothing (charge amount moved).
  assert.equal(createTotalsMatchQuote(628, 170, 608, 150), false);
  assert.equal(createTotalsMatchQuote(500, 0, 480, 0), false); // plain price drift
  // No live charge (table charge removed): a charge-less quote must still
  // match exactly — the tolerance needs a positive computed charge.
  assert.equal(createTotalsMatchQuote(100, 0, 100, 0), true);
});

test("isSourceRequestIdsDuplicate: true only when the E11000's keyPattern names sourceRequestIds", () => {
  assert.equal(isSourceRequestIdsDuplicate({ code: 11000, keyPattern: { sourceRequestIds: 1 } }), true);
  assert.equal(isSourceRequestIdsDuplicate({ code: 11000, keyPattern: { orderId: 1 } }), false);
  assert.equal(isSourceRequestIdsDuplicate({ code: 11000 }), false);
  assert.equal(isSourceRequestIdsDuplicate(null), false);
});

test("error constants: REQUEST_GONE_ERROR/REQUEST_REJECTED_ERROR/TAB_CHANGED_ERROR are non-empty strings", () => {
  for (const msg of [REQUEST_GONE_ERROR, REQUEST_REJECTED_ERROR, TAB_CHANGED_ERROR]) {
    assert.equal(typeof msg, "string");
    assert.ok(msg.length > 0);
  }
});

test("TABLE_STATE_CONFLICT_ERROR: names the table and points staff at the Tables screen", () => {
  const msg = TABLE_STATE_CONFLICT_ERROR("T-4");
  assert.match(msg, /T-4/);
  assert.match(msg, /Tables screen/);
});

// ── Review-fix additions (FIX1-9) — all still pure/DB-free ──────────────────

test("REQUEST_TOO_OLD_ERROR is a non-empty string", () => {
  assert.equal(typeof REQUEST_TOO_OLD_ERROR, "string");
  assert.ok(REQUEST_TOO_OLD_ERROR.length > 0);
});

test("isRequestTooOld: boundary — createdAt EXACTLY at the pending-TTL cutoff is NOT too old (strictly older-than)", () => {
  const now = 1_700_000_000_000;
  const cutoff = now - PUBLIC_REQUEST_PENDING_TTL_MS;
  assert.equal(isRequestTooOld(new Date(cutoff), now), false, "exactly at the cutoff must still be acceptable");
  assert.equal(isRequestTooOld(new Date(cutoff - 1), now), true, "1ms older than the cutoff must be too old");
  assert.equal(isRequestTooOld(new Date(cutoff + 1), now), false, "1ms younger than the cutoff must be fine");
});

test("guardedRejectDecision: an Order already carrying the request → replay; none found → revert", () => {
  assert.equal(guardedRejectDecision(true), "replay");
  assert.equal(guardedRejectDecision(false), "revert");
});

test("finalizeCasFilter: keyed on requestId, status $in [accepting, pending, rejected] — FIX2's widened CAS, now also widened for the billed-but-rejected race (CR2.2 fix round)", () => {
  assert.deepEqual(finalizeCasFilter("req-1"), {
    _id: "req-1",
    status: { $in: ["accepting", "pending", "rejected"] },
  });
});

test("shouldClaimTable: true only for a dine-in order that's still Pending + Unpaid with a tableNo", () => {
  assert.equal(shouldClaimTable({ tableNo: "T-1", status: "Pending", payment: "Unpaid" }), true);
});

test("shouldClaimTable: false — no tableNo (parcel), wrong status, or wrong payment", () => {
  assert.equal(shouldClaimTable({ tableNo: undefined, status: "Pending", payment: "Unpaid" }), false);
  assert.equal(shouldClaimTable({ tableNo: "T-1", status: "Completed", payment: "Unpaid" }), false);
  assert.equal(shouldClaimTable({ tableNo: "T-1", status: "Pending", payment: "Cash" }), false);
});

test("tableClaimFilter: { tableNo, status: 'Available' } — only claims a table that's still free", () => {
  assert.deepEqual(tableClaimFilter("T-2"), { tableNo: "T-2", status: "Available" });
});

const GST_BASE: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };

test("gstConfigDrifted: identical configs → false", () => {
  assert.equal(gstConfigDrifted(GST_BASE, { ...GST_BASE }), false);
});

test("gstConfigDrifted: true when gstEnabled, gstRate, or gstMode individually differ", () => {
  assert.equal(gstConfigDrifted(GST_BASE, { ...GST_BASE, gstEnabled: false }), true);
  assert.equal(gstConfigDrifted(GST_BASE, { ...GST_BASE, gstRate: 12 }), true);
  assert.equal(gstConfigDrifted(GST_BASE, { ...GST_BASE, gstMode: "inclusive" }), true);
});

test("mergedNote: no request note → the existing note (or absence of one) passes through unchanged", () => {
  assert.equal(mergedNote("Table by the window", undefined), "Table by the window");
  assert.equal(mergedNote(undefined, undefined), undefined);
  assert.equal(mergedNote(undefined, ""), undefined);
});

test("mergedNote: a request note with no existing note becomes the note as-is — the create-path shape", () => {
  assert.equal(mergedNote(undefined, "No onion please"), "No onion please");
});

test("mergedNote: a request note WITH an existing note is appended, never overwriting it — the add-round shape", () => {
  assert.equal(mergedNote("Regular", "Extra spicy"), "Regular | Extra spicy");
});

// ── CR2.2 fix round — synthesized-request fallback shape ───────────────────

test("buildFallbackRequest: synthesizes every field toTrayRequest reads, derived from the ORDER — mobile/name empty, items empty, quoted totals/targetKind/tableNo from the order, note undefined", () => {
  const order = {
    tableNo: "T-9",
    subtotal: 300,
    chargeAmount: 40,
    chargeLabel: "Cover Charge",
    total: 340,
    orderId: "ORD-20260101-001",
  } as unknown as IOrder;
  const now = new Date("2026-01-01T00:00:00.000Z");
  const request = buildFallbackRequest(order, "req-9", "Staff Z", now);

  assert.equal(request.mobile, "");
  assert.equal(request.name, "");
  assert.deepEqual(request.items, []);
  assert.equal(request.targetKind, "table");
  assert.equal(request.tableNo, "T-9");
  assert.equal(request.quotedSubtotal, 300);
  assert.equal(request.quotedCharge, 40);
  assert.equal(request.quotedChargeLabel, "Cover Charge");
  assert.equal(request.quotedTotal, 340);
  assert.equal(request.shortCode, "");
  assert.equal(request.status, "accepted");
  assert.equal(request.acceptedOrderId, "ORD-20260101-001");
  assert.equal(request.note, undefined);
  assert.equal(request.createdAt, now);
  assert.equal(request.updatedAt, now);
});

test("buildFallbackRequest: a parcel order (no tableNo) synthesizes targetKind \"parcel\" and omits tableNo/quotedChargeLabel entirely (omit-empty)", () => {
  const order = {
    tableNo: undefined,
    subtotal: 100,
    chargeAmount: 0,
    total: 100,
    orderId: "ORD-20260101-002",
  } as unknown as IOrder;
  const request = buildFallbackRequest(order, "req-10", "Staff Z", new Date());
  assert.equal(request.targetKind, "parcel");
  assert.equal(request.tableNo, undefined);
  assert.equal(request.quotedChargeLabel, undefined);
});

// ── CR2.2c — the promo drift fence (resolveAcceptPromo) ─────────────────────
// Re-resolves a stored promoCode from LIVE Settings against the RECOMPUTED
// subtotal at accept time — never trusts quotedDiscount as a money INPUT,
// only as what the diner was PROMISED (checked here). The DB-driven
// consequences (Order.discount carrying it on the create branch, the sum on
// the add-round branch) are proven end-to-end by the live leg (leg30,
// scripts/verify-order-request-live.ts) — this file stays DB-free, per its
// own file-level discipline.

const PROMO_CODES: PromoCodeConfig[] = [
  { code: "SAVE10", kind: "percent", value: 10, active: true },
  { code: "FLAT50", kind: "flat", value: 50, active: true },
];

test("resolveAcceptPromo: no stored promoCode -> discount 0, no drift possible", () => {
  assert.deepEqual(resolveAcceptPromo(undefined, undefined, PROMO_CODES, 1000), { discount: 0 });
});

test("resolveAcceptPromo: PROMO_DRIFT_ERROR is a non-empty, staff-actionable string", () => {
  assert.equal(typeof PROMO_DRIFT_ERROR, "string");
  assert.ok(PROMO_DRIFT_ERROR.length > 0);
  assert.match(PROMO_DRIFT_ERROR, /reject it/);
});

test("resolveAcceptPromo: the code still resolves to the SAME amount that was quoted -> success, no drift", () => {
  // SAVE10 (10%) on a 500 subtotal = 50, matching what was quoted.
  assert.deepEqual(resolveAcceptPromo("SAVE10", 50, PROMO_CODES, 500), { discount: 50, kind: "percent" });
});

test("resolveAcceptPromo: the code no longer resolves at all (deactivated between quote and accept) -> PROMO_DRIFT_ERROR", () => {
  const deactivated: PromoCodeConfig[] = [{ ...PROMO_CODES[0]!, active: false }, PROMO_CODES[1]!];
  assert.deepEqual(resolveAcceptPromo("SAVE10", 50, deactivated, 500), { error: PROMO_DRIFT_ERROR });
});

test("resolveAcceptPromo: the code resolves to a DIFFERENT amount than quoted (subtotal moved) -> PROMO_DRIFT_ERROR", () => {
  // SAVE10 (10%) on a 500 subtotal = 50, but the request was quoted at 40 —
  // the subtotal changed (price drift, or an edited quantity) between quote
  // and accept.
  assert.deepEqual(resolveAcceptPromo("SAVE10", 40, PROMO_CODES, 500), { error: PROMO_DRIFT_ERROR });
});

test("resolveAcceptPromo: a flat code clamped identically at both quote and accept time still matches -> no drift", () => {
  // FLAT50 on a 30 subtotal clamps to 30 at BOTH quote and accept time.
  assert.deepEqual(resolveAcceptPromo("FLAT50", 30, PROMO_CODES, 30), { discount: 30, kind: "flat" });
});

// ── SPEC P4 — per-customer usage cap: resolveAcceptPromo propagates the flag,
//    and the fence's own dup-key decision table (DB-free, fake-port style) ──

const ONCE_CODES: PromoCodeConfig[] = [
  { code: "ONCE10", kind: "percent", value: 10, active: true, oncePerCustomer: true },
];

test("resolveAcceptPromo: a code configured oncePerCustomer:true carries that flag through on success", () => {
  assert.deepEqual(resolveAcceptPromo("ONCE10", 50, ONCE_CODES, 500), { discount: 50, kind: "percent", oncePerCustomer: true });
});

test("resolveAcceptPromo: a code with no oncePerCustomer flag never carries it — omitted, not false", () => {
  const r = resolveAcceptPromo("SAVE10", 50, PROMO_CODES, 500);
  assert.deepEqual(r, { discount: 50, kind: "percent" });
  assert.ok(!("oncePerCustomer" in r), "oncePerCustomer must be absent on a non-flagged code's result");
});

test("promoIsClaimable: NO code means nothing to claim — every kind, every amount", () => {
  // A fence burned without a code is a redemption row keyed on a code that was
  // never applied: it would consume this customer's single use of whatever
  // code happens to share that key. Pinned as BEHAVIOUR because a source pin
  // on the predicate's text did not catch this (measured escape).
  assert.equal(promoIsClaimable(0, undefined, "item"), false);
  assert.equal(promoIsClaimable(500, undefined, "flat"), false);
  assert.equal(promoIsClaimable(0, "", "item"), false, "an empty code is not a code");
});

test("promoIsClaimable: an ITEM promo is claimable at 0, a money promo is not", () => {
  // The CB-5D split, stated once: an item promo's benefit is the free LINE, so
  // 0 rupees is its normal resolved value; a percent code floored to 0 on a
  // tiny bill is worth nothing and must NOT burn the single use (review LOW #6).
  assert.equal(promoIsClaimable(0, "FREEDISH", "item"), true);
  assert.equal(promoIsClaimable(0, "SAVE10", "percent"), false);
  assert.equal(promoIsClaimable(0, "FLAT50", "flat"), false);
  assert.equal(promoIsClaimable(50, "SAVE10", "percent"), true);
});

test("PROMO_USED_ERROR is a non-empty, staff-actionable string distinct from PROMO_DRIFT_ERROR", () => {
  assert.equal(typeof PROMO_USED_ERROR, "string");
  assert.ok(PROMO_USED_ERROR.length > 0);
  assert.match(PROMO_USED_ERROR, /reject this request/);
  assert.notEqual(PROMO_USED_ERROR, PROMO_DRIFT_ERROR);
});

test("decidePromoRedemption: no dup-key error -> claimed (the fresh, common case)", () => {
  assert.equal(decidePromoRedemption(false, undefined, "req-1"), "claimed");
});

test("decidePromoRedemption: a dup-key row from THIS SAME requestId -> replay (repairing our own crashed accept)", () => {
  assert.equal(decidePromoRedemption(true, "req-1", "req-1"), "replay");
});

test("decidePromoRedemption: a dup-key row from a DIFFERENT requestId -> reject (a genuinely different request already holds the fence)", () => {
  assert.equal(decidePromoRedemption(true, "req-OTHER", "req-1"), "reject");
});

test("decidePromoRedemption: a dup-key row with no existing requestId on record (defensive) -> reject, never a false replay", () => {
  assert.equal(decidePromoRedemption(true, undefined, "req-1"), "reject");
});

// ── C14 (arbiter-confirmed) — the fence's compare must be canonical-hex on
//    BOTH sides, or an upper-case URL replay of a genuine retry misreads as a
//    collision ──────────────────────────────────────────────────────────────
// `existing.requestId` is read back off a real ObjectId field (models/
// PromoRedemption.ts), so `String(existing.requestId)` is ALWAYS canonical
// lower-case hex. The route's own id gate (mongoose.isValidObjectId) accepts
// BOTH cases, so the raw requestId flowing into decidePromoRedemption can
// legitimately be upper-case. decidePromoRedemption itself does a plain `===`
// (never re-verified here — its own signature/semantics are unchanged by this
// fix), so the demonstration below shows why the compare side MUST be
// canonicalised before it ever reaches decidePromoRedemption: an uppercase
// requestId compared as-is against the canonical stored value would
// misclassify a legitimate replay as a genuine collision.

const SAME_REQUEST_ID_LOWER = "507f1f77bcf86cd799439011";
const SAME_REQUEST_ID_UPPER = "507F1F77BCF86CD799439011";

test("decidePromoRedemption: demonstrates the hazard directly -- the SAME request compared as raw upper-case against the canonical (lower-case) stored value misreads as reject, not replay", () => {
  // This is the exact failure claimPromoRedemption's canonicalisation (below)
  // exists to prevent: without it, this is what a genuine retry would get.
  assert.equal(
    decidePromoRedemption(true, SAME_REQUEST_ID_LOWER, SAME_REQUEST_ID_UPPER),
    "reject",
    "a raw (uncanonicalised) case mismatch between the SAME request's two spellings must misread as reject -- this is the bug C14 fixes upstream",
  );
});

test("decidePromoRedemption: once BOTH sides are canonicalised to the same case, the SAME request (spelled in upper case at the URL) replays instead of rejecting", () => {
  const canonicalOfUpper = SAME_REQUEST_ID_UPPER.toLowerCase();
  assert.equal(
    decidePromoRedemption(true, SAME_REQUEST_ID_LOWER, canonicalOfUpper),
    "replay",
    "once the upper-case requestId is canonicalised (mirroring claimPromoRedemption's new mongoose.Types.ObjectId(requestId).toString()), a retry of the SAME request must replay",
  );
});

// The REAL guard: reads order-request-accept-promo.ts and asserts
// claimPromoRedemption actually canonicalises requestId (via
// mongoose.Types.ObjectId(...).toString(), the same idiom lib/due-payment.ts's
// canonicalCustomerId uses) BEFORE passing it to decidePromoRedemption -- a
// mutated/reverted call site would still pass every pure-function test above
// while the real fence stayed broken.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ORDER_REQUEST_ACCEPT_PROMO_LIB = "apps/cafe/lib/order-request-accept-promo.ts";
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// ── CB-5D part 2 REGRESSION: the counter has NO quote ──────────────────────
// A REAL defect, found by review and reproduced before it was fixed: the
// counter passed `undefined` as quotedDiscount, and `undefined ?? 0` made the
// drift check compare every resolved amount against 0. A ₹50 code resolved to
// 50, compared 50 !== 0, and was refused as "drifted" — so the only codes the
// counter accepted were the ones worth NOTHING (a 0-value item promo), exactly
// inverting the feature. `null` now means "there was no quote" and skips the
// comparison; `undefined` keeps its old meaning for every quoted caller.
const COUNTER_CODES = [
  { code: "SAVE10", kind: "percent" as const, value: 10, active: true },
  { code: "FLAT50", kind: "flat" as const, value: 50, active: true },
];

test("REGRESSION (CB-5D part 2): a quote-less (null) caller resolves a MONEY code at its real value — never PROMO_DRIFT_ERROR", () => {
  const percent = resolveAcceptPromo("SAVE10", null, COUNTER_CODES, 500);
  assert.deepEqual(percent, { discount: 50, kind: "percent" }, "the counter must get the real ₹50, not a drift refusal");
  const flat = resolveAcceptPromo("FLAT50", null, COUNTER_CODES, 500);
  assert.deepEqual(flat, { discount: 50, kind: "flat" }, "a flat code must resolve for a quote-less caller too");
});

test("REGRESSION (CB-5D part 2): null skips drift, but undefined still MEANS 'quoted 0' — the diner path is unchanged", () => {
  // The distinction that IS the fix: these two arguments must not behave alike.
  const quoteless = resolveAcceptPromo("SAVE10", null, COUNTER_CODES, 500);
  const undefinedQuote = resolveAcceptPromo("SAVE10", undefined, COUNTER_CODES, 500);
  assert.ok(!("error" in quoteless), "null (no quote) must resolve");
  assert.ok("error" in undefinedQuote, "undefined must STILL drift-refuse — collapsing the two would silently drop a real fence from the diner path");
  // And a genuinely drifted quote is still caught for a quoted caller.
  const drifted = resolveAcceptPromo("SAVE10", 40, COUNTER_CODES, 500);
  assert.ok("error" in drifted, "a quoted caller whose amount moved must still be refused");
  // A matching quote still passes.
  assert.deepEqual(resolveAcceptPromo("SAVE10", 50, COUNTER_CODES, 500), { discount: 50, kind: "percent" });
});

test("PIN: claimPromoRedemption canonicalises requestId via new mongoose.Types.ObjectId(requestId).toString() and passes THAT (not the raw parameter) to decidePromoRedemption", () => {
  const src = stripComments(readSrc(ORDER_REQUEST_ACCEPT_PROMO_LIB));
  const fnStart = src.indexOf("export async function claimPromoRedemption");
  assert.ok(fnStart >= 0, "claimPromoRedemption must exist");
  const body = src.slice(fnStart);

  // CB-5D part 2 — the claimant generalised from a bare requestId to a
  // {kind,id} union (the counter claims this same fence for an orderId), so
  // the canonicalisation moved into the single-homed claimantKeyFor. The
  // DECISION is unchanged and re-pinned below: an ObjectId-shaped claimant is
  // still canonicalised (hex case), and the write and the compare must still
  // derive from ONE expression rather than relying on the schema's cast.
  assert.match(body.slice(0, 200), /claimant:\s*PromoClaimant/, "positive landmark: claimPromoRedemption must still take the claimant as its third parameter");

  assert.match(
    body,
    /const\s+claimantKey\s*=\s*claimantKeyFor\(claimant\)\s*;/,
    "claimPromoRedemption must derive its compare key through the single-homed claimantKeyFor(claimant)",
  );
  assert.match(
    body,
    /decidePromoRedemption\(\s*true,\s*existing\s*\?\s*claimantKeyOf\(existing\)\s*:\s*undefined,\s*claimantKey\s*\)/,
    "claimPromoRedemption must compare the STORED claimant key (claimantKeyOf) against its own claimantKey — never a raw field",
  );
  // The canonicalisation itself, at its new single home.
  const keyForStart = src.indexOf("export function claimantKeyFor");
  assert.ok(keyForStart >= 0, "claimantKeyFor must exist as the one place a claim key is derived");
  assert.match(
    src.slice(keyForStart, keyForStart + 400),
    /new\s+mongoose\.Types\.ObjectId\(claimant\.id\)\.toString\(\)/,
    "claimantKeyFor must canonicalise an ObjectId-shaped (request) claimant -- mirroring lib/due-payment.ts's canonicalCustomerId idiom, since ObjectId hex is case-insensitive and a replay must not read as a collision",
  );

  // The WRITE must use the same canonical expression as the compare. The
  // stored path is an ObjectId, so Mongoose would cast either spelling
  // (probe-verified) -- but then the schema type is the only thing keeping the
  // two halves in agreement, and a future String-typed path (or a raw-driver
  // reuse of this helper) would silently split them. Deriving both from one
  // expression is the actual guarantee.
  // The WRITE derives from the same canonical expression as the compare.
  assert.match(
    body,
    /new\s+mongoose\.Types\.ObjectId\(claimant\.id\)\.toString\(\)/,
    "the fence CLAIM must store a canonicalised request claimant, not the raw claimant.id",
  );
  assert.match(
    body,
    /claimOrderId:\s*claimant\.id/,
    "a counter claim must store its orderId in claimOrderId -- the counter's own claimant key, so a replay of the same order resumes rather than being refused",
  );
  const rawCreate = "create({ code, mobile: fenceMobile, requestId " + "})";
  assert.equal(
    body.includes(rawCreate),
    false,
    "the raw-parameter shorthand write must be gone -- the write and the compare must derive from one expression",
  );
});

test("PIN: releasePromoRedemption canonicalises its filter too (the compensating delete must not rely on the model's cast to reconcile two spellings)", () => {
  const src = stripComments(readSrc(ORDER_REQUEST_ACCEPT_PROMO_LIB));
  const fnStart = src.indexOf("export async function releasePromoRedemption");
  assert.ok(fnStart >= 0, "positive landmark: releasePromoRedemption must exist");
  const body = src.slice(fnStart);
  assert.match(
    body,
    /requestId:\s*new\s+mongoose\.Types\.ObjectId\(claimant\.id\)\.toString\(\)/,
    "releasePromoRedemption must canonicalise an ObjectId-shaped claimant in its deleteOne filter",
  );
  // CB-5D part 2 — the release must target the SAME claimant field the claim
  // wrote, or a counter release could delete a diner's fence row (and vice
  // versa) merely because the two shared a code and a mobile.
  assert.match(
    body,
    /claimOrderId:\s*claimant\.id/,
    "releasePromoRedemption must filter a counter claim on claimOrderId, never on the shared {code,mobile} alone",
  );
  // Positive landmark: the orderId-absent half of the filter is load-bearing
  // (it is what stops the release freeing a redemption whose order landed).
  assert.match(body, /orderId:\s*\{\s*\$exists:\s*false\s*\}/, "the orderId-absent guard must survive the canonicalisation");
});
