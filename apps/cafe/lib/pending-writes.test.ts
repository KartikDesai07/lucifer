import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import * as mod from "./pending-writes";
import {
  NOTICE_TITLES,
  SETTLE_BILL_SAVING,
  SETTLE_NOT_SETTLED,
  SETTLE_STILL_UNREACHABLE,
  SETTLE_TAB_CHANGED,
  SETTLE_UNCONFIRMED,
  SIGNED_OUT,
  SIGNED_OUT_CHECK,
  TAB_CANCELLED,
  TAB_MISSING,
  classifyFailure,
  intentOf,
  moneyEditedSince,
  noticeAction,
  noticeOfReadError,
  noticeOfSendError,
  noticeOfStep,
  noticeOfUnnumbered,
  reconcileSettle,
  settledElsewhereMessage,
  settledMessage,
  signedOut,
  stepFromOrder,
  tabLabel,
  type SettleIntent,
  type WriteNotice,
} from "./pending-writes";
import type { Order, SettleOrderInput } from "@/types";

const http = (status: number, message = `HTTP ${status}`) => new ApiError(message, "http", status);
const TIMEOUT = new ApiError("signal timed out", "timeout", null);
const OFFLINE = new ApiError("Failed to fetch", "network", null);

function order(over: Partial<Order>): Order {
  return { _id: "o1", orderId: "ORD-20260928-001", status: "Pending", payment: "Unpaid", paidAmount: 0, total: 540, items: [], ...over } as Order;
}

test("classifyFailure: a refusal is final, a 409 needs a look, anything unanswered is uncertain", () => {
  for (const s of [400, 401, 403, 404, 422]) assert.equal(classifyFailure(http(s)), "definite", `${s}`);
  assert.equal(classifyFailure(http(409)), "conflict");
  for (const s of [500, 502, 503, 504, 408, 429]) assert.equal(classifyFailure(http(s)), "uncertain", `${s}`);
  assert.equal(classifyFailure(TIMEOUT), "uncertain");
  assert.equal(classifyFailure(OFFLINE), "uncertain");
  assert.equal(classifyFailure(new Error("boom")), "uncertain", "an unknown throw is never read as a refusal");
});

test("reconcileSettle recognises OUR settle only when mode and amount match what the route would store", () => {
  const cash: SettleIntent = { payment: "Cash" };
  assert.equal(reconcileSettle(cash, order({ status: "Completed", payment: "Cash", paidAmount: 540 })), "adopt");
  assert.equal(reconcileSettle(cash, order({ status: "Completed", payment: "Online", paidAmount: 540 })), "elsewhere");
  assert.equal(reconcileSettle(cash, order({ status: "Completed", payment: "Cash", paidAmount: 300 })), "elsewhere", "a partial settle is not our full one");
  const partial: SettleIntent = { payment: "Cash", paidAmount: 300 };
  assert.equal(reconcileSettle(partial, order({ status: "Completed", payment: "Cash", paidAmount: 300 })), "adopt");
  assert.equal(reconcileSettle({ payment: "Cash", paidAmount: 900 }, order({ status: "Completed", payment: "Cash", paidAmount: 540 })), "adopt", "change is clamped to the total, as the route does");
  assert.equal(reconcileSettle({ payment: "Due" }, order({ status: "Completed", payment: "Due", paidAmount: 0 })), "adopt");
  const split: SettleIntent = { payment: "Split", splitCash: 240, splitOnline: 300 };
  assert.equal(reconcileSettle(split, order({ status: "Completed", payment: "Split", paidAmount: 540, splitCash: 240, splitOnline: 300 })), "adopt");
  assert.equal(reconcileSettle(split, order({ status: "Completed", payment: "Split", paidAmount: 540, splitCash: 540, splitOnline: 0 })), "elsewhere");
  assert.equal(reconcileSettle(cash, order({ status: "Pending" })), "open");
  assert.equal(reconcileSettle(cash, order({ status: "Cancelled" })), "cancelled");
});

// ── The one-foreground-attempt API (owner decision 1, 2026-09-28) ──────────

const CASH: SettleIntent = { payment: "Cash" };
const DONE = order({ status: "Completed", payment: "Cash", paidAmount: 540, billNumber: 17 } as Partial<Order>);
const SEEN = { expectedTotal: 540, expectedVoids: 0 };

// Names built by concatenation so a repo grep for the removed lane stays empty.
test("the background lane's retry loop is gone for good — no retry driver, no retry schedule", () => {
  assert.ok("reconcileSettle" in mod, "landmark: the module still exports reconcileSettle");
  for (const removed of ["run" + "Settle", "SETTLE_" + "RETRY_DELAYS_MS", "SETTLE_" + "MAX_ATTEMPTS"]) {
    assert.ok(!(removed in mod), `no automatic resend: ${removed} must not come back`);
  }
});

