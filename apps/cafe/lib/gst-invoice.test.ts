// Print customization S10-B: which bills are GST tax invoices and which numbers a paid bill still needs. The rule is
// the ORDER'S OWN gst snapshot — never live settings — and ONE plan serves the settle route, the create route, the
// create replay and the POS settle flow (K1). Pure, DB-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import {
  NO_LIVE_GST,
  billNumberingPlan,
  invoicePending,
  isTaxInvoice,
  numbersPending,
  planHasWork,
  type BillNumberingPlan,
  type NumberableOrder,
} from "./gst-invoice";

const CREATED_AT = new Date("2027-03-31T18:29:59.000Z"); // 23:59:59 IST on 31 March: the last second of FY 2026
const START = 100;
const RESET = 240;

// A paid GST (exclusive 5%) order, and the same tab with no GST snapshot at all.
const GST_BASE = { total: 105, gstMode: "exclusive" as const, gstRate: 5, gstAmount: 5 };
const PLAIN_BASE = { total: 100 };

function order(over: Partial<NumberableOrder> = {}): NumberableOrder {
  return { status: "Completed", createdAt: CREATED_AT, ...GST_BASE, ...over };
}
function plain(over: Partial<NumberableOrder> = {}): NumberableOrder {
  return { status: "Completed", createdAt: CREATED_AT, ...PLAIN_BASE, ...over };
}
const series = (showNumber: boolean) => ({ showNumber, numberStart: START, resetMinutes: RESET });

// -- isTaxInvoice: the snapshot only ------------------------------------------------------------

test("NO_LIVE_GST: the live fallback is GST off, so only a snapshot can make a tax invoice", () => {
  assert.equal(NO_LIVE_GST.gstEnabled, false);
  assert.equal(NO_LIVE_GST.gstRate, 0);
});

test("isTaxInvoice: an exclusive snapshot with a GST amount is a tax invoice; exclusive with 0 GST is not", () => {
  assert.equal(isTaxInvoice({ total: 105, gstMode: "exclusive", gstRate: 5, gstAmount: 5 }), true);
  assert.equal(isTaxInvoice({ total: 100, gstMode: "exclusive", gstRate: 5, gstAmount: 0 }), false, "GST was on, but none was charged");
  assert.equal(isTaxInvoice({ total: 100, gstMode: "exclusive", gstRate: 5 }), false, "no gstAmount key at all");
});

test("isTaxInvoice: an inclusive snapshot with a rate is a tax invoice; rate 0 is not", () => {
  assert.equal(isTaxInvoice({ total: 105, gstMode: "inclusive", gstRate: 5 }), true);
  assert.equal(isTaxInvoice({ total: 105, gstMode: "inclusive", gstRate: 0 }), false);
  assert.equal(isTaxInvoice({ total: 105, gstMode: "exclusive", gstRate: 0, gstAmount: 5 }), false, "a zero rate wins over a stray amount");
});

test("isTaxInvoice: an order with no gstMode snapshot is NOT a tax invoice, even though a live config would say GST on", () => {
  const legacy = { total: 105, gstRate: 5, gstAmount: 5 }; // placed before snapshots existed
  const liveOn: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
  // Landmark: with a LIVE GST-on config receiptGst WOULD show GST for this order, so the false below is the rule, not the data.
  assert.equal(receiptGst(legacy, liveOn).show, true);
  assert.equal(isTaxInvoice(legacy), false);
  assert.equal(isTaxInvoice({ total: 100 }), false);
});

// -- invoicePending / billNumberingPlan -----------------------------------------------------------

test("invoicePending: only a Completed GST bill that holds no invoice", () => {
  assert.equal(invoicePending(order()), true, "landmark");
  assert.equal(invoicePending(order({ invoiceNumber: 1, invoiceFy: 2026 })), false, "already holds it");
  assert.equal(invoicePending(plain()), false, "not a GST bill");
  assert.equal(invoicePending(order({ status: "Pending" })), false);
  assert.equal(invoicePending(order({ status: "Cancelled" })), false);
});

