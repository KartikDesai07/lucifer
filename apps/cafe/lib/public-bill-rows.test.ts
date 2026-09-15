import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { publicCartTotals, type PublicGstConfig, type PublicOrderRequestStatusData } from "@pos/shared/public";
import { billFromStatusData } from "@/components/public/public-bill-rows";

// S3 — DB-free pins for the read-only bill-rows extraction. Same
// readSrc/absence+landmark technique as public-hardening-paths.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const BILL_ROWS_COMPONENT = "apps/cafe/components/public/PublicBillRows.tsx";

const NO_GST: PublicGstConfig = { enabled: false, rate: 0, mode: "inclusive" };
const EXCLUSIVE_GST: PublicGstConfig = { enabled: true, rate: 10, mode: "exclusive" };
const INCLUSIVE_GST: PublicGstConfig = { enabled: true, rate: 10, mode: "inclusive" };

function baseStatusData(overrides: Partial<PublicOrderRequestStatusData> = {}): PublicOrderRequestStatusData {
  return {
    status: "pending",
    shortCode: "ABCDEFGHJK",
    tableLabel: "T-1",
    parcel: false,
    itemCount: 1,
    total: 100,
    createdAt: new Date().toISOString(),
    items: [
      { productId: "p1", name: "Filter Coffee", price: 40, qty: 2, modifiers: [] },
    ],
    subtotal: 80,
    charge: 0,
    ...overrides,
  };
}

// ── 1/2. One line per item; amount = price*qty; sub present/absent ─────────

test("billFromStatusData: one line per item, amount = price*qty, qty carried through", () => {
  const data = baseStatusData({
    items: [
      { productId: "p1", name: "Filter Coffee", price: 40, qty: 3, modifiers: [] },
      { productId: "p2", name: "Pizza", price: 150, qty: 2, modifiers: [] },
    ],
  });
  const { lines } = billFromStatusData(data, NO_GST);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((l) => [l.label, l.qty, l.amount]),
    [
      ["Filter Coffee", 3, 120],
      ["Pizza", 2, 300],
    ],
  );
});

test("billFromStatusData: sub is present when the item has a variation/modifiers/instructions, absent when it has none", () => {
  const data = baseStatusData({
    items: [
      { productId: "p1", name: "Filter Coffee", price: 40, qty: 1, modifiers: [] },
      {
        productId: "p2",
        name: "Pizza",
        price: 150,
        qty: 1,
        variation: "Large",
        modifiers: ["Extra cheese"],
        instructions: "no onion",
      },
    ],
  });
  const { lines } = billFromStatusData(data, NO_GST);
  assert.equal(lines[0].sub, undefined, "no variation/modifiers/instructions => no sub");
  assert.ok(lines[1].sub, "variation/modifiers/instructions present => sub present");
  assert.match(lines[1].sub as string, /Large/);
  assert.match(lines[1].sub as string, /Extra cheese/);
  assert.match(lines[1].sub as string, /no onion/);
});

// ── 3. Discount row: absent / 0 / positive ──────────────────────────────────

test("billFromStatusData: discount row appears ONLY when quotedDiscount is present and > 0", () => {
  const absent = billFromStatusData(baseStatusData({ quotedDiscount: undefined }), NO_GST);
  assert.equal(absent.totals.some((t) => t.label === "Discount"), false, "absent quotedDiscount => no row");

  const zero = billFromStatusData(baseStatusData({ quotedDiscount: 0 }), NO_GST);
  assert.equal(zero.totals.some((t) => t.label === "Discount"), false, "quotedDiscount 0 => no row");

  const positive = billFromStatusData(baseStatusData({ quotedDiscount: 15 }), NO_GST);
  const discountRow = positive.totals.find((t) => t.label === "Discount");
  assert.ok(discountRow, "positive quotedDiscount => row present");
  assert.equal(discountRow?.amount, -15, "discount renders as a negative/deduction amount");
});

// ── 4. Charge row: only when > 0, uses chargeLabel when supplied ───────────

