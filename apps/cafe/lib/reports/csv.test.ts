// salesCsvRows / paymentsCsvRows / duesCsvRows — pure, DB-free. Pins the CSV
// numbers against the report's OWN totals (never independently recomputed),
// one row per day, and the dues sections' order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { salesCsvRows, paymentsCsvRows, duesCsvRows } from "@/lib/reports/csv";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import type { SalesReport, DuesReport } from "@/types/reports";

function makeSalesReport(): SalesReport {
  return {
    range: { from: "2026-09-28", to: "2026-09-29" },
    compare: { from: "2026-09-26", to: "2026-09-27", label: "vs previous 2 days" },
    kpis: {
      current: { sales: 900, orders: 3, averageOrder: 300, collected: 850 },
      previous: { sales: 0, orders: 0, averageOrder: 0, collected: 0 },
    },
    mode: "day",
    series: [],
    money: { gross: 950, discount: 50, reward: 0, gst: 0, charges: 0 },
    received: { cash: 400, online: 200, other: 250, credit: 50 },
    dues: { cash: 20, online: 0, other: 0 },
    payments: [],
    split: { orders: 0, cash: 0, online: 0 },
    days: [
      {
        date: "2026-09-28",
        orders: 2,
        net: 600,
        money: { gross: 650, discount: 50, reward: 0, gst: 0, charges: 0 },
        cash: 400,
        online: 200,
        other: 0,
        credit: 0,
        dues: { cash: 20, online: 0, other: 0 },
      },
      {
        date: "2026-09-29",
        orders: 1,
        net: 300,
        money: { gross: 300, discount: 0, reward: 0, gst: 0, charges: 0 },
        cash: 0,
        online: 0,
        other: 250,
        credit: 50,
        dues: { cash: 0, online: 0, other: 0 },
      },
    ],
  };
}

test("salesCsvRows: one row per day plus a final Total row that equals the report's own totals", () => {
  const report = makeSalesReport();
  const rows = salesCsvRows(report);
  assert.equal(rows.length, report.days.length + 1);
  assert.equal(rows[0].Day, "28 Sep");
  assert.equal(rows[1].Day, "29 Sep");
  const total = rows[rows.length - 1];
  assert.equal(total.Day, "Total");
  assert.equal(total.Orders, 3); // Σ day orders
  for (const line of MONEY_BREAKDOWN_LINES) {
    assert.equal(total[line.label], report.money[line.key], `Total row's "${line.label}" must equal report.money.${line.key}`);
  }
  assert.equal(total[MONEY_NET_LABEL], 900); // Σ day net
  assert.equal(total.Cash, report.received.cash);
  assert.equal(total.Online, report.received.online);
  assert.equal(total["Other paid"], report.received.other);
  assert.equal(total["Credit given"], report.received.credit);
});

test("paymentsCsvRows: one row per day (cash/online split into from-bills vs dues-received) plus a Total row", () => {
  const report = makeSalesReport();
  const rows = paymentsCsvRows(report);
  assert.equal(rows.length, report.days.length + 1);
  assert.equal(rows[0]["Cash from bills"], 400);
  assert.equal(rows[0]["Cash dues received"], 20);
  assert.equal(rows[0]["Cash total"], 420);
  const total = rows[rows.length - 1];
  assert.equal(total.Day, "Total");
  assert.equal(total["Cash from bills"], report.received.cash);
  assert.equal(total["Cash dues received"], report.dues.cash);
  assert.equal(total["Cash total"], report.received.cash + report.dues.cash);
  assert.equal(total["Online total"], report.received.online + report.dues.online);
  assert.equal(total["Credit given"], report.received.credit);
});

test("duesCsvRows: 'Outstanding now' rows come before 'Received in range' rows, in that order", () => {
  const report: DuesReport = {
    range: { from: "2026-09-29", to: "2026-09-29" },
    outstanding: {
      total: 500,
      customers: 1,
      rows: [{ customerId: "c1", name: "Asha", mobile: "9990000001", totalDue: 500 }],
      truncated: false,
    },
    collected: {
      cash: 150,
      online: 0,
      other: 0,
      total: 150,
      count: 1,
      rows: [
        {
          id: "p1",
          at: "2026-09-29T10:00:00.000Z",
          customerId: "c2",
          customerName: "Bala",
          amount: 150,
          mode: "Cash",
          receivedBy: "Staff",
        },
      ],
      truncated: false,
    },
    creditGiven: { total: 0, orders: 0 },
  };
  const rows = duesCsvRows(report);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].Section, "Outstanding now");
  assert.equal(rows[0].Customer, "Asha");
  assert.equal(rows[0].Amount, 500);
  assert.deepEqual([rows[1].Section, rows[1].Customer, rows[1].Amount], ["Outstanding now", "Total", 500]);
  assert.equal(rows[2].Section, "Received in range");
  assert.equal(rows[2].Customer, "Bala");
  assert.equal(rows[2].Mode, "Cash");
  assert.equal(rows[2].Amount, 150);
  // IST, whatever the downloading browser's own zone: 10:00 UTC is 3:30 pm IST.
  assert.match(String(rows[2].Date), /3:30/);
  assert.deepEqual([rows[3].Section, rows[3].Customer, rows[3].Amount], ["Received in range", "Total", 150]);
  assert.deepEqual([rows[4].Section, rows[4].Customer, rows[4].Amount], ["Credit given in range", "Total", 0]);
});

test("duesCsvRows: each section's Total is the report's OWN total — even when the listed rows are capped", () => {
  const report: DuesReport = {
    range: { from: "2026-09-01", to: "2026-09-29" },
    // 3 customers owe 900 in all; only the largest balance is listed (truncated).
    outstanding: {
      total: 900,
      customers: 3,
      rows: [{ customerId: "c1", name: "Asha", mobile: "9990000001", totalDue: 500 }],
      truncated: true,
    },
    collected: { cash: 700, online: 0, other: 0, total: 700, count: 5, rows: [], truncated: true },
    creditGiven: { total: 340, orders: 2 },
  };
  const totals = duesCsvRows(report).filter((r) => r.Customer === "Total");
  // Mutation this catches: summing the capped rows (500 / 0) instead of the
  // report's totals — a CSV-only tally would then land short with no warning.
  assert.deepEqual(totals.map((r) => [r.Section, r.Amount]), [["Outstanding now", 900], ["Received in range", 700], ["Credit given in range", 340]]);
});

test("duesCsvRows: an empty report still closes each section with a zero Total row", () => {
  const report: DuesReport = {
    range: { from: "2026-09-29", to: "2026-09-29" },
    outstanding: { total: 0, customers: 0, rows: [], truncated: false },
    collected: { cash: 0, online: 0, other: 0, total: 0, count: 0, rows: [], truncated: false },
    creditGiven: { total: 0, orders: 0 },
  };
  assert.deepEqual(
    duesCsvRows(report).map((r) => [r.Section, r.Customer, r.Amount]),
    [["Outstanding now", "Total", 0], ["Received in range", "Total", 0], ["Credit given in range", "Total", 0]],
  );
});