test("billNumberingPlan: an order that is not Completed takes nothing, whatever its GST or settings", () => {
  for (const status of ["Pending", "Cancelled"]) {
    for (const showNumber of [true, false]) {
      assert.deepEqual(billNumberingPlan(order({ status }), series(showNumber)), {}, `${status} showNumber=${showNumber}`);
    }
  }
  // Landmark: the same order, Completed, DOES have work, so the {} above is the status check and not a dead input.
  assert.equal(planHasWork(billNumberingPlan(order({ status: "Completed" }), series(true))), true);
});

test("billNumberingPlan: the 16-cell matrix (Show bill number x bill held x GST x invoice held) draws exactly what is missing", () => {
  let cells = 0;
  let withWork = 0;
  for (const showNumber of [true, false]) {
    for (const billHeld of [true, false]) {
      for (const gst of [true, false]) {
        for (const invoiceHeld of [true, false]) {
          const o = (gst ? order : plain)({
            ...(billHeld ? { billNumber: 17 } : {}),
            ...(invoiceHeld ? { invoiceNumber: 4, invoiceFy: 2026 } : {}),
          });
          const label = `show=${showNumber} billHeld=${billHeld} gst=${gst} invoiceHeld=${invoiceHeld}`;
          const plan = billNumberingPlan(o, series(showNumber));
          const wantBill = showNumber && !billHeld;
          const wantInvoice = gst && !invoiceHeld;
          assert.equal("bill" in plan, wantBill, `${label}: bill`);
          assert.equal("invoiceAt" in plan, wantInvoice, `${label}: invoiceAt`);
          assert.equal(planHasWork(plan), wantBill || wantInvoice, `${label}: planHasWork`);
          cells += 1;
          if (wantBill || wantInvoice) withWork += 1;
        }
      }
    }
  }
  assert.equal(cells, 16);
  assert.equal(withWork, 7, "landmark: 7 of the 16 cells have something to draw (the other 9 need neither number or hold it already)");
});

test("billNumberingPlan: a GST bill ALWAYS takes its invoice, with 'Show bill number' off (the invoice is not gated on the daily number)", () => {
  const plan = billNumberingPlan(order(), series(false));
  assert.deepEqual(plan, { invoiceAt: CREATED_AT });
  assert.equal("bill" in plan, false, "and no daily number is drawn");
  // Landmark: with it on, the same bill takes BOTH.
  assert.deepEqual(Object.keys(billNumberingPlan(order(), series(true))).sort(), ["bill", "invoiceAt"]);
});

test("billNumberingPlan: a non-GST bill never takes an invoice, in a numbered or unnumbered cafe", () => {
  assert.equal("invoiceAt" in billNumberingPlan(plain(), series(true)), false);
  assert.deepEqual(billNumberingPlan(plain(), series(false)), {}, "and with numbering off there is nothing at all");
  assert.equal("bill" in billNumberingPlan(plain(), series(true)), true, "landmark: the daily number is still drawn for it");
});

test("billNumberingPlan: invoiceAt is the order's createdAt instant (Date or ISO string), a Date either way", () => {
  const fromDate = billNumberingPlan(order({ createdAt: CREATED_AT }), series(false)).invoiceAt;
  assert.ok(fromDate instanceof Date);
  assert.equal(fromDate.getTime(), CREATED_AT.getTime());
  const fromString = billNumberingPlan(order({ createdAt: CREATED_AT.toISOString() }), series(false)).invoiceAt;
  assert.ok(fromString instanceof Date, "an ISO string becomes a Date");
  assert.equal(fromString.getTime(), CREATED_AT.getTime());
  // The instant is NOT the payment moment: a different createdAt gives a different instant.
  const other = new Date("2026-08-01T06:00:00.000Z");
  assert.equal(billNumberingPlan(order({ createdAt: other }), series(false)).invoiceAt?.getTime(), other.getTime());
});