test("intentOf reads exactly the four money fields off the payload that was sent", () => {
  const payload = { payment: "Split", splitCash: 240, splitOnline: 300, expectedTotal: 540, discount: 0 } as SettleOrderInput;
  assert.deepEqual(intentOf(payload), { payment: "Split", paidAmount: undefined, splitCash: 240, splitOnline: 300 });
  assert.deepEqual(intentOf({ payment: "Cash", paidAmount: 300 }), { payment: "Cash", paidAmount: 300, splitCash: undefined, splitOnline: undefined });
});

test("stepFromOrder: a Completed order is ours ONLY when an unanswered attempt of ours matches it", () => {
  assert.deepEqual(stepFromOrder(DONE, [CASH], SEEN), { kind: "settled", order: DONE });
  // Ported from the lane's first-attempt 409 case: with nothing unanswered,
  // no settle of ours can exist — a matching Completed order is someone else's.
  assert.deepEqual(stepFromOrder(DONE, [], SEEN), { kind: "elsewhere", order: DONE });
  const online = order({ status: "Completed", payment: "Online", paidAmount: 540 });
  assert.deepEqual(stepFromOrder(online, [CASH], SEEN), { kind: "elsewhere", order: online });
  assert.deepEqual(stepFromOrder(DONE, [{ payment: "Online" }, CASH], SEEN), { kind: "settled", order: DONE }, "any one of several unanswered attempts may be the one that landed");
});

test("stepFromOrder: cancelled is gone; a Pending tab is changed when its total or void trail moved, otherwise open", () => {
  const cancelled = order({ status: "Cancelled" });
  assert.deepEqual(stepFromOrder(cancelled, [CASH], SEEN), { kind: "gone", message: TAB_CANCELLED, order: cancelled });
  const bigger = order({ total: 560 });
  assert.deepEqual(stepFromOrder(bigger, [CASH], SEEN), { kind: "changed", order: bigger });
  const voided = order({ voids: [{}] } as unknown as Partial<Order>);
  assert.deepEqual(stepFromOrder(voided, [], SEEN), { kind: "changed", order: voided });
  const same = order({});
  assert.deepEqual(stepFromOrder(same, [CASH], SEEN), { kind: "open", order: same });
  assert.deepEqual(stepFromOrder(same, [], {}), { kind: "open", order: same }, "no echo, nothing to compare — open");
});

function expectNotice(n: WriteNotice | "read" | null, kind: WriteNotice["kind"], message: string, action: WriteNotice["action"]) {
  assert.ok(n && n !== "read", `expected a ${kind} notice, got ${JSON.stringify(n)}`);
  assert.deepEqual(n, { kind, title: NOTICE_TITLES[kind], message, action });
}

const GONE_SUFFIX = ". If you took payment for it, give it back or ring it up again.";

test("noticeOfSendError: a refusal shows the server's words, a 409 means read the order, anything unanswered is 'Couldn't confirm'", () => {
  expectNotice(noticeOfSendError(http(400, "Select an existing customer for Due or Credit orders")), "refused", "Select an existing customer for Due or Credit orders", "confirm");
  expectNotice(noticeOfSendError(http(401, "Not authenticated")), "refused", SIGNED_OUT, "confirm");
  expectNotice(noticeOfSendError(http(404, "Order not found")), "gone", TAB_MISSING + GONE_SUFFIX, "close");
  assert.equal(noticeOfSendError(http(409, "Order already settled")), "read");
  for (const e of [http(500), http(502), http(503), http(504), http(408), http(429), TIMEOUT, OFFLINE, new Error("boom")]) {
    expectNotice(noticeOfSendError(e), "uncertain", SETTLE_UNCONFIRMED, "check");
  }
});

test("noticeOfStep: every reading has one plain-English answer; after a 409 an unchanged open tab is a refusal, never 'safe to settle again'", () => {
  assert.equal(noticeOfStep({ kind: "settled", order: DONE }, "check"), null, "a settled step closes the popup — no notice");
  const other = order({ status: "Completed", payment: "Online", paidAmount: 540, tableNo: "4" });
  expectNotice(noticeOfStep({ kind: "elsewhere", order: other }, "check"), "elsewhere", settledElsewhereMessage(other), "close");
  expectNotice(noticeOfStep({ kind: "changed", order: order({ total: 560 }) }, "conflict", "Tab changed"), "changed", SETTLE_TAB_CHANGED, "confirm");
  expectNotice(noticeOfStep({ kind: "open", order: order({}) }, "check"), "open", SETTLE_NOT_SETTLED, "confirm");
  // The route's pricing 409 leaves the tab unchanged — "safe to settle again"
  // there would start a loop of identical refusals.
  expectNotice(noticeOfStep({ kind: "open", order: order({}) }, "conflict", "The bill no longer matches the server"), "refused", "The bill no longer matches the server", "confirm");
  expectNotice(noticeOfStep({ kind: "gone", message: TAB_CANCELLED, order: null }, "check"), "gone", TAB_CANCELLED + GONE_SUFFIX, "close");
});