test("billFromStatusData: charge row appears only when charge > 0, and uses chargeLabel when supplied", () => {
  const none = billFromStatusData(baseStatusData({ charge: 0 }), NO_GST);
  assert.equal(none.totals.some((t) => t.label === "Table charge" || t.label === "Cover"), false);

  const defaultLabel = billFromStatusData(baseStatusData({ charge: 20 }), NO_GST);
  const row = defaultLabel.totals.find((t) => t.amount === 20 && t.label !== "Subtotal");
  assert.ok(row, "charge > 0 with no chargeLabel still shows a row");

  const customLabel = billFromStatusData(baseStatusData({ charge: 20, chargeLabel: "Cover charge" }), NO_GST);
  assert.ok(customLabel.totals.some((t) => t.label === "Cover charge" && t.amount === 20));
});

// ── 5. GST: exclusive shows, disabled/inclusive show nothing ───────────────

test("billFromStatusData GST: exclusive + positive rate shows a row equal to publicCartTotals' gstAmount", () => {
  const data = baseStatusData({ subtotal: 80, charge: 0 });
  const { totals } = billFromStatusData(data, EXCLUSIVE_GST);
  const { gstAmount } = publicCartTotals(data.subtotal, data.charge, EXCLUSIVE_GST);
  assert.ok(gstAmount > 0, "sanity: exclusive+positive rate must actually produce a nonzero gstAmount");
  const gstRow = totals.find((t) => t.label.startsWith("GST"));
  assert.ok(gstRow, "GST row must be present in exclusive mode");
  assert.equal(gstRow?.amount, gstAmount);
});

test("billFromStatusData GST: disabled config shows NO GST row", () => {
  const data = baseStatusData({ subtotal: 80, charge: 0 });
  const { totals } = billFromStatusData(data, NO_GST);
  assert.equal(totals.some((t) => t.label.startsWith("GST")), false);
});

test("billFromStatusData GST: inclusive mode (enabled, positive rate) shows NO GST row — the amount is already inside subtotal", () => {
  const data = baseStatusData({ subtotal: 80, charge: 0 });
  const { totals } = billFromStatusData(data, INCLUSIVE_GST);
  const { gstAmount } = publicCartTotals(data.subtotal, data.charge, INCLUSIVE_GST);
  assert.equal(gstAmount, 0, "sanity: inclusive mode derives a zero gstAmount");
  assert.equal(totals.some((t) => t.label.startsWith("GST")), false);
});

// ── 6. Total row always exists, strong, equals data.total EXACTLY ──────────

test("billFromStatusData: the Total row is always present, marked strong, and equals data.total EXACTLY — even when item arithmetic disagrees", () => {
  // Deliberately inconsistent fixture: items sum to 40*2=80, but the server's
  // quoted total says 999 — a stale/edited-elsewhere figure. The server's
  // total must win; this function must never recompute it from its own rows.
  const data = baseStatusData({
    items: [{ productId: "p1", name: "Filter Coffee", price: 40, qty: 2, modifiers: [] }],
    subtotal: 80,
    charge: 0,
    total: 999,
  });
  const { totals } = billFromStatusData(data, NO_GST);
  const totalRow = totals[totals.length - 1];
  assert.equal(totalRow.label, "Total");
  assert.equal(totalRow.strong, true);
  assert.equal(totalRow.amount, 999, "the server's quoted total wins, never a row-arithmetic recomputation");
});

// ── 7. Negative/absence pin paired with a positive landmark ────────────────

