import type { IOrder, IOrderItem } from "@/models/Order";
import type { IOrderRequest } from "@/models/OrderRequest";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import { printedSlipNumber, type PrintConfig } from "@/lib/print";
import { nextSlipSequence } from "@/models/Counter";
import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import type { DiscountKind } from "@pos/shared/constants";
import {
  shouldStoreDiscountKind,
  rewardFromOrderSnapshot,
  type RedeemedReward,
} from "@pos/shared/reward-redemption";
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";
import { buildKotFiredAt, buildKotNumbers, mergedNote } from "@/lib/order-request-accept-core";
import {
  resolveAcceptPromoFor,
  promoNoteLine,
  claimPromoRedemption,
  backfillPromoRedemptionOrderId,
  PROMO_USED_ERROR,
  promoIsClaimable,
} from "@/lib/order-request-accept-promo";
import { assignedRewardRefusal, markAssignedRewardUsed } from "@/lib/assigned-reward-gate";
import { guardedReject, applyAddRound } from "@/lib/order-request-accept-write";
import type { AcceptContext } from "@/lib/order-request-accept";

// CB-5B S7 — FIFTH sibling of lib/order-request-accept.ts / -core.ts /
// -write.ts / -promo.ts. `acceptAddRoundBranch` moved here VERBATIM from
// -write.ts (which was at 285 lines, at this repo's ~300-line cap) purely for
// the line budget, so the three-kind discount logic S7 adds has somewhere to
// land. The WRITE it ends in (applyAddRound) deliberately stays in -write.ts
// beside the other race-repair helpers; this file holds the branch's own
// orchestration only. order-request-accept.ts still owns classifyTarget's
// decision of WHICH branch to run — it only calls this one once it knows.
//
// Source pins that read the add-round branch's text were RE-POINTED to this
// path (gst-discount.test.ts, order-request-paths.test.ts), never loosened —
// splitting a file silently voids a pin that reads it by path.

// CB-5B A2 (owner decision D6) — REWARD AND PROMO ARE MUTUALLY EXCLUSIVE. A
// bill carries one or the other, never both, because an Order has exactly ONE
// scalar `discount` and ONE `discountKind`: composing them would spend the
// diner's stamps into a line the receipt then labels with the other reason.
// The refusal is staff-actionable — the request is rejected and the diner
// re-orders without the code — never a silent merge.
export const REWARD_PROMO_CONFLICT_ERROR =
  "This tab already has a stamp reward applied — reject this request and ask the customer to order again without the promo code";

/**
 * Which `discountKind` an add-round must price and store, from the kind the
 * TAB already carries and the promo this round resolved.
 *
 * Replaces the shipped `keepGstKind` boolean (`openTab.discountKind === "gst"
 * && promo.discount === 0`), which knew only one kind. A `"reward"` tab fell
 * through it to `undefined`, so a public QR add-round `$unset` the kind and
 * re-priced the whole bill at FULL price while the diner's stamps stayed
 * spent — the customer lost the money AND the stamps. That is the same
 * defect class session 34 fixed on all three STAFF re-pricing writers; this
 * is its QR-path twin.
 *
 * - `"reward"` + no promo -> keep `"reward"`; the server re-derives the amount
 *   from the Order's own stored snapshot (never the live ladder).
 * - `"reward"` + a promo -> `"conflict"`. A2/D6: the promo is REFUSED at the
 *   promo-resolution step, not merged. The caller rejects the request.
 * - `"gst"` + no promo -> keep `"gst"` (the shipped C5 meaning, unchanged).
 * - `"gst"` + a promo -> `undefined`: the GST part and the promo collapse into
 *   one plain manual discount, which the receipt honestly labels "Discount"
 *   (the shipped gst+promo precedent — unchanged by S7).
 * - no stored kind -> `undefined`, promo or not (a diner add-round never
 *   ORIGINATES a staff kind).
 */
export type AddRoundKind = DiscountKind | undefined | "conflict";

