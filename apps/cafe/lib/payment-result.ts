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
export type PopupSnapshot = { open: boolean; total: number };
export type SplitAmounts = { cash: number; online: number };

export function paymentPopupChange(prev: PopupSnapshot, next: PopupSnapshot): "opened" | "bill-changed" | "none" {
  if (next.open && !prev.open) return "opened";
  if (next.open && next.total !== prev.total) return "bill-changed";
  return "none";
}

// Online is money already seen arriving; Cash takes the rest (never below 0 —
// a sum that no longer matches keeps the popup's split mismatch blocking).
export function splitAfterBillChange(s: SplitAmounts, total: number): SplitAmounts {
  return { cash: Math.max(0, total - s.online), online: s.online };
}