test("PIN: PublicBillRows.tsx is read-only — no <input, no <Input, no onChange, no fetch( — paired with a positive landmark that it DOES render through inr(", () => {
  const src = readSrc(BILL_ROWS_COMPONENT);
  assert.ok(!src.includes("<input"), "must not render a raw <input>");
  assert.ok(!src.includes("<Input"), "must not render the shadcn <Input> form control");
  assert.ok(!src.includes("onChange"), "must not wire any onChange handler");
  assert.ok(!src.includes("fetch("), "must not fetch — this is a pure presentational component");
  // Positive landmark: an empty/gutted file would vacuously pass every
  // absence check above, so also assert the component actually renders money.
  assert.match(src, /inr\(/, "must render every money value through inr(");
});

// ── REGRESSION (review 2026-09-13, CONFIRMED against primary source) ───────
// The bill view reused publicCartTotals, whose OWN header says it is
// "Narrowed to the one case a diner's cart can ever be in: zero discount".
// A past order CAN carry one (quotedDiscount is stored and shipped), and the
// server taxes the DISCOUNTED base (lib/receipt.ts: `base = subtotal -
// clampedDiscount; gstAmount = computeExclusiveGst(base, cfg)`).
// Computing GST on the UNDISCOUNTED subtotal made the printed rows disagree
// with the printed Total on every promo order — a money-display defect on a
// receipt the diner reads. The rows must reconcile to data.total exactly.
test("REGRESSION: GST on a DISCOUNTED order is computed on the discounted base, so the rows reconcile to the Total", () => {
  // subtotal 1000, discount 200 -> base 800, GST 10% = 80, total 880.
  const { totals } = billFromStatusData(
    baseStatusData({ subtotal: 1000, charge: 0, quotedDiscount: 200, total: 880 }),
    EXCLUSIVE_GST,
  );
  const gstRow = totals.find((t) => t.label.startsWith("GST"));
  assert.ok(gstRow, "a GST row must be present for an exclusive-GST order");
  assert.equal(
    gstRow!.amount,
    80,
    "GST must be computed on subtotal MINUS discount (the server's own base), not on the raw subtotal",
  );

  // The real invariant: what the diner reads must add up to what they owe.
  const sum = totals
    .filter((t) => !t.strong)
    .reduce((acc, t) => acc + t.amount, 0);
  const total = totals.find((t) => t.strong)!.amount;
  assert.equal(sum, total, `bill rows must sum to the Total (rows ${sum} vs total ${total})`);
});

test("REGRESSION: a discounted order WITH a table charge still reconciles (charge is untaxed, outside the discount)", () => {
  // subtotal 1000, discount 200 -> base 800, GST 10% = 80, charge 50 -> 930.
  const { totals } = billFromStatusData(
    baseStatusData({ subtotal: 1000, charge: 50, chargeLabel: "Cover", quotedDiscount: 200, total: 930 }),
    EXCLUSIVE_GST,
  );
  const sum = totals.filter((t) => !t.strong).reduce((acc, t) => acc + t.amount, 0);
  assert.equal(sum, totals.find((t) => t.strong)!.amount, "rows must sum to the Total");
});

test("REGRESSION: the zero-discount case is unchanged (no drift for the common order)", () => {
  const { totals } = billFromStatusData(
    baseStatusData({ subtotal: 1000, charge: 0, total: 1100 }),
    EXCLUSIVE_GST,
  );
  const gstRow = totals.find((t) => t.label.startsWith("GST"));
  assert.equal(gstRow!.amount, 100, "an undiscounted order still taxes the full subtotal");
  const sum = totals.filter((t) => !t.strong).reduce((acc, t) => acc + t.amount, 0);
  assert.equal(sum, totals.find((t) => t.strong)!.amount, "rows must sum to the Total");
});

test("REGRESSION: a MISSING gst config (fetch failed / not yet loaded) still produces rows that reconcile to the Total", () => {
  // The shell seeds { enabled:false } deliberately so a pre-load bill never
  // INVENTS tax. Before the reconciliation guard this printed Subtotal 1000 /
  // Total 1180 with no tax line at all — rows that silently did not add up.
  const { totals } = billFromStatusData(
    baseStatusData({ subtotal: 1000, charge: 0, total: 1180 }),
    NO_GST,
  );
  const sum = totals.filter((t) => !t.strong).reduce((acc, t) => acc + t.amount, 0);
  assert.equal(sum, 1180, "rows must reconcile to the Total even with no gst config");
  assert.ok(
    totals.some((t) => t.amount === 180 && !t.strong),
    "the unexplained 180 must appear as its own labelled line, not vanish",
  );
});

test("REGRESSION: a fully-explained bill gains NO reconciliation line (the guard is silent when it should be)", () => {
  const { totals } = billFromStatusData(
    baseStatusData({ subtotal: 1000, charge: 0, total: 1100 }),
    EXCLUSIVE_GST,
  );
  assert.ok(
    !totals.some((t) => t.label === "Taxes and charges" || t.label === "Adjustment"),
    "a bill whose rows already add up must not grow a filler line",
  );
});