export function resolveAddRoundKind(
  storedKind: DiscountKind | undefined,
  promoDiscount: number,
  // CB-5D — whether a promo code is PRESENT at all, independent of what it is
  // worth. Load-bearing since PROMO_KINDS gained "item": a free-item promo's
  // money value is 0 BY CONSTRUCTION (its benefit is the free LINE, the same
  // single-skip discipline a reward item uses), so the amount-keyed test below
  // read it as "no promo" and let it compose onto a reward-carrying tab — the
  // exact pair D6 exists to keep apart. The repo's own rule, paid for once
  // already: a fence for a kind whose amount can legitimately be 0 must key on
  // PRESENCE, never on the amount.
  hasPromoCode: boolean,
): AddRoundKind {
  if (storedKind === "reward") return promoDiscount > 0 || hasPromoCode ? "conflict" : "reward";
  // The gst arm stays keyed on AMOUNT only, deliberately: a gst tab and a
  // 0-value item promo COMPOSE (they are not a mutually exclusive pair), so
  // widening this arm would start refusing a combination that is legal today.
  if (storedKind === "gst" && promoDiscount === 0) return "gst";
  return undefined;
}

// The add-round target's own orchestration — the promo re-resolve scoped to
// THIS round's own items (CR2.2c), the three-kind discount resolution (S7),
// the KOT ticket, and the diner-note/promo-line composition (FIX6) — ending in
// -write.ts's applyAddRound. The GST-drift re-check (FIX5) against the tab's
// own frozen snapshot stays in order-request-accept.ts, which computes
// `tabGstCfg` BEFORE calling here (it must 409 without ever reaching this
// function).
export async function acceptAddRoundBranch(
  request: IOrderRequest,
  openTab: Pick<
    IOrder,
    | "_id"
    | "kotRounds"
    | "voids"
    | "items"
    | "discount"
    | "discountKind"
    | "chargeAmount"
    | "charges"
    | "kotNumbers"
    | "kotFiredAt"
    | "createdAt"
    | "notes"
    | "rewardAt"
    | "rewardKind"
    | "rewardValue"
    | "rewardItem"
    | "rewardItemProductId"
    | "rewardQty"
  >,
  items: Omit<IOrderItem, "kotRound">[],
  tabGstCfg: GstConfig,
  printCfg: PrintConfig,
  requestId: string,
  ctx: AcceptContext,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean } | { error: string; status: 409 }> {
  const round = (openTab.kotRounds ?? 0) + 1;
  const fullItems = [...openTab.items, ...items.map((it) => ({ ...it, kotRound: round }))];
  // CB-CHG — a QR round carries the tab's charges through UNCHANGED (never
  // originates/drops one — that is staff-only); chargesFromOrder upgrades a
  // legacy scalar-only tab in memory, money-neutral by construction. Split
  // (never summed) for computeOrderTotals: the table portion keeps its
  // shipped TABLE_CHARGE_MAX ceiling, extras ride on top uncapped (decision 8).
  const openTabCharges = chargesFromOrder(openTab);
  const { table: openTabTableCharge, extra: openTabExtraCharge } = splitChargeTotals(openTabCharges);

  // CR2.2c — promo re-resolved from LIVE Settings against the RECOMPUTED
  // subtotal of THIS ROUND's own items — never the tab's fullItems: an open
  // tab's subtotal also carries earlier rounds the diner never quoted
  // against (the SAME scoping the line-price drift check above uses —
  // priced.lines vs request.items, never a whole-order total), so a
  // percent code would otherwise "drift" on every add-round purely because
  // the tab already has items on it. A discount:0 probe reads the subtotal
  // without forking computeOrderTotals.
  const subtotalProbe = computeOrderTotals({
    items, discount: 0, discountKind: undefined, charge: 0, cfg: tabGstCfg,
  });
  // CB-5D part 2 FINAL — a milestone-minted code is single-use regardless of
  // its Settings row's own tick (owner: "code sirf usi customer ka, ek baar").
  const promo = resolveAcceptPromoFor(
    ctx.settings,
    request.promoCode,
    request.quotedDiscount,
    subtotalProbe.subtotal,
  );
  if ("error" in promo) return guardedReject(requestId, ctx.actor, promo.error);
  // CB-5D part 2 DEFECT FIX — same single-homed expiry gate as the
  // create/parcel branch (order-request-accept.ts) and the quote-time paths
  // (lib/assigned-reward-gate.ts). An add-round is a real accept-time money
  // write too, so it needs the same fence, checked AFTER resolveAcceptPromo
  // succeeds so a drifted/invalid code still reports drift, never "expired".
  if (request.promoCode) {
    const expired = await assignedRewardRefusal(request.promoCode, request.mobile, Date.now());
    if (expired) return guardedReject(requestId, ctx.actor, expired);
  }

  // The tab's own (staff-applied) discount and the resolved promo COMPOSE —
  // one write via the existing `discount: totals.discount` below, never a
  // separate $inc (a $inc racing a concurrent staff discount edit would be
  // a second, untracked source of truth for the same field).
  //
  // C5 — a staff-applied "GST Discount" (openTab.discountKind === "gst")
  // must be PRESERVED here, never originated (a diner add-round never picks
  // "gst" on its own) and never double-applied (composing the tab's stored
  // `discount` amount with a fresh GST re-derive would count the GST twice).
  // S7 widened this from the two-way `keepGstKind` to the three-kind
  // resolveAddRoundKind above; the gst arms below are byte-unchanged in
  // meaning, and "reward" is handled as its OWN non-composing branch.
  const resolvedKind = resolveAddRoundKind(openTab.discountKind, promo.discount, Boolean(request.promoCode));

  // A2/D6 FENCE, DIRECTION 1 — a promo arriving onto a reward-carrying tab is
  // REFUSED. The reciprocal fence (a reward claim arriving onto a tab/request
  // that already carries a promo) lives in the claim path itself (S8:
  // app/api/public/order-request/route.ts) — every writer of a mutually
  // exclusive pair must guard it, or the pair only holds from one side.
  if (resolvedKind === "conflict") return guardedReject(requestId, ctx.actor, REWARD_PROMO_CONFLICT_ERROR);

  // The gst arm of resolveAddRoundKind IS the old `keepGstKind` boolean: the
  // probe below fires on exactly its complement (a gst tab WITH a promo), so
  // the shipped C5 split is preserved without a second binding to drift.
  const gstPart =
    openTab.discountKind === "gst" && promo.discount > 0
      ? computeOrderTotals({
          items: fullItems, discount: 0, discountKind: "gst",
          charge: openTabTableCharge, extraCharge: openTabExtraCharge, cfg: tabGstCfg,
        }).discount
      : undefined;

  // CB-5B S7 — the reward this round must price against, rebuilt from the
  // Order's OWN stored snapshot. Load-bearing, not defensive: `discountKind`
  // carries forward as "reward" for a tab that claimed one, and
  // `rewardDiscountAmount` (lib/receipt.ts) returns 0 for a MISSING reward
  // because it fails CLOSED. So pricing this round without rebuilding it
  // would silently re-bill the tab at FULL price while the stamps stayed
  // spent. Rebuilt from the snapshot rather than re-read from the live
  // ladder, so a rung the owner retunes mid-service cannot re-price an
  // issued reward (the years-later reprint contract, public-diner.ts).
  const rewardForTotals: RedeemedReward | undefined =
    resolvedKind === "reward" ? rewardFromOrderSnapshot(openTab) : undefined;

  const totals = computeOrderTotals({
    items: fullItems,
    // A "reward" round re-derives its own amount from the snapshot above, so
    // the stored scalar is NOT carried in as a manual figure (that would be
    // the reward counted twice). Every other kind keeps the shipped
    // composition exactly.
    discount:
      resolvedKind === "reward"
        ? 0
        : gstPart !== undefined
          ? gstPart + promo.discount
          : openTab.discount + promo.discount,
    discountKind: resolvedKind,
    charge: openTabTableCharge,
    extraCharge: openTabExtraCharge,
    cfg: tabGstCfg,
    ...(rewardForTotals ? { reward: rewardForTotals } : {}),
  });
  const ticket = printCfg.kot.showNumber
    ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
    : undefined;
  const kotNumbers = buildKotNumbers(openTab.kotNumbers, round, ticket);
  // P4-A — this path is the SECOND writer of kotRounds (a diner's QR round,
  // accepted by staff). It must stamp the fire time too, or the kitchen board
  // ages this round from the tab's open time and shows it "Late" on arrival.
  const kotFiredAt = buildKotFiredAt(openTab.kotFiredAt, round, new Date(), openTab.createdAt);
  // FIX6 — carry the diner's note (and a promo line, when a discount
  // applied — promoNoteLine, order-request-accept-promo.ts) onto the tab,
  // through the EXISTING mergedNote helper both times so it composes with
  // whatever's already there. Omitted entirely (not blanked) when NEITHER changed.
  const promoLine = promoNoteLine(request.promoCode, promo.discount);
  const notesChanged = Boolean(request.note) || Boolean(promoLine);
  const notes = notesChanged ? mergedNote(mergedNote(openTab.notes, request.note), promoLine) : undefined;
  // CB-CHG — openTabCharges written back UNCHANGED, through the ONE shared
  // writer helper so the mirror can never drift, same as every other writer.
  const chargeFields = chargeWriteFields(openTabCharges);
  const update: Record<string, unknown> = {
    $set: {
      items: fullItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      gstAmount: totals.gstAmount,
      total: totals.total,
      kotRounds: round,
      kotFiredAt,
      source: SELF_ORDER_SOURCE,
      ...(chargeFields.set ?? {}),
      ...(kotNumbers ? { kotNumbers } : {}),
      ...(notesChanged ? { notes } : {}),
    },
    $addToSet: { sourceRequestIds: requestId },
  };
  const unset: Record<string, ""> = { ...(chargeFields.unset ?? {}) };
  // The kind is never $set here (the tab's stored value survives UNWRITTEN
  // when it is kept) — this only decides whether to REMOVE it. The shared
  // amount-gates-kind predicate is what makes a "reward" tab survive:
  // an item reward's derived amount is ₹0 by construction, so an amount-only
  // gate would $unset the kind — and with it the provenance of stamps the
  // diner has already spent — on exactly the orders that spent them.
  if (openTab.discountKind !== undefined && !shouldStoreDiscountKind(totals.discount, resolvedKind))
    unset.discountKind = "";
  if (Object.keys(unset).length > 0) update.$unset = unset;

  // SPEC P4 — the once-per-customer fence, BEFORE the tab write below (same
  // discipline as the create/parcel branch in order-request-accept.ts).
  // Runs AFTER the A2 conflict refusal above, so a request that is going to
  // be rejected for a reward conflict never claims a promo fence it will not
  // use (the never-claim-on-the-reject-path rule, -promo.ts).
  // CB-5D — `promo.claimed` (presence + a real benefit), NOT `discount > 0`:
  // an "item" promo is worth 0 RUPEES by construction (its benefit is the free
  // LINE), so the old amount-keyed test skipped the fence entirely and a
  // once-per-customer free-item code could be spent again and again.
  if (promo.oncePerCustomer && promoIsClaimable(promo.discount, request.promoCode, promo.kind)) {
    const fenceDecision = await claimPromoRedemption(request.promoCode, request.mobile, { kind: "request", id: requestId });
    if (fenceDecision === "reject") return guardedReject(requestId, ctx.actor, PROMO_USED_ERROR);
  }

  // 7. Write + CAS-miss (guardedReject'd, FIX1) + dup-key repair live in
  // applyAddRound (-write.ts).
  const result = await applyAddRound(openTab, update, requestId, ctx.actor);
  // SPEC P4 — best-effort backfill (never blocking), same discipline as the
  // create/parcel branch — only once the write actually landed.
  if (!("error" in result) && promo.oncePerCustomer && request.promoCode) {
    await backfillPromoRedemptionOrderId(request.promoCode, request.mobile, result.order.orderId);
  }
  // CB-5D part 2 (owner decision) — the ASSIGNED code is now SPENT, so it
  // leaves the diner's "my rewards" list. Best-effort, beside the backfill
  // and under the same rule: the fence claimed BEFORE the write is what
  // stops a second spend, so a failure here costs only a stale list row.
  if (!("error" in result) && request.promoCode) {
    await markAssignedRewardUsed(request.promoCode, request.mobile, result.order.orderId, new Date());
  }
  return result;
}
