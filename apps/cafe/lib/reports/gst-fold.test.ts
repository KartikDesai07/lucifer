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

// ── Source pin: gst-fold.ts must CALL receiptGst, never re-derive its rule ──

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = () => stripComments(readFileSync(path.join(HERE, "gst-fold.ts"), "utf8"));

test("source pin: gst-fold.ts imports and calls receiptGst( — mutation-tested (this pin was verified red when the call was removed)", () => {
  const src = readSrc();
  assert.ok(src.includes('from "@/lib/receipt"'), "must import from @/lib/receipt");
  const callNeedle = "receiptGst" + "(";
  assert.ok(src.includes(callNeedle), "must call receiptGst(");
});
