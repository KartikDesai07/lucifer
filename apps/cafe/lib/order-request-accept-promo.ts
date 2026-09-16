import mongoose from "mongoose";
import { canonicalPromoMobile, resolvePromoDiscount, type PromoCodeConfig, type PromoKind } from "@pos/shared/public";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PromoRedemption } from "@/models/PromoRedemption";
import { mintedPromoCodes } from "@pos/shared/loyalty-rules";
import type { ISettings } from "@/models/Settings";

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
  // The amount the DINER was quoted, to be re-checked against what this code
  // resolves to NOW. CB-5D part 2 — `null` means "there was no quote": the
  // COUNTER types a code straight onto a live bill, so there is no earlier
  // figure to have drifted from and the comparison below must be SKIPPED.
  //
  // `null`, deliberately not `undefined`: a missing argument and "no quote"
  // have to be different things here. `undefined ?? 0` is 0, so an absent
  // quote used to read as "the diner was quoted ₹0" and every code actually
  // worth money failed the drift check — a counter promo of ₹50 resolved to
  // 50, compared 50 !== 0, and was refused as drifted. Only a 0-value item
  // promo got through, which inverts the feature: exactly the codes worth
  // something were the ones rejected.
  quotedDiscount: number | undefined | null,
  promoCodes: PromoCodeConfig[] | undefined,
  subtotal: number,
  // CB-5D part 2 FINAL — codes minted by a loyalty milestone, forwarded
  // straight into resolvePromoDiscount so a milestone-minted code fences
  // once-per-customer whether or not its Settings row is ticked. Callers
  // derive this with mintedPromoCodes (@pos/shared/loyalty-rules) from
  // settings?.loyaltyRules?.milestones.
  mintedCodes?: ReadonlySet<string> | readonly string[],
): { discount: number; kind?: PromoKind; oncePerCustomer?: boolean } | { error: string } {
  if (!promoCode) return { discount: 0 };
  const resolved = resolvePromoDiscount(promoCodes, promoCode, subtotal, mintedCodes);
  if ("error" in resolved) return { error: PROMO_DRIFT_ERROR };
  // A quote-less caller (the counter) skips drift entirely; every quoted
  // caller keeps today's exact behaviour, `undefined` included.
  if (quotedDiscount !== null && resolved.discount !== (quotedDiscount ?? 0)) {
    return { error: PROMO_DRIFT_ERROR };
  }
  // Omit-empty, same discipline as resolvePromoDiscount's own return —
  // callers (order-request-accept.ts / -write.ts) branch on this to decide
  // whether the redemption fence below even needs to run.
  return {
    discount: resolved.discount,
    // Carried so the redemption fence can tell a 0-value ITEM promo (a real
    // benefit) from a money promo that merely resolved to 0.
    kind: resolved.kind,
    ...(resolved.oncePerCustomer ? { oncePerCustomer: true } : {}),
  };
}

/** CB-5D part 2 FINAL — `resolveAcceptPromo` bound to a cafe's Settings.
 *
 *  Exists so no CALLER has to name `settings.loyaltyRules` just to learn which
 *  codes a milestone mints. That matters beyond tidiness: the add-round branch
 *  is pinned (reward-qr-wiring.test.ts, "prices a reward tab from the ORDER
 *  SNAPSHOT") never to touch the live loyalty ladder, because re-reading it
 *  there could re-price a reward the bill was already issued with. Deriving
 *  the minted list HERE keeps that branch honestly ladder-free while still
 *  fencing minted codes, and single-homes a derivation five call sites
 *  otherwise repeated verbatim.
 */
