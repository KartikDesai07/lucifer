import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Types } from "mongoose";

import { resolveDueAmount, foldDuesCollected } from "./due-payment";
import { duePaymentSchema } from "@/schemas";
import { DUES_RECEIPT_MODES, type SettlementPayMode } from "@/lib/constants";
import { ledgerContribution } from "./order";
import {
  recomputeCustomer,
  setReportFanout,
  setDuesPaidTotalFetcher,
  __setCustomerRollupDepsForTests,
} from "./customer-rollup";

// CR1.4 — the "customer dues that tally the drawer" step. Sections 1-5 below
// were WRITTEN BEFORE `lib/due-payment.ts` / `duePaymentSchema` existed (the
// item-1 repro: "dues collected are invisible" starts from there being no code
// path that reads a DuePayment at all) and are now GREEN against the landed
// G1-G3 implementation. Section 6 (source grep-pins, spec §6 item 6) and the
// `customer-rollup.test.ts` `$set`-shape update (spec §6 item 7) were deferred
// to a later agent at authoring time — both are now done, the grep-pins living
// in this file and the `$set`-shape update in `customer-rollup.test.ts` itself.
//
// THE §1 HAZARD this file is really about: once totalDue can be paid down by a
// DuePayment (a write OUTSIDE the Order collection), every writer that
// re-derives totalDue from Orders alone and $sets it will silently restore money
// already collected. There are exactly two such re-derivers —
// `customer-rollup.ts` `recomputeCustomer` (now `customer-recompute.ts`, split
// out by CR1.4 — see the source grep-pin below, which checks both possible
// locations) and `app/api/customers/[id]/reconcile/route.ts` — and CR1.3's
// lesson applies again: hardening one side is not hardening the pair.

afterEach(() => {
  // Defensive hygiene (customer-rollup.test.ts's own precedent) — this file's
  // recomputeCustomer tests mutate the same module-level DI seams other test
  // files in this suite (run sequentially in-process) also touch.
  setReportFanout(null);
  setDuesPaidTotalFetcher(null);
  __setCustomerRollupDepsForTests(null);
});

// ── shared fakes ──────────────────────────────────────────────────────────────

type WriterCall = { filter: Record<string, unknown>; update: Record<string, unknown> };

