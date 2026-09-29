// halfGst / formatHalfGst / gstRateLabel — pure, DB-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { halfGst, formatHalfGst, gstRateLabel, gstBillChunks, GST_BILLS_MAX_DAYS } from "@/lib/reports/gst-display";
import { addDays, rangeDays } from "@/lib/dashboard/range";
import type { GstRateRow } from "@/types/reports";

test("halfGst: exactly half the GST", () => {
  assert.equal(halfGst(540), 270);
  assert.equal(halfGst(25), 12.5);
  assert.equal(halfGst(0), 0);
});

test("formatHalfGst: a whole-rupee half renders via inr()", () => {
  assert.equal(formatHalfGst(540), "₹270");
  assert.equal(formatHalfGst(0), "₹0");
});

test("formatHalfGst: an odd half renders to the paisa (spec example: 25 -> ₹12.50)", () => {
  assert.equal(formatHalfGst(25), "₹12.50");
});

test("formatHalfGst: never silently rounds an odd half via inr", () => {
  // A mutation that swapped inrPaise for inr here would print "₹13" or "₹12" —
  // both wrong; the paisa digits must survive.
  const formatted = formatHalfGst(25);
  assert.match(formatted, /\.50$/, "the .50 must be visible, not rounded away");
});

const oneRate = (rate: number): GstRateRow[] => [{ rate, bills: 1, taxable: 100, gst: 5, value: 105 }];
const twoRates: GstRateRow[] = [
  { rate: 5, bills: 1, taxable: 100, gst: 5, value: 105 },
  { rate: 18, bills: 1, taxable: 200, gst: 36, value: 236 },
];

test("gstRateLabel: exactly one taxed rate names each HALF's own rate (5% GST = CGST 2.5% + SGST 2.5%)", () => {
  assert.equal(gstRateLabel(oneRate(5), true), "CGST 2.5%");
  assert.equal(gstRateLabel(oneRate(5), false), "SGST 2.5%");
  assert.equal(gstRateLabel(oneRate(18), true), "CGST 9%");
});

test("gstRateLabel: more than one rate falls back to the plain label", () => {
  assert.equal(gstRateLabel(twoRates, true), "CGST");
  assert.equal(gstRateLabel(twoRates, false), "SGST");
});

test("gstRateLabel: no taxed rate at all also falls back to the plain label", () => {
  assert.equal(gstRateLabel([], true), "CGST");
});

test("gstBillChunks: covers the range exactly — contiguous, oldest first, each at most GST_BILLS_MAX_DAYS", () => {
  for (const [from, to, expected] of [
    ["2026-09-29", "2026-09-29", 1],
    ["2026-09-01", "2026-10-01", 1], // exactly 31 days
    ["2026-09-01", "2026-10-02", 2], // 32 days
    ["2025-09-29", "2026-09-29", 12], // 366 days (the report cap)
  ] as const) {
    const chunks = gstBillChunks({ from, to });
    assert.equal(chunks.length, expected, `${from}..${to}`);
    assert.equal(chunks[0].from, from);
    assert.equal(chunks[chunks.length - 1].to, to);
    for (let i = 0; i < chunks.length; i++) {
      assert.ok(rangeDays(chunks[i]) <= GST_BILLS_MAX_DAYS && rangeDays(chunks[i]) >= 1, "chunk size");
      if (i > 0) assert.equal(chunks[i].from, addDays(chunks[i - 1].to, 1), "no gap, no overlap");
    }
  }
});