export function resolveAcceptPromoFor(
  settings: ISettings | null | undefined,
  promoCode: string | undefined,
  quotedDiscount: number | undefined | null,
  subtotal: number,
): ReturnType<typeof resolveAcceptPromo> {
  return resolveAcceptPromo(
    promoCode,
    quotedDiscount,
    settings?.promoCodes,
    subtotal,
    mintedPromoCodes(settings?.loyaltyRules?.milestones),
  );
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

// CB-5D part 2 — WHO is claiming this fence. The diner path claims for an
// OrderRequest; the counter path (app/api/orders/route.ts) claims for the
// orderId it is about to create, because a counter order is born from no
// request. Modelled as one discriminated union rather than two optional
// parameters so a caller cannot pass both or neither, and so the replay
// comparison below has exactly ONE key to compare no matter which surface
// claimed.
//
// NOTE the identity split this type deliberately preserves: the claimant is
// what distinguishes a REPLAY from a collision, while the fence itself is
// keyed on {code, mobile} — the customer's canonical mobile on BOTH surfaces.
// A counter claim keyed on customerId would give one human two fences.
export type PromoClaimant = { kind: "request"; id: string } | { kind: "order"; id: string };

/** The stored claimant key of an existing fence row, whichever surface wrote
 *  it. SINGLE-HOMED: the claim write and the replay compare both derive their
 *  key from this one function, so the two can never drift apart (the same
 *  discipline the canonical-requestId comment below states for case). */
export function claimantKeyOf(row: {
  requestId?: unknown;
  claimOrderId?: string;
}): string | undefined {
  if (row.claimOrderId !== undefined) return `order:${row.claimOrderId}`;
  return row.requestId != null ? `request:${String(row.requestId)}` : undefined;
}

/** The claimant key for a claim being MADE. Canonicalises an ObjectId-shaped
 *  request id for the reason documented at claimPromoRedemption (hex case),
 *  and leaves an orderId as-is — orderIds are server-minted and already
 *  canonical (generateOrderId), never user-supplied. */
export function claimantKeyFor(claimant: PromoClaimant): string {
  return claimant.kind === "request"
    ? `request:${new mongoose.Types.ObjectId(claimant.id).toString()}`
    : `order:${claimant.id}`;
}

export function decidePromoRedemption(
  dupKey: boolean,
  existingClaimantKey: string | undefined,
  claimantKey: string,
): PromoRedemptionDecision {
  if (!dupKey) return "claimed";
  return existingClaimantKey === claimantKey ? "replay" : "reject";
}

// The enforcement fence itself. Project lesson (cas-result-must-be-checked):
// the create's OUTCOME is what decides the result, never assumed — a
// duplicate-key error is read back and re-checked against THIS request's own
// id before deciding replay vs reject. Never called on the reject path (never
// -revert-on-write-throw's twin: a rejection must not claim a fence for a
// request that isn't proceeding).
//
// C14 — `requestId` arrives here as the raw URL path segment (both callers
// pass through acceptOrderRequest's own parameter, already past its own
// mongoose.isValidObjectId gate, so a constructor here cannot throw), and
// ObjectId hex is case-insensitive: the route's isValidObjectId gate accepts
// an UPPER-case id, but `existing.requestId` read back above is a real
// ObjectId whose String(...) is always canonical lower-case. Comparing the
// two as-is could read a legitimate replay (same request, different case) as
// a genuine collision — canonicalise this side, mirroring due-payment.ts's
// canonicalCustomerId idiom, so decidePromoRedemption always compares two
// canonical hex strings.
export async function claimPromoRedemption(
  code: string,
  mobile: string,
  claimant: PromoClaimant,
): Promise<PromoRedemptionDecision> {
  // Cold-start rule (crud-route.ts / due-payment.ts precedent): a write whose
  // correctness IS a unique index must await the index build first — on a
  // fresh cluster two concurrent claims could otherwise both land and the
  // deferred build then fails silently and permanently (review MAJOR #1).
  // Mongoose caches init(), so this is a one-time cost per process.
  await PromoRedemption.init();
  const fenceMobile = canonicalPromoMobile(mobile);
  // Derived ONCE and used for both the write and the compare below — the
  // whole point of claimantKeyFor being single-homed.
  const claimantKey = claimantKeyFor(claimant);
  try {
    // Write the CANONICAL id, not the raw URL segment. The stored path is an
    // ObjectId so Mongoose would cast either spelling (probe-verified), but
    // deriving the write and the compare from the SAME expression is what
    // keeps them in agreement — the schema type must not be the only thing
    // holding this fence together.
    // Exactly ONE claimant field is written, matching the claimant's own kind
    // — omit-empty, and it keeps "which surface claimed this" readable.
    await PromoRedemption.create({
      code,
      mobile: fenceMobile,
      ...(claimant.kind === "request"
        ? { requestId: new mongoose.Types.ObjectId(claimant.id).toString() }
        : { claimOrderId: claimant.id }),
    });
    return "claimed";
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const existing = await PromoRedemption.findOne({ code, mobile: fenceMobile })
      .select("requestId claimOrderId")
      .lean();
    return decidePromoRedemption(true, existing ? claimantKeyOf(existing) : undefined, claimantKey);
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
export async function releasePromoRedemption(claimant: PromoClaimant): Promise<void> {
  try {
    // Canonicalised for the same reason as the claim write above: the filter
    // and the stored value must be derived the same way, not rely on the
    // model's cast to reconcile two different spellings.
    //
    // CB-5D part 2 — the filter targets the SAME claimant field the claim
    // wrote, so a counter release can never delete a diner's fence row (or
    // vice versa) just because the two shared a code and a mobile.
    await PromoRedemption.deleteOne({
      ...(claimant.kind === "request"
        ? { requestId: new mongoose.Types.ObjectId(claimant.id).toString() }
        : { claimOrderId: claimant.id }),
      orderId: { $exists: false },
    });
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
/** Whether an applied promo actually needs its once-per-customer fence claimed.
 *
 *  SINGLE-HOMED on purpose: three accept-path call sites ask this question, and
 *  three copies of the predicate is exactly the reciprocal-guard failure this
 *  repo has already paid for — one copy updated, the others silently stale.
 *
 *  Keys on PRESENCE + a real benefit, never on the amount alone. Since CB-5D
 *  widened PROMO_KINDS with "item", a promo's money value can legitimately be
 *  0 (a free dish's benefit is the LINE, not rupees off), so the previous
 *  `discount > 0` test skipped the fence entirely for item promos — a
 *  once-per-customer free-item code could then be redeemed without limit.
 */
export function promoIsClaimable(
  discount: number,
  // A TYPE GUARD on this parameter, not just a boolean: the call sites used to
  // narrow `request.promoCode` with an inline `&& request.promoCode` before
  // passing it to claimPromoRedemption, and folding that test in here would
  // otherwise hide the narrowing from the compiler — leaving a `string |
  // undefined` to reach a fence that requires a definite code.
  promoCode: string | undefined,
  // The resolved KIND. An "item" promo is claimable at a 0 amount because its
  // benefit is the free line; every money kind still has to be worth something
  // before a fence is burned, so a percent code that resolved to 0 (a tiny
  // bill, floored to nothing) keeps today's behaviour and claims nothing.
  kind: PromoKind | undefined,
): promoCode is string {
  if (!promoCode) return false;
  return kind === "item" ? true : discount > 0;
}

export function promoNoteLine(promoCode: string | undefined, discount: number): string | undefined {
  return discount > 0 && promoCode ? `PROMO ${promoCode} -₹${discount}` : undefined;
}
