// The settle route's refusals that come BEFORE any pricing — pure, so
// app/api/orders/[id]/settle/route.ts and the live-leg verifier
// (scripts/verify-order-integrity-live.ts) refuse on the very same rules.
//
// The echo check is the void route's `expectedVoids` discipline applied to a
// settle: the client says which tab its bill was priced from (the tab's own
// stored total and void-trail length), and the route refuses once the tab no
// longer matches. The route prices every request from its OWN fresh read, and
// its CAS compares against that read — so without this, a settle sent after
// another device fired a round (above all a background RE-SEND, seconds or
// minutes after the cashier took the money) would close the bigger bill as
// paid in full. Both numbers are the server's own stored values echoed back,
// never a client computation, so a match can never deadlock on rounding.

/** Same words the void route and the partial-payment check already use. */
export const TAB_CHANGED = "Tab changed — reopen it and try again";

interface SettleTarget {
  status: string;
  total: number;
  voids?: readonly unknown[] | null;
}

export interface SettleSeen {
  /** The tab's stored total the operator's bill was priced from. */
  expectedTotal?: number;
  /** The tab's void-trail length at that moment. */
  expectedVoids?: number;
}

/** The 409 message for a settle that must not be priced at all, or null. An
 *  omitted echo is not checked (a caller that does not hold the tab it priced). */
export function settleRefusal(old: SettleTarget, seen: SettleSeen): string | null {
  // The Pending CAS would 409 anyway, but with a message that sends the
  // operator looking for a phantom concurrent edit.
  if (old.status === "Cancelled") return "Order was cancelled";
  if (old.status === "Completed") return "Order already settled";
  if (seen.expectedTotal !== undefined && seen.expectedTotal !== old.total) return TAB_CHANGED;
  // A void on a fully comped tab leaves the total at 0 — only the trail shows it.
  if (seen.expectedVoids !== undefined && seen.expectedVoids !== (old.voids?.length ?? 0)) return TAB_CHANGED;
  return null;
}