function installFakeCustomerWriter(): WriterCall[] {
  const calls: WriterCall[] = [];
  __setCustomerRollupDepsForTests({
    getCustomerWriter: async () => ({
      updateOne: async (filter, update) => {
        calls.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
    invalidateCustomersCache: () => {},
  });
  return calls;
}

// A hand-verified mirror of the FIXED reconcile aggregation (app/api/customers/
// [id]/reconcile/route.ts:40-74, read after G2.3 landed): `$match` excludes
// Cancelled orders, then zero-rates a held "Unpaid" tab too (mirroring
// `ledgerContribution` exactly, not just the Cancelled exclusion), and the
// caller subtracts `duesPaidTotal(customerId)` from the aggregated due before
// the `$set`. There is no DB-free seam on that route today (no
// `getCustomerWriter`-style injection point), so this mirror is the closest
// DB-free proxy available; it is NOT a substitute for a real parity pin. The
// real guards are the live leg (`verify-dues-live.ts`) and the source grep-pin
// in §6 below, both of which read the ACTUAL route source and would catch this
// mirror drifting off it.
function mirrorReconcileAggregate(
  orders: ReadonlyArray<{ total: number; paidAmount: number; status: string; payment?: string }>,
  duesPaid: number,
): number {
  const aggDue = orders
    .filter((o) => o.status !== "Cancelled")
    .reduce((sum, o) => {
      if (o.payment === "Unpaid") return sum;
      return sum + Math.max(0, o.total - o.paidAmount);
    }, 0);
  return Math.max(0, aggDue - duesPaid);
}

// ── 1. Repro — dues collected are invisible in the day summary ──────────────
// G2.4/G2.5 ("aggregate DuePayment... $group by $mode → fold into { total,
// count, byMode } in JS") need the SAME fold in two routes (orders/summary +
// reports); proposing it as one pure, reusable, DB-free export here rather than
// letting it duplicate. `byMode` must carry EVERY settlement mode (even at 0) —
// spec: "the drawer is physical", so a mode nobody used today must still show as
// a real zero, not be missing from the object.

test("foldDuesCollected on zero payments returns an honest all-zero shape, not an empty/absent object", () => {
  const result = foldDuesCollected([]);
  assert.equal(result.total, 0);
  assert.equal(result.count, 0);
  for (const mode of DUES_RECEIPT_MODES) {
    assert.equal(result.byMode[mode], 0, `${mode} must be present as an explicit 0, not missing`);
  }
});

test("foldDuesCollected sums total/count and buckets by mode — the day summary's duesCollected field (does not exist at all pre-fix)", () => {
  const rows: Array<{ mode: SettlementPayMode; amount: number }> = [
    { mode: "Cash", amount: 500 },
    { mode: "Online", amount: 200 },
    { mode: "Cash", amount: 100 },
  ];
  const result = foldDuesCollected(rows);
  assert.equal(result.total, 800, "a day's duesCollected.total must be non-zero when payments exist");
  assert.equal(result.count, 3);
  assert.deepEqual(result.byMode, { Cash: 600, Online: 200 });
});

// G7: a legacy row (written before this fix) can still carry a wide
// SettlementPayMode ("Due"/"Split"/"Credit") since the stored history stays
// on SETTLEMENT_PAY_MODES on purpose (models/DuePayment.ts) — total must
// still count that rupee, but byMode must not silently corrupt into NaN or
// grow an unrecognized key.
test("foldDuesCollected counts a legacy non-receipt mode row into total but not into byMode (no NaN, no extra key)", () => {
  const rows: Array<{ mode: SettlementPayMode; amount: number }> = [
    { mode: "Cash", amount: 500 },
    { mode: "Due", amount: 300 }, // pre-G7 bad row — the exact defect this fix closes
  ];
  const result = foldDuesCollected(rows);
  assert.equal(result.total, 800, "total must still count every rupee ever received, including legacy rows");
  assert.equal(result.count, 2);
  assert.deepEqual(result.byMode, { Cash: 500, Online: 0 }, "byMode must only bucket receipt-valid modes — a legacy mode has nowhere honest to go");
});

// ── 2. Dues resurrection guard (BOTH re-derivers, §1) — now GREEN ───────────

test("recomputeCustomer (the recompute AUTHORITY) subtracts duesPaidTotal before its $set — does not resurrect a due already paid down", async () => {
  const CUSTOMER = new Types.ObjectId();
  // Ledger fan-out says Rs 300 is still due (₹500 spend, ₹300 due, in paise).
  setReportFanout(async () => ({
    data: { visits: 1, spendPaise: 50000, duePaise: 30000 },
    partial: false,
  }));
  const calls = installFakeCustomerWriter();

  // Ground truth for this scenario: the customer already paid the FULL Rs 300
  // balance via a DuePayment, so the correct post-recompute totalDue is 0 — the
  // exact fix spec'd in CR1.4 §1/§4 ("$set totalDue: Math.max(0, totals.duePaise
  // / 100 - duesPaid)"). Faked via the DB-free seam (house rule #1) — real
  // duesPaidTotal is a CORE aggregate, not something a unit test should dial.
  const duesAlreadyPaid = 300;
  setDuesPaidTotalFetcher(async () => duesAlreadyPaid);
  const correctTotalDue = Math.max(0, 30000 / 100 - duesAlreadyPaid);
  assert.equal(correctTotalDue, 0, "sanity: the customer owes nothing more");

  const res = await recomputeCustomer(String(CUSTOMER));
  assert.equal(res.applied, true);
  const written = calls[0].update as { $set: { totalDue: number } };

  assert.equal(
    written.$set.totalDue,
    correctTotalDue,
    "recomputeCustomer must subtract duesPaidTotal() before its $set, or every recompute run resurrects paid-down dues",
  );
});

test("the reconcile route's aggregate (mirrored from its verified, FIXED source) no longer resurrects a due already paid down via a DuePayment", () => {
  const orders = [{ payment: "Cash" as const, total: 500, paidAmount: 200, status: "Completed" as const }];
  const ledgerDue = orders.reduce((sum, o) => sum + ledgerContribution(o).due, 0);
  assert.equal(ledgerDue, 300);

  const duesAlreadyPaid = 300; // the customer's whole remaining balance, paid off separately
  const correctTotalDue = Math.max(0, ledgerDue - duesAlreadyPaid);
  assert.equal(correctTotalDue, 0, "sanity: the customer owes nothing more");

  const mirroredWithoutSubtraction = mirrorReconcileAggregate(orders, 0);
  assert.equal(
    mirroredWithoutSubtraction,
    ledgerDue,
    "sanity: for a Completed-only dataset the aggregate before the dues subtraction agrees with ledgerContribution",
  );

  // THE FIX (G2.3): reconcile/route.ts subtracts duesPaidTotal() from the
  // aggregated due before its $set, so a fully-paid-down customer reconciles
  // to 0, not the resurrected full ledger due (Rs 300).
  const mirroredReconcileAggregate = mirrorReconcileAggregate(orders, duesAlreadyPaid);
  assert.equal(
    mirroredReconcileAggregate,
    correctTotalDue,
    "reconcile's aggregation must subtract duesPaidTotal(), or every reconcile run resurrects paid-down dues",
  );
});

// ── 3. Repro — a held "Unpaid" tab must not inflate the reconciled due ──────

test("ledgerContribution zero-rates a held Unpaid tab (the oracle reconcile's aggregation must mirror)", () => {
  const heldTab = { payment: "Unpaid" as const, total: 500, paidAmount: 0, status: "Pending" as const };
  assert.deepEqual(
    ledgerContribution(heldTab),
    { visits: 0, spend: 0, due: 0 },
    "a fired-but-unsettled tab is neither a sale nor a receivable yet",
  );
});

test("the reconcile route's aggregate (mirrored from its verified, FIXED source) zero-rates a held Unpaid tab's full total", () => {
  const heldTab = { payment: "Unpaid" as const, total: 500, paidAmount: 0, status: "Pending" as const };
  const settledOrder = { payment: "Cash" as const, total: 500, paidAmount: 200, status: "Completed" as const };
  const orders = [heldTab, settledOrder];

  const correctTotalDue = orders.reduce((sum, o) => sum + ledgerContribution(o).due, 0);
  assert.equal(correctTotalDue, 300, "the held tab contributes 0; only the settled order's shortfall (300) is a real due");

  // THE FIX (G2.3): the aggregation's `unlessZeroRated` now excludes a held
  // "Unpaid" tab exactly like ledgerContribution, so its full Rs 500
  // (max(0, 500-0)) no longer lands in the sum as if it were owed.
  const mirroredReconcileAggregate = mirrorReconcileAggregate(orders, 0);
  assert.equal(
    mirroredReconcileAggregate,
    correctTotalDue,
    "reconcile's aggregation must zero-rate payment===\"Unpaid\" exactly like ledgerContribution, or a held tab inflates the reconciled due",
  );
});

// ── 4. resolveDueAmount pure-function table ──────────────────────────────────
// NOTE on branch order: the spec lists the checks as "omitted -> balance",
// "over-balance -> error", "balance<=0 -> error" in that literal sequence, but
// read strictly in that order the third branch is unreachable for any positive
// `requested` (over-balance already catches it) and is bypassed entirely when
// `requested` is omitted (branch 1 returns first). The only reading under which
// all four listed behaviours are independently, unambiguously true is that a
// non-positive balance is a precondition failure regardless of `requested` —
// this table therefore tests ONLY input combinations whose correct observable
// outcome is unambiguous either way (never a balance<=0 + positive-requested
// combination, whose winning error message the spec does not pin down).

test("resolveDueAmount: requested omitted resolves to the full balance (\"pay in full\")", () => {
  assert.equal(resolveDueAmount({ balance: 300, requested: undefined }), 300);
});

test("resolveDueAmount: requested above the balance is refused as a mis-punch, not an overpayment", () => {
  assert.deepEqual(resolveDueAmount({ balance: 300, requested: 500 }), {
    error: "Payment exceeds the outstanding balance",
  });
});

test("resolveDueAmount: a customer with no outstanding balance is refused, even for the omitted (\"pay in full\") request", () => {
  assert.deepEqual(resolveDueAmount({ balance: 0, requested: undefined }), {
    error: "This customer has no outstanding dues",
  });
});

test("resolveDueAmount: a negative stored balance (defensive) is refused the same way as zero", () => {
  assert.deepEqual(resolveDueAmount({ balance: -50, requested: undefined }), {
    error: "This customer has no outstanding dues",
  });
});

test("resolveDueAmount: a requested amount within the balance passes through unchanged (a deliberate partial)", () => {
  assert.equal(resolveDueAmount({ balance: 300, requested: 100 }), 100);
});

test("resolveDueAmount: requested exactly equal to the balance passes through (paying in full, but explicitly)", () => {
  assert.equal(resolveDueAmount({ balance: 300, requested: 300 }), 300);
});

// ── 5. duePaymentSchema pins ──────────────────────────────────────────────────

const CLIENT_REF = "11111111-1111-1111-1111-111111111111";

test("duePaymentSchema: amount is .optional() — the CR1.2 regression guard applied to a new field. Omit = pay the full balance", () => {
  const parsed = duePaymentSchema.safeParse({ mode: "Cash", clientRef: CLIENT_REF });
  assert.equal(parsed.success, true, "amount must not be required — a client asserting a figure the server disagrees with turns a full payment into a silent partial");
  if (parsed.success) assert.equal(parsed.data.amount, undefined);
});

test("duePaymentSchema: amount rejects a fractional value (v1 money is whole rupees)", () => {
  const parsed = duePaymentSchema.safeParse({ mode: "Cash", clientRef: CLIENT_REF, amount: 100.5 });
  assert.equal(parsed.success, false);
});

test("duePaymentSchema: amount rejects zero and negative values (positive-only)", () => {
  assert.equal(duePaymentSchema.safeParse({ mode: "Cash", clientRef: CLIENT_REF, amount: 0 }).success, false);
  assert.equal(duePaymentSchema.safeParse({ mode: "Cash", clientRef: CLIENT_REF, amount: -50 }).success, false);
});

test("duePaymentSchema: amount accepts a positive integer", () => {
  const parsed = duePaymentSchema.safeParse({ mode: "Cash", clientRef: CLIENT_REF, amount: 250 });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.amount, 250);
});

test("duePaymentSchema: mode is restricted to DUES_RECEIPT_MODES (G7) — a due is RECEIVED only as Cash/Online", () => {
  // G7 repro: a dues payment is money ARRIVING, so "Due"/"Credit" (which mean
  // the OPPOSITE — "nothing collected now" — on an order, lib/order.ts:33-34)
  // and "Split" (no cash/online split fields on this path) must all be
  // rejected, or a receipt destroys the receivable and prints phantom cash.
  for (const mode of ["Due", "Credit", "Split", "Unpaid"] as const) {
    assert.equal(
      duePaymentSchema.safeParse({ mode, clientRef: CLIENT_REF }).success,
      false,
      `${mode} must NOT be a valid dues-receipt mode — G7`,
    );
  }
  for (const mode of DUES_RECEIPT_MODES) {
    assert.equal(
      duePaymentSchema.safeParse({ mode, clientRef: CLIENT_REF }).success,
      true,
      `${mode} is a valid dues-receipt mode and must parse`,
    );
  }
});

test("duePaymentSchema: clientRef is required and must be a UUID (the client-anchored idempotency key)", () => {
  assert.equal(duePaymentSchema.safeParse({ mode: "Cash" }).success, false, "clientRef must be required");
  assert.equal(
    duePaymentSchema.safeParse({ mode: "Cash", clientRef: "not-a-uuid" }).success,
    false,
    "a malformed clientRef must not silently parse",
  );
});

test("duePaymentSchema: .strict() rejects an unknown key", () => {
  const parsed = duePaymentSchema.safeParse({
    mode: "Cash",
    clientRef: CLIENT_REF,
    receivedBy: "Asha", // server-resolved from the session, never client input
  });
  assert.equal(parsed.success, false, ".strict() must reject a client-supplied receivedBy/anything else");
});

// ── 6. Source grep-pins (spec §6 item 6) ─────────────────────────────────────
// The repo's substitute for route tests: readFileSync over the ACTUAL route/
// module source, mirroring `settle-money.test.ts`'s PaymentModal-caller pin and
// `table-constants-pin.test.ts`'s consumer walk (same REPO_ROOT technique).
// These are the REAL guards the mirror-based tests in §2/§3 above explicitly
// defer to — a route file can drift out from under this file's DB-free proxies
// without either of THOSE tests noticing; these pins read the file itself.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PAYMENTS_ROUTE = "apps/cafe/app/api/customers/[id]/payments/route.ts";
const SETTLE_ROUTE = "apps/cafe/app/api/customers/[id]/settle/route.ts";
const RECONCILE_ROUTE = "apps/cafe/app/api/customers/[id]/reconcile/route.ts";
const DUE_PAYMENT_LIB = "apps/cafe/lib/due-payment.ts";
// recomputeCustomer's home already moved once WITHIN this step (CR1.4 split
// customer-rollup.ts -> customer-recompute.ts, re-exported unchanged) — check
// every plausible location rather than hardcode one, so a future re-split
// can't silently defeat this pin by moving the reference out from under it.
const CUSTOMER_ROLLUP_CANDIDATES = [
  "apps/cafe/lib/customer-rollup.ts",
  "apps/cafe/lib/customer-recompute.ts",
];
const RECEIVE_PAYMENT_DIALOG =
  "apps/cafe/components/customers/ReceivePaymentDialog.tsx";
const END_OF_DAY_SUMMARY = "apps/cafe/components/reports/EndOfDaySummary.tsx";

test("PIN: payments/route.ts (the staff-facing dues route) uses requireAuth, never requireAdmin", () => {
  const src = readSrc(PAYMENTS_ROUTE);
  assert.match(src, /\brequireAuth\s*\(/, "payments/route.ts must gate with requireAuth");
  assert.ok(
    !/\brequireAdmin\s*\(/.test(src),
    "payments/route.ts must NOT require admin — that would defeat the whole point of a staff-reachable dues route (the cashier who takes the cash must be able to record it)",
  );
});

test("PIN: settle/route.ts still uses requireAdmin — the admin-only pay-in-full path is unchanged", () => {
  const src = readSrc(SETTLE_ROUTE);
  assert.match(src, /\brequireAdmin\s*\(/, "settle/route.ts must still gate with requireAdmin");
});

test("PIN: both dues-collecting routes delegate to receiveDuePayment — one write path, no second one", () => {
  for (const rel of [PAYMENTS_ROUTE, SETTLE_ROUTE]) {
    const src = readSrc(rel);
    assert.match(
      src,
      /\breceiveDuePayment\s*\(/,
      `${rel} must call receiveDuePayment — a second, undelegated write path would fork the CAS-decrement/idempotency logic and reopen the resurrection hazard`,
    );
  }
});

test("PIN: receivedBy is stamped from session.user?.name on both routes, never from the request body", () => {
  for (const rel of [PAYMENTS_ROUTE, SETTLE_ROUTE]) {
    const src = readSrc(rel);
    assert.match(
      src,
      /receivedBy:\s*\w+\.session\.user\?\.name/,
      `${rel} must stamp receivedBy from the session, never a client-supplied name`,
    );
    // The exact regression this guards against: wiring receivedBy to a parsed
    // request-body field instead (the actor-stamping precedent this step must
    // not break — CLAUDE.md/spec §0 "always session.user?.name").
    assert.ok(
      !/receivedBy:\s*(parsed\.data|body|req)\b/.test(src),
      `${rel} must not take receivedBy from the parsed request body`,
    );
  }
});

test("PIN: receiveDuePayment's CAS filter carries totalDue: { $gte: — the over-collection guard cannot be silently dropped", () => {
  const src = readSrc(DUE_PAYMENT_LIB);
  assert.match(
    src,
    /totalDue:\s*\{\s*\$gte:/,
    "receiveDuePayment's CAS filter must guard on totalDue: { $gte: resolved } — an unguarded decrement (the old settle route's findByIdAndUpdate) lets two concurrent full-balance payments drive totalDue negative",
  );
});

test("PIN: both §1 re-derivers (reconcile/route.ts AND the recompute authority) reference duesPaidTotal — the CR1.3 reciprocal-guard lesson, applied", () => {
  const reconcileSrc = readSrc(RECONCILE_ROUTE);
  assert.match(
    reconcileSrc,
    /duesPaidTotal/,
    "reconcile/route.ts must reference duesPaidTotal, or every reconcile run resurrects a paid-down due",
  );

  const authorityFile = CUSTOMER_ROLLUP_CANDIDATES.find(
    (rel) =>
      existsSync(path.join(REPO_ROOT, rel)) &&
      /export\s+async\s+function\s+recomputeCustomer\b/.test(readSrc(rel)),
  );
  assert.ok(
    authorityFile,
    `recomputeCustomer must be found in one of: ${CUSTOMER_ROLLUP_CANDIDATES.join(", ")} — update this pin's candidate list if it moved again`,
  );
  assert.match(
    readSrc(authorityFile as string),
    /duesPaidTotal/,
    // Hardening only ONE side of this pair is exactly the mistake CR1.3
    // shipped — guarding the route above without also guarding the authority
    // (or vice versa) leaves the other re-deriver free to resurrect the due.
    `${authorityFile} defines recomputeCustomer but never references duesPaidTotal — every recompute run would resurrect a paid-down due`,
  );
});

test("PIN: ReceivePaymentDialog always sends the operator's counted amount, never omits it against its own frozen balance snapshot (F0) — an omitted amount lets the server resolve to ITS fresher balance instead of the cash actually taken, forgiving real receivables while the drawer tally still prints the bigger number", () => {
  const src = readSrc(RECEIVE_PAYMENT_DIALOG);
  assert.match(
    src,
    /amount:\s*amountValue/,
    "ReceivePaymentDialog must always send `amount: amountValue` — the drawer count is the one figure the server has no source for, unlike CR1.2's order-total case which the server can re-derive itself",
  );
  assert.ok(
    !/amountValue\s*!==\s*customer\.totalDue/.test(src),
    "ReceivePaymentDialog must not gate `amount` on comparing amountValue to customer.totalDue — that balance is a frozen snapshot (captured at row-click/dialog-open, never refreshed while open); omitting amount whenever it happens to match lets a SECOND terminal's since-elapsed payment turn into the server silently collecting its own larger fresh balance instead of the cash actually counted",
  );
});

test("PIN: EndOfDaySummary's dues-collected section iterates DUES_RECEIPT_MODES, not the wide SETTLEMENT_PAY_MODES (G7) — a Due/Split/Credit dues line would misrepresent what a drawer tally can attribute", () => {
  const src = readSrc(END_OF_DAY_SUMMARY);
  assert.match(
    src,
    /Dues collected<\/SectionTitle>[\s\S]{0,40}\{DUES_RECEIPT_MODES\.map\(/,
    "the 'Dues collected' section must map over DUES_RECEIPT_MODES right after its SectionTitle — a revert to SETTLEMENT_PAY_MODES here would put Due/Split/Credit back on the drawer slip",
  );
  // The ORDER payment-breakdown section above it legitimately keeps the wide
  // enum — this pin only checks the dues section didn't regress, not that
  // SETTLEMENT_PAY_MODES is gone from the file entirely.
  assert.match(
    src,
    /Payments collected<\/SectionTitle>[\s\S]{0,40}\{SETTLEMENT_PAY_MODES\.map\(/,
    "the ORDER payment-breakdown section must still iterate SETTLEMENT_PAY_MODES — unrelated to the G7 dues fix",
  );
});

// ── 7. Source grep-pins — F5 coverage gap: `duesCollected` is emitted by two
// routes but exercised by nothing (arbiter finding, CR1.4 F5). tsc cannot
// catch a deletion/rename here: both routes build an inferred object literal
// passed to `success(data: unknown, status = 200)` (packages/shared/src/
// api.ts), so `OrderSummary.duesCollected` / `Report.totals.duesCollected`
// (packages/shared/src/types.ts) are never structurally checked at the route.
// The UI reads (EndOfDaySummary.tsx, reports/page.tsx) use optional chaining
// over those REQUIRED fields and would silently render Rs 0 instead of
// failing. These pins read the ACTUAL route source (readFileSync) so a
// deletion/rename of either emit site fails the suite.

const ORDERS_SUMMARY_ROUTE = "apps/cafe/app/api/orders/summary/route.ts";
const REPORTS_ROUTE = "apps/cafe/app/api/reports/route.ts";

test("PIN: orders/summary/route.ts aggregates DuePayment and emits duesCollected from the fold — without this the EOD slip silently prints Rs 0 and the drawer can never tally; tsc cannot catch it because success() takes `unknown`", () => {
  const src = readSrc(ORDERS_SUMMARY_ROUTE);
  assert.match(
    src,
    /\bDuePayment\.aggregate\s*<[^>]*>\s*\(/,
    "orders/summary/route.ts must run a real DuePayment.aggregate — without it there is no source of today's dues payments to fold",
  );
  assert.match(
    src,
    /duesCollected:\s*foldDuesCollected\(/,
    "orders/summary/route.ts must emit `duesCollected: foldDuesCollected(...)` on the summary object — without this the EOD slip silently prints Rs 0 and the drawer can never tally; tsc cannot catch it because success() takes `unknown`",
  );
});

test("PIN: reports/route.ts aggregates DuePayment bounded by the report's own [start,end] range and emits duesCollected into totals — without this the report's dues line silently prints Rs 0; tsc cannot catch it because success() takes `unknown`", () => {
  const src = readSrc(REPORTS_ROUTE);
  assert.match(
    src,
    /const\s*\{\s*start\s*\}\s*=\s*dayRange\(new Date\(startDate\)\)/,
    "reports/route.ts must derive `start` from the report's own startDate — not a hardcoded 'today' window",
  );
  assert.match(
    src,
    /const\s*\{\s*end\s*\}\s*=\s*dayRange\(new Date\(endDate\)\)/,
    "reports/route.ts must derive `end` from the report's own endDate — not a hardcoded 'today' window",
  );
  assert.match(
    src,
    /\bDuePayment\.aggregate\s*<[^>]*>\s*\(\s*\[\s*\{\s*\$match:\s*\{\s*createdAt:\s*\{\s*\$gte:\s*start,\s*\$lte:\s*end\s*\}\s*\}\s*\}/,
    "reports/route.ts must run DuePayment.aggregate bounded by the report's own [start, end] range, not today's window",
  );
  assert.match(
    src,
    /duesCollected:\s*duesCollectedRows\[0\]\?\.total\s*\?\?\s*0/,
    "reports/route.ts must emit `duesCollected` into totals — without this the report's dues line silently prints Rs 0; tsc cannot catch it because success() takes `unknown`",
  );
});
