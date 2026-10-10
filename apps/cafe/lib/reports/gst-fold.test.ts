// gstOfBill / foldGstReport — pure, DB-free. gstOfBill CALLS receiptGst() and
// its own identity (taxable+gst+noGst+charges===total) is asserted against
// EVERY case, never independently recomputed. A source pin (last test) proves
// gst-fold.ts really calls receiptGst rather than re-deriving its rule —
// mutation-tested: temporarily broken, observed red, restored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { foldGstReport, gstOfBill, type GstOrderView } from "@/lib/reports/gst-fold";
import { stripComments } from "@/lib/source-pin-utils";
import { receiptGst, type GstConfig } from "@/lib/receipt";

const INCLUSIVE_5: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "inclusive" };
const EXCLUSIVE_5: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
const GST_OFF: GstConfig = { gstEnabled: false, gstRate: 5, gstMode: "exclusive" };

function order(over: Partial<GstOrderView> & { total: number }): GstOrderView {
  return { orderId: "ORD-1", createdAt: new Date("2026-09-29T10:00:00Z"), status: "Completed", ...over };
}

function assertIdentity(o: GstOrderView, b: ReturnType<typeof gstOfBill>) {
  assert.ok(
    Math.abs(b.taxable + b.gst + b.noGst + b.charges - o.total) < 1e-9,
    `identity failed: ${b.taxable}+${b.gst}+${b.noGst}+${b.charges} !== ${o.total}`,
  );
}

test("gstOfBill: inclusive 5% — snapshot mode wins over live config", () => {
  const o = order({ total: 1050, gstMode: "inclusive", gstRate: 5 });
  const b = gstOfBill(o, EXCLUSIVE_5); // live config disagrees; snapshot must win
  assert.equal(b.inclusive, true);
  assert.equal(b.rate, 5);
  assertIdentity(o, b);
});

test("gstOfBill: exclusive 5% with gstAmount > 0 — taxable = (total - charges) - gst", () => {
  const o = order({ total: 1050, gstMode: "exclusive", gstRate: 5, gstAmount: 50 });
  const b = gstOfBill(o, INCLUSIVE_5);
  assert.equal(b.inclusive, false);
  assert.equal(b.gst, 50);
  assert.equal(b.taxable, 1000);
  assertIdentity(o, b);
});

test("gstOfBill: exclusive mode with gstAmount 0 (pre-GST order) -> falls to noGst, not a false taxable line", () => {
  const o = order({ total: 500, gstMode: "exclusive", gstRate: 5, gstAmount: 0 });
  const b = gstOfBill(o, INCLUSIVE_5);
  assert.equal(b.rate, 0);
  assert.equal(b.gst, 0);
  assert.equal(b.noGst, 500);
  assertIdentity(o, b);
});

test("gstOfBill: legacy order (no gstMode snapshot) falls back to the live config", () => {
  const o = order({ total: 1050 }); // no gstMode/gstRate/gstAmount at all
  const b = gstOfBill(o, INCLUSIVE_5);
  assert.equal(b.rate, 5);
  assert.equal(b.inclusive, true);
  assertIdentity(o, b);
});

test("gstOfBill: GST disabled (live config) on a legacy order -> the whole bill is noGst", () => {
  const o = order({ total: 300 });
  const b = gstOfBill(o, GST_OFF);
  assert.equal(b.rate, 0);
  assert.equal(b.noGst, 300);
  assertIdentity(o, b);
});

test("gstOfBill: a table charge / extras are lifted out before tax — never counted as taxable or noGst", () => {
  const o = order({ total: 1100, gstMode: "exclusive", gstRate: 5, gstAmount: 50, chargeAmount: 50 });
  const b = gstOfBill(o, INCLUSIVE_5);
  assert.equal(b.charges, 50);
  assert.equal(b.taxable, 1000); // (1100 - 50) - 50
  assertIdentity(o, b);

  const noGstWithCharge = order({ total: 350, gstMode: "exclusive", gstRate: 5, gstAmount: 0, chargeAmount: 50 });
  const b2 = gstOfBill(noGstWithCharge, INCLUSIVE_5);
  assert.equal(b2.noGst, 300); // total - charges, charges excluded
  assert.equal(b2.charges, 50);
  assertIdentity(noGstWithCharge, b2);
});

