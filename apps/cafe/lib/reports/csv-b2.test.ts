// itemsCsvRows / cancelsCsvRows / gstDayCsvRows / gstBillCsvRows — pure,
// DB-free. Pins the CSV Total rows against the report's OWN totals (never
// independently recomputed), even when the listed rows are capped, mirroring
// lib/reports/csv.test.ts's own discipline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelsCsvRows, gstBillCsvRows, gstDayCsvRows, itemsCsvRows } from "@/lib/reports/csv-b2";
import type { CancelsReport, GstReport, ItemsReport } from "@/types/reports-b2";

function makeItemsReport(): ItemsReport {
  return {
    range: { from: "2026-09-29", to: "2026-09-29" },
    compare: { from: "2026-09-22", to: "2026-09-22", label: "vs Tue, 22 Sep" },
    kpis: { current: { qty: 15, sales: 750 }, previous: { qty: 0, sales: 0 } },
    items: [
      { key: "p1|Tea", productId: "p1", label: "Tea", categoryName: "Beverages", categoryKey: "c1", qty: 10, freeQty: 2, sales: 500, share: 500 / 750 },
      { key: "p2|Coffee", productId: "p2", label: "Coffee", categoryName: "Beverages", categoryKey: "c1", qty: 5, freeQty: 0, sales: 250, share: 250 / 750 },
    ],
    categories: [{ key: "c1", label: "Beverages", items: 2, qty: 15, sales: 750, share: 1 }],
    money: { gross: 750, discount: 0, reward: 0, gst: 0, charges: 0 },
    rewardLines: 0,
    netSales: 750,
  };
}

test("itemsCsvRows: one row per item + a Total row equal to kpis.current, share rounded to 1dp", () => {
  const rows = itemsCsvRows(makeItemsReport());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].Item, "Tea");
  assert.equal(rows[0]["Share %"], Math.round((500 / 750) * 1000) / 10);
  const total = rows[2];
  assert.equal(total.Item, "Total");
  assert.equal(total.Qty, 15);
  assert.equal(total.Free, 2);
  assert.equal(total.Sales, 750);
  assert.equal(total["Share %"], 100);
});

function makeCancelsReport(): CancelsReport {
  return {
    range: { from: "2026-09-29", to: "2026-09-29" },
    compare: { from: "2026-09-22", to: "2026-09-22", label: "vs Tue, 22 Sep" },
    kpis: {
      current: {
        discounts: { orders: 5, amount: 500 }, // more than the 1 listed row -> Total must still be 500 (never Σ rows)
        rewards: { orders: 3, amount: 300 },
        cancelled: { count: 4, value: 2000 }, // more than the 1 listed row
        voids: { lines: 2, qty: 2, value: 100 },
      },
      previous: { discounts: { orders: 0, amount: 0 }, rewards: { orders: 0, amount: 0 }, cancelled: { count: 0, value: 0 }, voids: { lines: 0, qty: 0, value: 0 } },
    },
    mode: "day",
    series: [],
    cancelled: {
      rows: [{ id: "1", orderId: "ORD-1", day: "2026-09-29", at: "2026-09-29T10:00:00.000Z", value: 500, paid: 200, by: "Asha", reason: "Wrong order", customerName: "Ravi", tableNo: "" }],
      truncated: true,
    },
    removed: {
      rows: [{ orderId: "ORD-2", day: "2026-09-29", at: "2026-09-29T11:00:00.000Z", item: "Tea", qty: 1, value: 50, by: "Vikram", reason: "Burnt" }],
      truncated: false,
    },
    discounts: {
      rows: [{ orderId: "ORD-3", day: "2026-09-29", at: "2026-09-29T09:00:00.000Z", kind: "gst", amount: 500, billTotal: 5000, by: "Asha", customerName: "Sana" }],
      truncated: true,
    },
    byStaff: [],
    reasons: [],
  };
}

test("cancelsCsvRows: 3 sections each closed by the report's OWN KPI total, never the capped rows' sum", () => {
  const rows = cancelsCsvRows(makeCancelsReport());
  const cancelledTotal = rows.find((r) => r.Section === "Cancelled bills" && r.Reason === "Total");
  assert.equal(cancelledTotal?.Amount, 2000, "cancelled Total must be the KPI value (2000), not the single listed row (500)");
  const removedTotal = rows.find((r) => r.Section === "Items removed" && r.Reason === "Total");
  assert.equal(removedTotal?.Amount, 100);
  const discountsTotal = rows.find((r) => r.Section === "Discounts & rewards" && r.Reason === "Total");
  assert.equal(discountsTotal?.Amount, 500 + 300, "discounts+rewards Total is the sum of BOTH kpi amounts");
});

