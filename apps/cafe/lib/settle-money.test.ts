import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ledgerContribution, resolveSettleMoney, type SettleMoneyInput } from "./order";
import { settleOrderSchema, createOrderSchema } from "@/schemas";
import { collectedAmount } from "@/lib/payment-result";

// CR1.2 — failing-repro leg for two confirmed money bugs at settle. These tests
// are written against the FIX's surface (a `resolveSettleMoney` pure function, a
// 5th `derivePayment` param, and two new optional `settleOrderSchema` keys) that
// does NOT exist yet — they are EXPECTED RED until that lands (the fix itself is
// a separate step; this file only pins the failing-for-the-right-reason repro +
// the regression guards the fix must preserve).
//
//   BUG 1 — a resumed tab's discount is silently dropped at settle:
//     order.schema.ts:88-95 `settleOrderSchema` is `.strict()` with no `discount`
//     key (rejected outright), and settle/route.ts:47 prices against the STORED
//     total, so the bill charges full while the POS cart footer shows a discount.
//   BUG 2 — no partial payment; a short payment can never become a customer due:
//     order.ts:18-38 `derivePayment` returns `{paidAmount: total}` for Cash/Online
//     unconditionally. The dues machinery (`ledgerContribution` due = max(0,
//     total-paidAmount), mirrored by the reconcile route's aggregation) already
//     supports a truthful partial paidAmount — it just never gets one.

const GST_OFF = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" as const };

// A one-line tab: a single item priced at the tab's total, no order-level
// discount recorded at open, no GST snapshot (so gstConfigFromOrder falls back
// to whatever liveGst the test passes in — exercised explicitly below).
function tab(total: number, over: Partial<SettleMoneyInput["order"]> = {}): SettleMoneyInput["order"] {
  return {
    items: [{ price: total, qty: 1 }],
    total,
    discount: 0,
    ...over,
  };
}

// ── BUG 1 repro — schema silently drops a settle-time discount ───────────────

test("settleOrderSchema accepts a settle-time discount instead of silently dropping it (BUG 1)", () => {
  const parsed = settleOrderSchema.safeParse({ payment: "Cash", discount: 100 });
  assert.equal(parsed.success, true, "a discount at settle must not be rejected by .strict()");
  if (parsed.success) assert.equal(parsed.data.discount, 100);
});

test("settleOrderSchema accepts a paidAmount for a partial settle (BUG 2)", () => {
  const parsed = settleOrderSchema.safeParse({ payment: "Cash", paidAmount: 400 });
  assert.equal(parsed.success, true, "a collected amount less than the total must not be rejected by .strict()");
  if (parsed.success) assert.equal(parsed.data.paidAmount, 400);
});

test("settleOrderSchema still rejects a genuinely unknown key (.strict() survives the new keys)", () => {
  const parsed = settleOrderSchema.safeParse({ payment: "Cash", bogus: 1 });
  assert.equal(parsed.success, false, "unrelated unknown keys must still be rejected");
});

// ── BUG 1 repro — the settle-time discount must actually reduce what's charged ─

test("a Rs 500 tab settled with a Rs 100 settle-time discount charges Rs 400, not Rs 500 (BUG 1)", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Cash",
    discount: 100,
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result), "must not error");
  if ("error" in result) return;
  assert.equal(result.total, 400, "the settle-time discount must be applied to what's charged");
  assert.equal(result.paidAmount, 400, "Cash settles in full against the DISCOUNTED total, not the stored one");
  assert.ok(result.totals, "a discount was supplied so totals must be recomputed");
  assert.equal(result.totals?.discount, 100);
});

// ── BUG 2 repro — a short cash payment becomes a customer due, not free money ─

test("a Rs 500 tab settled Cash with only Rs 400 collected leaves Rs 100 due, not silently full-paid (BUG 2)", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Cash",
    paidAmount: 400,
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.paidAmount, 400, "only what was actually collected is recorded as paid");
  assert.equal(result.leavesDue, true, "an underpayment must be flagged as leaving a due");

  const contribution = ledgerContribution({
    payment: "Cash",
    total: result.total,
    paidAmount: result.paidAmount,
    status: "Completed",
  });
  assert.equal(contribution.due, 100, "the remainder must land on the customer ledger via the EXISTING formula");
});

// ── Regression guards — must stay green BEFORE and AFTER the fix ─────────────

test("discount omitted at settle leaves the stored total untouched (Orders-page settle, unchanged)", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Cash",
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.totals, null, "no discount supplied -> no recompute, exactly today's behavior");
  assert.equal(result.total, 500, "the stored total is charged exactly as today");
});

test("Split cash+online must still sum to exactly the total, or the settle is rejected", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Split",
    splitCash: 200,
    splitOnline: 200,
    liveGst: GST_OFF,
  });
  assert.ok("error" in result, "200+200 !== 500 must error, not silently under-collect");
});

test("Split ignores paidAmount — partial payment is not allowed for a split settle", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Split",
    splitCash: 300,
    splitOnline: 200,
    paidAmount: 100, // must be ignored — Split cannot go partial
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.paidAmount, 500, "Split always equals the total; paidAmount is ignored");
  assert.equal(result.splitCash, 300);
  assert.equal(result.splitOnline, 200);
  assert.equal(result.leavesDue, false);
});

