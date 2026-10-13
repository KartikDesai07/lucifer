import type { PaymentMode } from "@/lib/constants";

// Pure, client-safe: what the PaymentModal hands back to its caller, and the
// single-source rule for turning that into what the server actually receives.

// What the parent needs to assemble the order payload's payment fields.
export interface PaymentResult {
  payment: PaymentMode;
  paidAmount: number; // what the modal showed as collected
  partial: boolean; // true only when the operator deliberately collected less than the bill
  splitCash?: number;
  splitOnline?: number;
  // CB-7 S6 — whole reward points the operator ticked to spend on this bill (1 point = ₹1); absent = none.
  rewardPoints?: number;
}

// The amount to SEND to the server. `undefined` means "pay in full" — the server
// then settles against ITS OWN freshly-computed total. Sending the modal's number
// on a full payment is what let a stale client view become a silent customer due.
export function collectedAmount(result: PaymentResult): number | undefined {
  return result.partial ? result.paidAmount : undefined;
}

// F8 — the popup resets its pay mode only when it OPENS. A bill that changes
// while it is open (a reward arming, a tab refreshed from another device)
// keeps the mode the operator picked and says the bill changed instead.
// `pointsOn` = the operator's "Use points" switch (absent = off). Flipping it is their own act and moves the total:
// that is "rebaselined", not "the bill changed". The switch STATE is what counts, never the amount: a balance refetch
// that moves the amount while the switch stays on is a real change under the operator.
export type PopupSnapshot = { open: boolean; total: number; pointsOn?: boolean };
export type SplitAmounts = { cash: number; online: number };

export function paymentPopupChange(
  prev: PopupSnapshot,
  next: PopupSnapshot,
): "opened" | "rebaselined" | "bill-changed" | "none" {
  if (next.open && !prev.open) return "opened";
  if (next.open && next.total !== prev.total) {
    return (next.pointsOn ?? false) !== (prev.pointsOn ?? false) ? "rebaselined" : "bill-changed";
  }
  return "none";
}

// Online is money already seen arriving; Cash takes the rest (never below 0 —
// a sum that no longer matches keeps the popup's split mismatch blocking).
// The "opened with" total after the operator's own toggle: it moves by ONLY the toggle's delta, so a real change that
// happened earlier (a table refresh, say) stays named by the "bill changed" line.
export function openedTotalAfterToggle(opened: number, prevTotal: number, nextTotal: number): number {
  return opened + (nextTotal - prevTotal);
}

export function splitAfterBillChange(s: SplitAmounts, total: number): SplitAmounts {
  return { cash: Math.max(0, total - s.online), online: s.online };
}