test("cancelsCsvRows: IST dates via CAFE_TIMEZONE, not the browser's zone", () => {
  const rows = cancelsCsvRows(makeCancelsReport());
  const billed = rows.find((r) => r["Bill/Order"] === "ORD-1");
  // 10:00 UTC is 3:30 pm IST.
  assert.match(String(billed?.Date), /3:30/);
});

function makeGstReport(): GstReport {
  return {
    range: { from: "2026-09-29", to: "2026-09-29" },
    bills: 10,
    taxable: 9000,
    gst: 450,
    noGst: 500,
    noGstBills: 2,
    charges: 100,
    netSales: 10050,
    rates: [],
    days: [
      { date: "2026-09-29", bills: 10, taxable: 9000, gst: 450, noGst: 500, charges: 100, value: 10050, docs: { first: 1, last: 10, numbered: 10, cancelled: 0, unnumbered: 0 }, invoices: { fy: 2026, first: 41, last: 50, numbered: 10, cancelled: 0, without: 0 } },
    ],
    docs: { numbered: 10, cancelled: 0, unnumbered: 0 },
    invoices: { fy: 2026, first: 41, last: 50, numbered: 10, cancelled: 0, without: 0 },
  };
}

test("gstDayCsvRows: CGST = SGST = gst/2 exactly, Total row equals the report's own range totals", () => {
  const rows = gstDayCsvRows(makeGstReport());
  assert.equal(rows[0].CGST, 225);
  assert.equal(rows[0].SGST, 225);
  assert.equal(rows[0]["Total GST"], 450);
  const total = rows[1];
  assert.equal(total.Day, "Total");
  assert.equal(total.Bills, 10);
  assert.equal(total["Bill value"], 10050);
  assert.equal(total.CGST, 225);
});

test("gstBillCsvRows: one row per bill, CGST/SGST halves, payment carried through", () => {
  const rows = gstBillCsvRows([
    { date: "2026-09-29", at: "2026-09-29T10:00:00.000Z", billNumber: 3, orderId: "ORD-9", rate: 5, inclusive: true, taxable: 950, gst: 50, noGst: 0, charges: 0, total: 1000, payment: "Cash" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Bill no."], 3);
  assert.equal(rows[0].CGST, 25);
  assert.equal(rows[0].SGST, 25);
  assert.equal(rows[0].Payment, "Cash");
});

test("gstDayCsvRows: First/Last invoice are printed labels per day and in the Total row; blank for a day without one or a range over two financial years", () => {
  const base = makeGstReport();
  const rows = gstDayCsvRows(base);
  assert.equal(rows[0]["First invoice"], "2627/000041");
  assert.equal(rows[0]["Last invoice"], "2627/000050");
  assert.equal(rows[1]["First invoice"], "2627/000041");
  assert.equal(rows[1]["Last invoice"], "2627/000050");
  // The old columns are all still there, in the same relative order, with the new ones appended last.
  assert.deepEqual(Object.keys(rows[0]), [
    "Day", "Bills", "First bill", "Last bill", "Cancelled after billing", "Taxable value", "CGST", "SGST", "Total GST",
    "No-GST bills", "Charges (no GST)", "Bill value", "First invoice", "Last invoice",
  ]);

  const none = { fy: null, first: null, last: null, numbered: 0, cancelled: 0, without: 2 };
  const crossing: GstReport = {
    ...base,
    days: [{ ...base.days[0], invoices: none }],
    invoices: { fy: null, first: null, last: null, numbered: 12, cancelled: 0, without: 2 },
  };
  const blank = gstDayCsvRows(crossing);
  assert.equal(blank[0]["First invoice"], "");
  assert.equal(blank[0]["Last invoice"], "");
  assert.equal(blank[1]["First invoice"], "");
  assert.equal(blank[1]["Last invoice"], "");
});

test("gstBillCsvRows: Invoice no. is the printed label when the bill holds one, blank otherwise, and sits after the old columns", () => {
  const bill = { date: "2026-09-29", at: "2026-09-29T10:00:00.000Z", orderId: "ORD-9", rate: 5, inclusive: true, taxable: 950, gst: 50, noGst: 0, charges: 0, total: 1000, payment: "Cash" };
  const rows = gstBillCsvRows([{ ...bill, invoiceNumber: 123, invoiceFy: 2026 }, bill]);
  assert.equal(rows[0]["Invoice no."], "2627/000123");
  assert.equal(rows[1]["Invoice no."], "");
  assert.equal(Object.keys(rows[0]).at(-1), "Invoice no.");
  assert.equal(Object.keys(rows[0]).at(-2), "Payment");
});