// K4c: nothing was read, so the controller's next tap is another GET — every
// notice but "gone" (Close) says Check, or the button would promise a Settle.
test("noticeOfReadError: a failed look keeps Check alive, and never claims a result it did not read", () => {
  expectNotice(noticeOfReadError(http(404), "check", undefined, true), "gone", TAB_MISSING + GONE_SUFFIX, "close");
  expectNotice(noticeOfReadError(http(401), "check", undefined, true), "refused", SIGNED_OUT_CHECK, "check");
  expectNotice(noticeOfReadError(http(403), "conflict", "Order already settled", true), "refused", SIGNED_OUT_CHECK, "check");
  expectNotice(noticeOfReadError(OFFLINE, "check", undefined, true), "uncertain", SETTLE_STILL_UNREACHABLE, "check");
  expectNotice(noticeOfReadError(OFFLINE, "conflict", "Order already settled", true), "uncertain", SETTLE_UNCONFIRMED, "check");
  expectNotice(noticeOfReadError(OFFLINE, "conflict", "Order already settled", false), "refused", "Order already settled", "check");
});

test("signed-out words: a settle POST says settle again; a failed Check read says tap Check", () => {
  assert.equal(SIGNED_OUT_CHECK, "You were signed out. Sign in again, then tap Check.");
  expectNotice(noticeOfSendError(http(401, "Not authenticated")), "refused", SIGNED_OUT, "confirm");
  assert.ok(SIGNED_OUT.endsWith("then settle it"), "the POST's words are unchanged");
});

test("K1: our settle read back without its bill number is 'still saving' — a Check, in plain words", () => {
  expectNotice(noticeOfUnnumbered(), "uncertain", SETTLE_BILL_SAVING, "check");
  assert.equal(SETTLE_BILL_SAVING, "The bill is still being saved. Tap Check again in a moment.");
});

test("K4b: the bill-changed words do not blame another device — this device may have changed it", () => {
  assert.equal(SETTLE_TAB_CHANGED, "This tab changed after the bill was opened. Check the new total, then settle.");
  assert.ok(!SETTLE_TAB_CHANGED.includes("another device"));
});

test("signedOut: a 401 or a 403 is a sign-in problem; nothing else is", () => {
  for (const s of [401, 403]) assert.equal(signedOut(http(s)), true, `${s}`);
  for (const e of [http(400), http(404), http(409), http(500), TIMEOUT, OFFLINE, new Error("401")]) {
    assert.equal(signedOut(e), false, String(e));
  }
});

test("noticeAction and the titles: Check for an unanswered attempt, Close for a finished tab, otherwise the normal confirm", () => {
  assert.equal(noticeAction("uncertain"), "check");
  assert.equal(noticeAction("elsewhere"), "close");
  assert.equal(noticeAction("gone"), "close");
  for (const k of ["refused", "changed", "open"] as const) assert.equal(noticeAction(k), "confirm", k);
  assert.deepEqual(NOTICE_TITLES, {
    refused: "Not settled",
    changed: "The bill changed",
    open: "Not settled yet",
    uncertain: "Couldn't confirm",
    elsewhere: "Already settled",
    gone: "Not settled",
  });
});

test("the kept wording: the other-device warning names the tab and the money, and says to check before giving change", () => {
  const other = order({ status: "Completed", payment: "Online", paidAmount: 540, tableNo: "4" });
  const msg = settledElsewhereMessage(other);
  assert.ok(msg.startsWith("Table 4 was already settled on another device (Online "), msg);
  assert.ok(msg.endsWith("Check before giving change."), msg);
  assert.equal(tabLabel(order({ tableNo: "4" })), "Table 4");
  assert.equal(tabLabel(order({ tableNo: undefined })), "ORD-20260928-001");
  assert.equal(settledMessage(DONE), "Order ORD-20260928-001 settled");
});

test("moneyEditedSince compares the operator's money state with the tab it was seeded from — each field flips it", () => {
  const tab = order({ discount: 50, discountKind: undefined, charges: [{ type: "table", label: "Table charge", amount: 40 }, { type: "extra", label: "Packing", amount: 20 }] } as Partial<Order>);
  const seeded = { discountRaw: 50, discountUnit: "₹", chargeOverride: undefined, extraCharges: [{ label: "Packing", amount: 20 }] };
  assert.equal(moneyEditedSince(seeded, tab), false, "exactly as seeded from the tab");
  assert.equal(moneyEditedSince({ ...seeded, discountRaw: 60 }, tab), true, "discount");
  assert.equal(moneyEditedSince({ ...seeded, discountUnit: "%" }, tab), true, "unit");
  assert.equal(moneyEditedSince({ ...seeded, discountUnit: "GST" }, tab), true, "a GST preset the tab does not carry");
  assert.equal(moneyEditedSince({ ...seeded, chargeOverride: 0 }, tab), true, "a waiver");
  assert.equal(moneyEditedSince({ ...seeded, extraCharges: [] }, tab), true, "an extra removed");
  assert.equal(moneyEditedSince({ ...seeded, extraCharges: [{ label: "Packing", amount: 25 }] }, tab), true, "an extra changed");
  const gstTab = order({ discount: 27, discountKind: "gst" } as Partial<Order>);
  assert.equal(moneyEditedSince({ discountRaw: 27, discountUnit: "GST", chargeOverride: undefined, extraCharges: [] }, gstTab), false, "the GST preset as seeded");
});