test("billNumberingPlan: the bill series carries EXACTLY { numberStart, resetMinutes } — never showNumber, never anything else", () => {
  const plan = billNumberingPlan(order(), series(true));
  assert.deepEqual(plan.bill, { numberStart: START, resetMinutes: RESET });
  assert.deepEqual(Object.keys(plan.bill ?? {}).sort(), ["numberStart", "resetMinutes"]);
  const wide = billNumberingPlan(order(), { ...series(true), extra: "x" } as ReturnType<typeof series>);
  assert.deepEqual(Object.keys(wide.bill ?? {}).sort(), ["numberStart", "resetMinutes"], "extra keys on the settings object do not leak through");
});

test("billNumberingPlan follows the order's snapshot: a legacy order with no gstMode never takes an invoice (the plan has no live-settings input)", () => {
  assert.equal(billNumberingPlan.length, 2, "(order, bill): there is no third, live-GST argument to follow");
  const legacy = order({ gstMode: undefined });
  assert.equal("invoiceAt" in billNumberingPlan(legacy, series(true)), false);
  assert.equal("bill" in billNumberingPlan(legacy, series(true)), true, "landmark: the plan still ran for it");
});

test("billNumberingPlan: an inclusive-GST bill takes an invoice too", () => {
  const inclusive = order({ gstMode: "inclusive", gstRate: 5, gstAmount: undefined, total: 105 });
  assert.equal("invoiceAt" in billNumberingPlan(inclusive, series(false)), true);
});

test("billNumberingPlan: a missing createdAt (never on a stored order) still gives a Date near now, not an Invalid Date", () => {
  const before = Date.now();
  const at = billNumberingPlan(order({ createdAt: undefined }), series(false)).invoiceAt;
  const after = Date.now();
  assert.ok(at instanceof Date && !Number.isNaN(at.getTime()));
  assert.ok(at.getTime() >= before && at.getTime() <= after);
});

// -- numbersPending (K1) ----------------------------------------------------------------------

test("numbersPending: a paid bill waits for the bill number it should hold, or the invoice it should hold", () => {
  // bill numbered cafe, bill number missing
  assert.equal(numbersPending(plain(), true), true);
  assert.equal(numbersPending(plain({ billNumber: 5 }), true), false, "held");
  // non-numbered, non-GST cafe: nothing to wait for
  assert.equal(numbersPending(plain(), false), false);
  // GST, invoice missing: waits EVEN WITH billNumbered false
  assert.equal(numbersPending(order(), false), true);
  assert.equal(numbersPending(order({ billNumber: 5 }), true), true, "the daily number is held but the invoice is not");
  assert.equal(numbersPending(order({ invoiceNumber: 1, invoiceFy: 2026 }), false), false, "the invoice is held");
  assert.equal(numbersPending(order({ invoiceNumber: 1, invoiceFy: 2026 }), true), true, "the invoice is held but the daily number is not");
  assert.equal(numbersPending(order({ invoiceNumber: 1, invoiceFy: 2026, billNumber: 5 }), true), false, "both held");
});

test("numbersPending: the invoice half needs a Completed order (a pending GST tab is not waiting for an invoice)", () => {
  assert.equal(numbersPending(order({ status: "Pending" }), false), false);
  assert.equal(numbersPending(order({ status: "Completed" }), false), true, "landmark");
});

// -- planHasWork ------------------------------------------------------------------------------

test("planHasWork: false only for the empty plan", () => {
  const empty: BillNumberingPlan = {};
  assert.equal(planHasWork(empty), false);
  assert.equal(planHasWork({ bill: { numberStart: 1, resetMinutes: 0 } }), true);
  assert.equal(planHasWork({ invoiceAt: CREATED_AT }), true);
  assert.equal(planHasWork({ bill: { numberStart: 1, resetMinutes: 0 }, invoiceAt: CREATED_AT }), true);
});