test("Due settles at paidAmount=0 and always leaves the full total as a due", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Due",
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.paidAmount, 0);
  assert.equal(result.leavesDue, true);
});

test("Credit settles at paidAmount=0 and always leaves the full total as a due", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Credit",
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.paidAmount, 0);
  assert.equal(result.leavesDue, true);
});

test("Cash tendered above the total is change, not overpayment — paidAmount clamps to the total", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Cash",
    paidAmount: 700,
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.paidAmount, 500, "clamped to the total — the extra 200 is change, not revenue");
  assert.equal(result.leavesDue, false);
});

test("a settle-time discount larger than the subtotal clamps to zero — no customer is demanded on a free bill", () => {
  const result = resolveSettleMoney({
    order: tab(500),
    payment: "Cash",
    discount: 9999,
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.total, 0, "discount clamps to the subtotal, never negative");
  assert.equal(result.leavesDue, false, "a Rs 0 bill can never leave a due");
});

test("exclusive GST is recomputed on the DISCOUNTED base, not the original subtotal", () => {
  const EXCLUSIVE_5PC = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" as const };
  const result = resolveSettleMoney({
    order: tab(1000),
    payment: "Cash",
    discount: 200,
    liveGst: EXCLUSIVE_5PC,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.totals?.gstAmount, 40, "5% of the discounted Rs 800 base, not the Rs 1000 subtotal");
  assert.equal(result.total, 840);
});

// ── CR1.2 regression — arbiter-confirmed fixes to the above fix ──────────────
// PaymentModal.confirm() always sent a number, so "omit = pay in full" was
// never exercised by any client: a client/server total disagreement misread a
// FULL payment as a PARTIAL one (false "select a customer" 400s on plain cash
// sales; a stale settle silently booking a customer due). Fixed by making
// "paid in full" explicit end-to-end via `collectedAmount`.

test("collectedAmount sends undefined for a full payment, the exact number for a deliberate partial", () => {
  assert.equal(
    collectedAmount({ payment: "Cash", paidAmount: 500, partial: false }),
    undefined,
    "a full payment must omit paidAmount so the server prices its OWN total",
  );
  assert.equal(
    collectedAmount({ payment: "Cash", paidAmount: 400, partial: true }),
    400,
    "a deliberate partial still asserts the collected amount",
  );
});

test("a stale client view (paidAmount omitted) settles in FULL against a fresher, higher stored total", () => {
  const result = resolveSettleMoney({
    order: tab(800), // the server's fresh total — higher than whatever the client last saw
    payment: "Cash",
    liveGst: GST_OFF,
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.paidAmount, 800, "omitted paidAmount always pays the server's OWN total in full");
  assert.equal(result.leavesDue, false, "a stale client view must never manufacture a due");
});

test("createOrderSchema parses with paidAmount omitted, and still parses when it is supplied", () => {
  const base = {
    customerName: "Walk-In",
    items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [] }],
    subtotal: 20,
    total: 20,
    payment: "Cash" as const,
    receiver: "Staff",
  };
  const omitted = createOrderSchema.safeParse(base);
  assert.equal(omitted.success, true, "paidAmount must be optional — omit = pay in full");

  const supplied = createOrderSchema.safeParse({ ...base, paidAmount: 20 });
  assert.equal(supplied.success, true, "an explicit paidAmount must still parse");
});

test("settleOrderSchema accepts the optional total echo and still rejects an unknown key", () => {
  const withTotal = settleOrderSchema.safeParse({ payment: "Cash", paidAmount: 400, total: 500 });
  assert.equal(withTotal.success, true, "the total echo must not be rejected by .strict()");
  if (withTotal.success) assert.equal(withTotal.data.total, 500);

  const bogus = settleOrderSchema.safeParse({ payment: "Cash", total: 500, bogus: 1 });
  assert.equal(bogus.success, false, "unrelated unknown keys must still be rejected");
});

// ── Wiring pin — the rule above is only worth anything if every caller uses it ─
// The CR1.2 review found a FULL payment being misread as a partial one whenever
// the client's total disagreed with the server's (stale GST settings, or a tab
// another device had changed): a hard 400 on an ordinary cash sale, or a silent
// customer due. The rule is `collectedAmount()`; the bug was a caller sending
// the modal's raw number instead. Unit tests cannot catch that — there is no
// React test framework here and routes are not tested directly — so this is a
// grep-pin over the real source (same technique as table-constants-pin.test.ts).

test("every PaymentModal caller sends collectedAmount(result), never the raw result.paidAmount", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  // The only two components that hand a PaymentResult to a mutation.
  const CALLERS = [
    "apps/cafe/hooks/use-pos-tab.ts",
    "apps/cafe/components/orders/OrderDetailSheet.tsx",
  ];
  const offenders: string[] = [];
  for (const rel of CALLERS) {
    const src = readFileSync(path.join(repoRoot, rel), "utf8");
    // A bare `paidAmount: result.paidAmount` is the exact regression.
    if (/paidAmount:\s*result\.paidAmount/.test(src)) offenders.push(rel);
    assert.match(
      src,
      /paidAmount:\s*collectedAmount\(result\)/,
      `${rel} must send paidAmount via collectedAmount(result)`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "a caller sends the modal's raw paidAmount — a full payment there becomes a silent partial + customer due",
  );
});