test("gstOfBill: equals receiptGst's own numbers exactly, byte for byte", () => {
  const o = order({ total: 1050, gstMode: "inclusive", gstRate: 5 });
  const b = gstOfBill(o, EXCLUSIVE_5);
  // Independently call receiptGst to cross-check (not how gst-fold computes
  // it — this test proves the WRAPPER's output, not its internal call).
  const g = receiptGst(o, EXCLUSIVE_5);
  assert.equal(b.taxable, g.taxable);
  assert.equal(b.gst, g.gstAmount);
  assert.equal(b.rate, g.rate);
  assert.equal(b.inclusive, g.inclusive);
});

// ── foldGstReport ────────────────────────────────────────────────────────────

test("foldGstReport: docs per day — numbered/cancelled/unnumbered/first/last, zero-filled days included", () => {
  const orders: GstOrderView[] = [
    order({ orderId: "A", total: 500, billNumber: 3, status: "Completed" }),
    order({ orderId: "B", total: 600, billNumber: 5, status: "Completed" }),
    order({ orderId: "C", total: 700, billNumber: 4, status: "Cancelled" }), // cancelled AFTER billing
    order({ orderId: "D", total: 200, status: "Completed" }), // unnumbered
  ];
  const report = foldGstReport({ range: { from: "2026-09-28", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: false });
  assert.equal(report.days.length, 2, "every day of the range appears, zero-filled");
  const day = report.days.find((d) => d.date === "2026-09-29");
  assert.deepEqual(day?.docs, { first: 3, last: 5, numbered: 3, cancelled: 1, unnumbered: 1 });
  assert.equal(day?.bills, 3, "3 Completed bills that day");
});

test("foldGstReport: only Completed counts for money/bills/rates; range totals = Σ days", () => {
  const orders: GstOrderView[] = [
    order({ total: 1050, gstMode: "inclusive", gstRate: 5, status: "Completed" }),
    order({ total: 999, status: "Cancelled", billNumber: 7 }), // no money contribution
  ];
  const report = foldGstReport({ range: { from: "2026-09-29", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: false });
  assert.equal(report.bills, 1);
  assert.equal(report.netSales, 1050);
  assert.equal(report.rates.length, 1);
  assert.equal(report.rates[0].rate, 5);
  const dayTotals = report.days.reduce((s, d) => s + d.bills, 0);
  assert.equal(dayTotals, report.bills, "range totals = Σ days");
});

test("foldGstReport: day buckets cross the 23:50/00:10 IST boundary correctly (cafeDateString, not the UTC date)", () => {
  // 2026-09-28 23:50 IST = 2026-09-28 18:20 UTC; 2026-09-29 00:10 IST = 2026-09-28 18:40 UTC.
  const orders: GstOrderView[] = [
    order({ orderId: "late-28", total: 100, createdAt: new Date("2026-09-28T18:20:00Z"), status: "Completed" }),
    order({ orderId: "early-29", total: 200, createdAt: new Date("2026-09-28T18:40:00Z"), status: "Completed" }),
  ];
  const report = foldGstReport({ range: { from: "2026-09-28", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: false });
  const d28 = report.days.find((d) => d.date === "2026-09-28");
  const d29 = report.days.find((d) => d.date === "2026-09-29");
  assert.equal(d28?.value, 100);
  assert.equal(d29?.value, 200);
});

test("foldGstReport: withBills adds oldest-first billRows only over Completed bills", () => {
  const orders: GstOrderView[] = [
    order({ orderId: "later", total: 100, createdAt: new Date("2026-09-29T10:00:00Z"), status: "Completed" }),
    order({ orderId: "earlier", total: 200, createdAt: new Date("2026-09-29T05:00:00Z"), status: "Completed" }),
    order({ orderId: "cancelled", total: 999, status: "Cancelled", billNumber: 9 }),
  ];
  const withBills = foldGstReport({ range: { from: "2026-09-29", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: true });
  assert.deepEqual(
    withBills.billRows?.map((r) => r.orderId),
    ["earlier", "later"],
  );
  const withoutBills = foldGstReport({ range: { from: "2026-09-29", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: false });
  assert.equal(withoutBills.billRows, undefined);
});

// ── GST invoice serials (S10-D / K8) ─────────────────────────────────────────

const GST_5 = { gstMode: "exclusive" as const, gstRate: 5, gstAmount: 50 };
// 31 Mar 2027 23:59 IST and 1 Apr 2027 00:00 IST — one minute apart, two financial years.
const LAST_MINUTE_OF_FY_2026 = new Date("2027-03-31T18:29:00Z");
const FIRST_MINUTE_OF_FY_2027 = new Date("2027-03-31T18:30:00Z");

test("foldGstReport: invoices per day — numbered, first/last, cancelled-after-billing, and Completed GST bills without a number", () => {
  const orders: GstOrderView[] = [
    order({ orderId: "A", total: 1050, ...GST_5, invoiceNumber: 7, invoiceFy: 2026 }),
    order({ orderId: "B", total: 1050, ...GST_5, invoiceNumber: 9, invoiceFy: 2026 }),
    order({ orderId: "C", total: 1050, ...GST_5, status: "Cancelled", invoiceNumber: 8, invoiceFy: 2026 }), // paid, then cancelled: keeps its number
    order({ orderId: "D", total: 1050, ...GST_5 }), // GST bill paid before invoice numbers: without
    order({ orderId: "E", total: 300, gstMode: "exclusive", gstRate: 0, gstAmount: 0 }), // no GST on this bill: never "without"
  ];
  const report = foldGstReport({ range: { from: "2026-09-29", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: false });
  const expected = { fy: 2026, first: 7, last: 9, numbered: 3, cancelled: 1, without: 1 };
  assert.deepEqual(report.days[0].invoices, expected);
  assert.deepEqual(report.invoices, expected, "a one-day range summarises exactly like its day");
  assert.deepEqual(report.days[0].docs, { first: null, last: null, numbered: 0, cancelled: 0, unnumbered: 4 }, "bill-number docs are untouched");
});

test("foldGstReport: FY boundary — 31 Mar 23:59 IST is FY 2026, 1 Apr 00:00 IST is FY 2027; the range over both reports no first/last", () => {
  const orders: GstOrderView[] = [
    order({ orderId: "old", total: 1050, ...GST_5, createdAt: LAST_MINUTE_OF_FY_2026, invoiceNumber: 412, invoiceFy: 2026 }),
    order({ orderId: "new", total: 1050, ...GST_5, createdAt: FIRST_MINUTE_OF_FY_2027, invoiceNumber: 1, invoiceFy: 2027 }),
  ];
  const report = foldGstReport({ range: { from: "2027-03-31", to: "2027-04-01" }, orders, liveCfg: GST_OFF, withBills: false });
  assert.deepEqual(report.days.map((d) => d.date), ["2027-03-31", "2027-04-01"]);
  assert.deepEqual(report.days[0].invoices, { fy: 2026, first: 412, last: 412, numbered: 1, cancelled: 0, without: 0 });
  assert.deepEqual(report.days[1].invoices, { fy: 2027, first: 1, last: 1, numbered: 1, cancelled: 0, without: 0 });
  // Serials of two years are two series: no single first/last, but every count stays exact.
  assert.deepEqual(report.invoices, { fy: null, first: null, last: null, numbered: 2, cancelled: 0, without: 0 });
});

test("foldGstReport: a range inside one financial year gives that year's lowest and highest serial across days", () => {
  const orders: GstOrderView[] = [
    order({ orderId: "a", total: 1050, ...GST_5, createdAt: new Date("2027-04-02T05:00:00Z"), invoiceNumber: 3, invoiceFy: 2027 }),
    order({ orderId: "b", total: 1050, ...GST_5, createdAt: new Date("2027-04-03T05:00:00Z"), invoiceNumber: 5, invoiceFy: 2027 }),
    order({ orderId: "c", total: 1050, ...GST_5, createdAt: new Date("2027-04-03T06:00:00Z"), invoiceNumber: 4, invoiceFy: 2027 }),
    order({ orderId: "d", total: 1050, ...GST_5, createdAt: new Date("2027-04-04T05:00:00Z") }), // without
  ];
  const report = foldGstReport({ range: { from: "2027-04-02", to: "2027-04-04" }, orders, liveCfg: GST_OFF, withBills: false });
  assert.deepEqual(report.invoices, { fy: 2027, first: 3, last: 5, numbered: 3, cancelled: 0, without: 1 });
  assert.deepEqual(report.days.map((d) => d.invoices.numbered), [1, 2, 0]);
  assert.deepEqual(report.days[2].invoices, { fy: null, first: null, last: null, numbered: 0, cancelled: 0, without: 1 });
});

test("foldGstReport: the restart time never reaches invoices — buckets are the IST calendar day of createdAt, whatever the daily number says", () => {
  // 01:30 IST on 30 Sep is still "yesterday's trading" for a cafe restarting at 04:00, but its GST day is 30 Sep.
  const orders: GstOrderView[] = [
    order({ orderId: "after-midnight", total: 1050, ...GST_5, createdAt: new Date("2026-09-29T20:00:00Z"), billNumber: 2, invoiceNumber: 11, invoiceFy: 2026 }),
    order({ orderId: "evening", total: 1050, ...GST_5, createdAt: new Date("2026-09-29T14:00:00Z"), billNumber: 90, invoiceNumber: 10, invoiceFy: 2026 }),
  ];
  const report = foldGstReport({ range: { from: "2026-09-29", to: "2026-09-30" }, orders, liveCfg: GST_OFF, withBills: false });
  assert.deepEqual(report.days[0].invoices, { fy: 2026, first: 10, last: 10, numbered: 1, cancelled: 0, without: 0 });
  assert.deepEqual(report.days[1].invoices, { fy: 2026, first: 11, last: 11, numbered: 1, cancelled: 0, without: 0 });
  assert.deepEqual(report.invoices, { fy: 2026, first: 10, last: 11, numbered: 2, cancelled: 0, without: 0 });
  const src = stripComments(readFileSync(path.join(HERE, "gst-fold.ts"), "utf8")) + stripComments(readFileSync(path.join(HERE, "gst-build.ts"), "utf8"));
  assert.ok(!/resetMinutes|restart|numberStart/i.test(src), "the GST report never reads the daily restart time");
});

test("foldGstReport: a Cancelled bill that holds an invoice counts as cancelled without touching money; a half-stored pair counts as none; billRows carry the invoice", () => {
  const orders: GstOrderView[] = [
    order({ orderId: "paid", total: 1050, ...GST_5, invoiceNumber: 5, invoiceFy: 2026 }),
    order({ orderId: "void", total: 999, status: "Cancelled", invoiceNumber: 6, invoiceFy: 2026 }), // no billNumber at all
    order({ orderId: "half", total: 1050, ...GST_5, invoiceNumber: 99 }), // number without a year: not an invoice
  ];
  const report = foldGstReport({ range: { from: "2026-09-29", to: "2026-09-29" }, orders, liveCfg: GST_OFF, withBills: true });
  assert.deepEqual(report.invoices, { fy: 2026, first: 5, last: 6, numbered: 2, cancelled: 1, without: 1 });
  assert.equal(report.bills, 2, "the cancelled bill adds no money");
  assert.equal(report.netSales, 2100);
  const paid = report.billRows?.find((r) => r.orderId === "paid");
  assert.equal(paid?.invoiceNumber, 5);
  assert.equal(paid?.invoiceFy, 2026);
  const half = report.billRows?.find((r) => r.orderId === "half");
  assert.equal(half?.invoiceNumber, undefined, "no half-pair on a bill row");
  assert.equal(half?.invoiceFy, undefined);
});

test("source pin: the GST query selects both invoice fields and also reads a Cancelled bill that holds an invoice", () => {
  const src = stripComments(readFileSync(path.join(HERE, "gst-build.ts"), "utf8"));
  assert.ok(/GST_ORDER_SELECT = "[^"]*\binvoiceNumber invoiceFy\b/.test(src), "select carries invoiceNumber and invoiceFy");
  assert.ok(src.includes('{ status: "Cancelled", invoiceNumber: { $exists: true } }'), "a cancelled invoice is read");
  assert.ok(src.includes('{ status: "Cancelled", billNumber: { $exists: true } }'), "a cancelled numbered bill is still read");
});

// ── Source pin: gst-fold.ts must CALL receiptGst, never re-derive its rule ──

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = () => stripComments(readFileSync(path.join(HERE, "gst-fold.ts"), "utf8"));

test("source pin: gst-fold.ts imports and calls receiptGst( — mutation-tested (this pin was verified red when the call was removed)", () => {
  const src = readSrc();
  assert.ok(src.includes('from "@/lib/receipt"'), "must import from @/lib/receipt");
  const callNeedle = "receiptGst" + "(";
  assert.ok(src.includes(callNeedle), "must call receiptGst(");
});
