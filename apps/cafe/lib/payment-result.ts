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
