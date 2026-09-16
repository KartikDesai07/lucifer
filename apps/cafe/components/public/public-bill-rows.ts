import {
  publicCartTotals,
  type PublicGstConfig,
  type PublicOrderRequestStatusData,
  type PublicStatusItem,
} from "@pos/shared/public";
import type { CartLine } from "@/components/public/public-cart-store";
import type { PublicBillLine, PublicBillTotal } from "@/components/public/PublicBillRows";

// S3 — pure adapters (NO React import) from each surface's own data shape
// into PublicBillRows' { lines, totals }. Kept separate from the
// presentational component so neither surface's money/wiring logic has to
// live inside a .tsx file.

// variation/modifiers/instructions joined into ONE readable `sub` line —
// mirrors how PublicCartLine/StatusItemRow already show them (variation in
// parens next to the name, modifiers comma-joined, instructions italic) but
// folded into a single string since PublicBillLine has one sub slot, not three.
function joinSub(variation: string | undefined, modifiers: string[], instructions: string | undefined): string | undefined {
  const parts: string[] = [];
  if (variation) parts.push(variation);
  if (modifiers.length > 0) parts.push(modifiers.join(", "));
  if (instructions) parts.push(instructions);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function lineFromStatusItem(item: PublicStatusItem): PublicBillLine {
  return {
    label: item.name,
    sub: joinSub(item.variation, item.modifiers, item.instructions),
    qty: item.qty,
    amount: item.price * item.qty,
  };
}

// data.total is the SERVER's quoted total — the source of truth. It is
// rendered as-is, never recomputed from this function's own row arithmetic;
// if a caller's items/subtotal ever summed to something else, this still
// renders data.total (see the Total row below).
export function billFromStatusData(
  data: PublicOrderRequestStatusData,
  gst: PublicGstConfig,
): { lines: PublicBillLine[]; totals: PublicBillTotal[] } {
  const lines = data.items.map(lineFromStatusItem);

  const totals: PublicBillTotal[] = [{ label: "Subtotal", amount: data.subtotal }];

  if (data.charge > 0) {
    totals.push({ label: data.chargeLabel ?? "Table charge", amount: data.charge });
  }

  // GST is DERIVED, never stored (public.ts's own rule) — publicCartTotals is
  // the ONE shared computation; its gstAmount is used purely for DISPLAY here
  // and never folded back into data.total.
  //
  // TAXED ON THE DISCOUNTED BASE (review 2026-09-13, confirmed against
  // lib/receipt.ts:140-141 — `base = subtotal - clampedDiscount` then
  // computeExclusiveGst(base)). publicCartTotals takes NO discount argument
  // because its own header scopes it to "the one case a diner's CART can ever
  // be in: zero discount" — but a past ORDER can carry one, so the discount is
  // subtracted here BEFORE calling it. Passing the raw subtotal made the
  // printed rows disagree with the printed Total on every promo order.
  // Clamped the same way the server clamps it, so the two can never diverge.
  const discount = Math.min(Math.max(0, Math.round(data.quotedDiscount ?? 0)), data.subtotal);
  const { gstAmount } = publicCartTotals(data.subtotal - discount, data.charge, gst);
  if (gstAmount > 0) {
    totals.push({ label: `GST ${gst.rate}%`, amount: gstAmount });
  }

  if (discount > 0) {
    totals.push({ label: "Discount", amount: -discount });
  }

  // RECONCILIATION GUARD (review 2026-09-13). data.total is the server's word
  // and is always rendered verbatim, but the rows above are DERIVED — and the
  // gst config arrives from a SEPARATE fetch that can legitimately be missing
  // (the shell seeds { enabled: false } so a pre-load bill never invents tax).
  // Without this, a GST-exclusive order whose config had not loaded printed
  // Subtotal 1000 / Total 1180 with the tax line simply absent: rows that do
  // not add up, and nothing telling the diner why. Any unexplained remainder
  // is surfaced as one honest line instead of silently vanishing, so what the
  // diner reads ALWAYS reconciles to what they owe.
  const explained = totals.reduce((sum, t) => sum + t.amount, 0);
  const remainder = data.total - explained;
  if (remainder !== 0) {
    totals.push({ label: remainder > 0 ? "Taxes and charges" : "Adjustment", amount: remainder });
  }

  totals.push({ label: "Total", amount: data.total, strong: true });

  return { lines, totals };
}

// The live cart's twin — same output shape, so PublicCartBill can adopt
// PublicBillRows later without touching its money math. Every figure here is
// taken as a parameter, already computed by the caller's ONE publicCartTotals
// call (PublicCart.tsx) — this function derives nothing itself.
export function billFromCart(
  cart: CartLine[],
  subtotal: number,
  tableCharge: { amount: number; label: string } | null,
  gstAmount: number,
  gstRate: number,
  total: number,
): { lines: PublicBillLine[]; totals: PublicBillTotal[] } {
  const lines = cart.map((line) => ({
    label: line.name,
    sub: joinSub(line.variation, line.modifiers, line.instructions),
    qty: line.qty,
    amount: line.price * line.qty,
  }));

  const totals: PublicBillTotal[] = [{ label: "Subtotal", amount: subtotal }];

  if (tableCharge && tableCharge.amount > 0) {
    totals.push({ label: tableCharge.label, amount: tableCharge.amount });
  }

  if (gstAmount > 0) {
    totals.push({ label: `GST ${gstRate}%`, amount: gstAmount });
  }

  totals.push({ label: "Total", amount: total, strong: true });

  return { lines, totals };
}
