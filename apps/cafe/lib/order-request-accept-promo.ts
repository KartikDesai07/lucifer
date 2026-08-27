import { canonicalPromoMobile, resolvePromoDiscount, type PromoCodeConfig } from "@pos/shared/public";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PromoRedemption } from "@/models/PromoRedemption";

// Fourth sibling of lib/order-request-accept.ts / -core.ts / -write.ts (CR2.2
// SLICE 4, CR2.2d split) — split out for the ~300 cap; the semantics live
// with their pins (lib/order-request-accept.test.ts, lib/order-request-paths
// .test.ts's combined drift-fence pin). Holds the promo-drift fence itself
// plus the note-line composition glue both accept-bridge branches (add-round
// and create/parcel) use to turn a resolved discount into the
// staff-actionable "PROMO CODE -₹N" line mergedNote appends.
//
// SPEC P4 (CR2.2c follow-up) added the once-per-customer REDEMPTION fence
// itself (claimPromoRedemption/decidePromoRedemption/
// backfillPromoRedemptionOrderId below) — the accept bridge's two branches
// (order-request-accept.ts's create/parcel case, order-request-accept-write
// .ts's acceptAddRoundBranch) both call in here, BEFORE their own order
// write, never the other way around (a circular import with -write.ts would
// otherwise result — guardedReject stays each caller's own concern).

// CR2.2c — the promo code drift fence: a stored `promoCode` is a PROMISE
// (what the diner saw at quote time), never a money INPUT. This re-resolves
// it from LIVE Settings against the RECOMPUTED subtotal; if the code no
// longer resolves at all, OR resolves to a DIFFERENT amount than what was
// quoted, that is drift — same staff-actionable-rejection shape as
// PRICE_DRIFT_ERROR. No stored code ⇒ discount 0, no drift possible.
export const PROMO_DRIFT_ERROR =
  "The promo code on this order is no longer valid — reject it and ask the customer to order again";

export function resolveAcceptPromo(
  promoCode: string | undefined,
  quotedDiscount: number | undefined,
  promoCodes: PromoCodeConfig[] | undefined,
  subtotal: number,
): { discount: number; oncePerCustomer?: boolean } | { error: string } {
  if (!promoCode) return { discount: 0 };
  const resolved = resolvePromoDiscount(promoCodes, promoCode, subtotal);
  if ("error" in resolved) return { error: PROMO_DRIFT_ERROR };
  if (resolved.discount !== (quotedDiscount ?? 0)) return { error: PROMO_DRIFT_ERROR };
  // Omit-empty, same discipline as resolvePromoDiscount's own return —
  // callers (order-request-accept.ts / -write.ts) branch on this to decide
  // whether the redemption fence below even needs to run.
  return { discount: resolved.discount, ...(resolved.oncePerCustomer ? { oncePerCustomer: true } : {}) };
}

// SPEC P4 — staff-actionable copy for the fence's genuine-collision case
// (a DIFFERENT request already claimed this code+mobile). Distinct from
// PROMO_ALREADY_USED (@pos/shared/public), which is the diner-facing 422 at
// quote time — this one tells staff what to DO about a request that reached
// accept anyway (a race with the courtesy check, or a code that became
// oncePerCustomer after this request was quoted).
export const PROMO_USED_ERROR =
  "This customer already used this promo code — reject this request and ask them to order again without it";

// Pure decision half of the fence's dup-key branch, DB-free and directly
// unit-testable — mirrors guardedRejectDecision's own split
// (order-request-accept-write.ts). A duplicate row carrying THIS SAME
// requestId is a repair/replay of our own accept (the CAS entry into
// "accepting" is re-enterable by design — a retried accept must RESUME, not
// be told the code is used against itself); any OTHER requestId means a
// genuinely different request already holds the fence.
export type PromoRedemptionDecision = "claimed" | "replay" | "reject";

export function decidePromoRedemption(
  dupKey: boolean,
  existingRequestId: string | undefined,
  requestId: string,
): PromoRedemptionDecision {
  if (!dupKey) return "claimed";
  return existingRequestId === requestId ? "replay" : "reject";
}

// The enforcement fence itself. Project lesson (cas-result-must-be-checked):
// the create's OUTCOME is what decides the result, never assumed — a
// duplicate-key error is read back and re-checked against THIS request's own
// id before deciding replay vs reject. Never called on the reject path (never
// -revert-on-write-throw's twin: a rejection must not claim a fence for a
// request that isn't proceeding).
export async function claimPromoRedemption(
  code: string,
  mobile: string,
  requestId: string,
): Promise<PromoRedemptionDecision> {
  // Cold-start rule (crud-route.ts / due-payment.ts precedent): a write whose
  // correctness IS a unique index must await the index build first — on a
  // fresh cluster two concurrent claims could otherwise both land and the
  // deferred build then fails silently and permanently (review MAJOR #1).
  // Mongoose caches init(), so this is a one-time cost per process.
  await PromoRedemption.init();
  const fenceMobile = canonicalPromoMobile(mobile);
  try {
    await PromoRedemption.create({ code, mobile: fenceMobile, requestId });
    return "claimed";
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const existing = await PromoRedemption.findOne({ code, mobile: fenceMobile }).select("requestId").lean();
    return decidePromoRedemption(true, existing?.requestId, requestId);
  }
}

// Releases a fence THIS request claimed but never turned into an order —
// keyed on requestId AND orderId-absent, so it can never free a redemption
// whose order write landed (the backfill sets orderId; even a failed
// backfill is safe: that path never reaches a reject, the accept succeeded).
// Called ONLY after a DEFINITE reject landed (the reject CAS matched) — the
// one compensating delete the never-revert-on-write-throw lesson permits,
// because the no-order outcome is proven, not inferred from a throw.
// Best-effort: a missed release costs one customer one code (staff can clear
// it by re-accepting), never a wrong bill.
export async function releasePromoRedemption(requestId: string): Promise<void> {
  try {
    await PromoRedemption.deleteOne({ requestId, orderId: { $exists: false } });
  } catch {
    /* best-effort — see comment above */
  }
}

// Best-effort AFTER the order write succeeds — never blocking, failure
// swallowed. The redemption row (claimed above) IS the fence; this backfill
// is only a trace for staff/ops to see which order actually consumed it, so a
// throw here must never undo or retry the order write that already landed
// (never-revert-on-write-throw).
export async function backfillPromoRedemptionOrderId(code: string, mobile: string, orderId: string): Promise<void> {
  try {
    await PromoRedemption.updateOne({ code, mobile: canonicalPromoMobile(mobile) }, { $set: { orderId } });
  } catch {
    /* best-effort — see comment above */
  }
}

// FIX6 — the diner's note, carried onto the Order, gets a staff-actionable
// promo line appended (CR2.2c) whenever a discount actually applied. Pure
// glue split out of order-request-accept.ts's own two branches (create and
// add-round composed this identically, inline, before this split) so both
// call one function instead of repeating the ternary.
export function promoNoteLine(promoCode: string | undefined, discount: number): string | undefined {
  return discount > 0 && promoCode ? `PROMO ${promoCode} -₹${discount}` : undefined;
}
