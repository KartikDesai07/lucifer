import { Order, type IOrder, type IOrderItem } from "@/models/Order";
import type { IOrderRequest } from "@/models/OrderRequest";
import { Customer, type ICustomer } from "@/models/Customer";
import { isDuplicateKeyError } from "@pos/shared/api";
import { generateOrderId, dayRange } from "@/lib/utils";
import { bumpOrderSequenceTo, nextSlipSequence } from "@/models/Counter";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import { printedSlipNumber, type PrintConfig } from "@/lib/print";
import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import {
  TAB_CHANGED_ERROR,
  buildAddRoundFilter,
  buildKotNumbers,
  mergedNote,
  findByRequestId,
  reject,
  finalizeAccept,
} from "@/lib/order-request-accept-core";
import {
  resolveAcceptPromo,
  promoNoteLine,
  claimPromoRedemption,
  backfillPromoRedemptionOrderId,
  PROMO_USED_ERROR,
} from "@/lib/order-request-accept-promo";
import type { AcceptContext } from "@/lib/order-request-accept";

// Third sibling of lib/order-request-accept.ts / -core.ts (CR2.2 SLICE 4 +
// arbiter-confirmed review fixes) — split out purely to stay under the
// ~300-line file budget after the fixes landed. Holds the race-repair
// helpers that both branches (add-round here, create/parcel in
// order-request-accept.ts itself) call into: guardedReject (FIX1),
// applyAddRound (the add-round write built on it), createOrFindCustomer
// (FIX7), and recoverOrderCreate (the create path's own dup-key repair,
// moved here from -core.ts for the same line-budget reason). None of these
// decide WHICH branch to run — order-request-accept.ts stays the one
// orchestrator. gstConfigDrifted and isSourceRequestIdsDuplicate (bottom of
// this file, CR2.2d split) moved here from -core.ts purely for ITS own
// line-budget reason — same discipline, no logic changed.
//
// CR2.2d split (accept.ts itself still over budget after the promo move) —
// acceptAddRoundBranch below is the WHOLE add-round target's own
// orchestration, moved here verbatim: it already ends by calling this
// file's own applyAddRound, so the branch and its write land in the same
// file. order-request-accept.ts still owns classifyTarget's decision of
// WHICH branch to run — it only calls this one once it already knows.

// FIX1 — the loser-reject race. Every validation-failure/CAS-miss reject that
// can run concurrently with ANOTHER accept attempt's own write for this SAME
// requestId (a retried/duplicate call re-entering "accepting" — step 2 of
// acceptOrderRequest is deliberately re-enterable) must repair-before-revert:
// Mongo serializes the competing findOneAndUpdates on the Order document, so
// if a winner's write already landed, this loser's own miss/failure strictly
// follows it — a subsequent findByRequestId read here is guaranteed to see
// it. Reverting to "pending" WITHOUT this check would strand an
// already-applied request at a non-terminal status forever. Mirrors the
// step-7 dup-key repair (applyAddRound/recoverOrderCreate) exactly.
export type GuardedRejectDecision = "replay" | "revert";

// Pure decision half of guardedReject, split out so it's directly
// unit-testable without a DB — mirrors decideOnStatus's own DB-free
// decision-table discipline (order-request-accept-core.ts).
export function guardedRejectDecision(orderExists: boolean): GuardedRejectDecision {
  return orderExists ? "replay" : "revert";
}

export async function guardedReject(
  requestId: string,
  actor: string,
  error: string,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean } | { error: string; status: 409 }> {
  const winner = await findByRequestId(requestId);
  return guardedRejectDecision(winner != null) === "replay" && winner
    ? finalizeAccept(winner, requestId, actor, true)
    : reject(requestId, error);
}

// The add-round target's own orchestration — moved verbatim from
// order-request-accept.ts (CR2.2d split): the promo re-resolve scoped to
// THIS round's own items (CR2.2c), the KOT ticket, and the diner-note/
// promo-line composition (FIX6) — ending in the applyAddRound write right
// below. The GST-drift re-check (FIX5) against the tab's own frozen
// snapshot stays in order-request-accept.ts, which computes `tabGstCfg`
// BEFORE calling here (it must 409 without ever reaching this function).
export async function acceptAddRoundBranch(
  request: IOrderRequest,
  openTab: Pick<IOrder, "_id" | "kotRounds" | "voids" | "items" | "discount" | "chargeAmount" | "kotNumbers" | "notes">,
  items: Omit<IOrderItem, "kotRound">[],
  tabGstCfg: GstConfig,
  printCfg: PrintConfig,
  requestId: string,
  ctx: AcceptContext,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean } | { error: string; status: 409 }> {
  const round = (openTab.kotRounds ?? 0) + 1;
  const fullItems = [...openTab.items, ...items.map((it) => ({ ...it, kotRound: round }))];

  // CR2.2c — promo re-resolved from LIVE Settings against the RECOMPUTED
  // subtotal of THIS ROUND's own items — never the tab's fullItems: an open
  // tab's subtotal also carries earlier rounds the diner never quoted
  // against (the SAME scoping the line-price drift check above uses —
  // priced.lines vs request.items, never a whole-order total), so a
  // percent code would otherwise "drift" on every add-round purely because
  // the tab already has items on it. A discount:0 probe reads the subtotal
  // without forking computeOrderTotals.
  const subtotalProbe = computeOrderTotals({ items, discount: 0, charge: 0, cfg: tabGstCfg });
  const promo = resolveAcceptPromo(request.promoCode, request.quotedDiscount, ctx.settings?.promoCodes, subtotalProbe.subtotal);
  if ("error" in promo) return guardedReject(requestId, ctx.actor, promo.error);

  // SPEC P4 — the once-per-customer fence, BEFORE the tab write below (same
  // discipline as the create/parcel branch in order-request-accept.ts).
  if (promo.oncePerCustomer && promo.discount > 0 && request.promoCode) {
    const fenceDecision = await claimPromoRedemption(request.promoCode, request.mobile, requestId);
    if (fenceDecision === "reject") return guardedReject(requestId, ctx.actor, PROMO_USED_ERROR);
  }

  // The tab's own (staff-applied) discount and the resolved promo COMPOSE —
  // one write via the existing `discount: totals.discount` below, never a
  // separate $inc (a $inc racing a concurrent staff discount edit would be
  // a second, untracked source of truth for the same field).
  const totals = computeOrderTotals({
    items: fullItems,
    discount: openTab.discount + promo.discount,
    charge: openTab.chargeAmount ?? 0,
    cfg: tabGstCfg,
  });
  const ticket = printCfg.kot.showNumber
    ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
    : undefined;
  const kotNumbers = buildKotNumbers(openTab.kotNumbers, round, ticket);
  // FIX6 — carry the diner's note (and a promo line, when a discount
  // applied — promoNoteLine, order-request-accept-promo.ts) onto the tab,
  // through the EXISTING mergedNote helper both times so it composes with
  // whatever's already there. Omitted entirely (not blanked) when NEITHER changed.
  const promoLine = promoNoteLine(request.promoCode, promo.discount);
  const notesChanged = Boolean(request.note) || Boolean(promoLine);
  const notes = notesChanged ? mergedNote(mergedNote(openTab.notes, request.note), promoLine) : undefined;
  const update: Record<string, unknown> = {
    $set: {
      items: fullItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      gstAmount: totals.gstAmount,
      total: totals.total,
      kotRounds: round,
      source: SELF_ORDER_SOURCE,
      ...(totals.charge > 0 ? { chargeAmount: totals.charge } : {}),
      ...(kotNumbers ? { kotNumbers } : {}),
      ...(notesChanged ? { notes } : {}),
    },
    $addToSet: { sourceRequestIds: requestId },
  };
  if (totals.charge <= 0) update.$unset = { chargeAmount: "", chargeLabel: "" };

  // 7. Write + CAS-miss (guardedReject'd, FIX1) + dup-key repair live in
  // applyAddRound (right below).
  const result = await applyAddRound(openTab, update, requestId, ctx.actor);
  // SPEC P4 — best-effort backfill (never blocking), same discipline as the
  // create/parcel branch — only once the write actually landed.
  if (!("error" in result) && promo.oncePerCustomer && request.promoCode) {
    await backfillPromoRedemptionOrderId(request.promoCode, request.mobile, result.order.orderId);
  }
  return result;
}

// The add-round write itself — the CAS attempt, its TAB_CHANGED_ERROR miss
// (now guardedReject'd, FIX1 above), and the step-7 sourceRequestIds
// dup-key repair, unchanged in behavior from the pre-fix version.
export async function applyAddRound(
  openTab: Pick<IOrder, "_id" | "kotRounds" | "voids">,
  update: Record<string, unknown>,
  requestId: string,
  actor: string,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean } | { error: string; status: 409 }> {
  try {
    const updated = await Order.findOneAndUpdate(buildAddRoundFilter(openTab, requestId), update, {
      new: true,
      runValidators: true,
    });
    if (!updated) return guardedReject(requestId, actor, TAB_CHANGED_ERROR);
    return finalizeAccept(updated, requestId, actor, false);
  } catch (e) {
    // A concurrent accept already folded this request into SOME order
    // (sourceRequestIds collision) — hand back what it produced.
    if (isDuplicateKeyError(e) && isSourceRequestIdsDuplicate(e)) {
      const winner = await findByRequestId(requestId);
      if (winner) return finalizeAccept(winner, requestId, actor, true);
    }
    throw e;
  }
}

// FIX7 — a Customer.create race: another accept (or a walk-in checkout) can
// mint the same mobile between the caller's existingCustomer lookup and this
// create. mobile is unique on Customer, so that surfaces as E11000; re-read
// the row that won instead of failing the whole accept over a race that
// already resolved itself. Any other failure rethrows unchanged.
export async function createOrFindCustomer(name: string, mobile: string): Promise<ICustomer> {
  try {
    return await Customer.create({ name, mobile });
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const found = await Customer.findOne({ mobile });
    if (found) return found;
    throw e;
  }
}

// Recovery for the create-path's Order.create call (moved here from -core.ts
// purely for the line budget — the FIRST create attempt itself stays in
// order-request-accept.ts). Two distinct E11000s land here: a sourceRequestIds
// collision means a concurrent accept already won (hand back their order),
// anything else is the ordinary daily-counter race POST /api/orders already
// retries once (bump the counter past today's true last order and retry).
export async function recoverOrderCreate(
  e: unknown,
  doc: Record<string, unknown>,
  requestId: string,
  actor: string,
): Promise<{ order: IOrder } | { order: IOrder; request: IOrderRequest; replayed: true }> {
  if (!isDuplicateKeyError(e)) throw e;
  if (isSourceRequestIdsDuplicate(e)) {
    const winner = await findByRequestId(requestId);
    if (winner) return finalizeAccept(winner, requestId, actor, true);
    throw e;
  }
  const { start, end } = dayRange();
  const last = await Order.findOne({ createdAt: { $gte: start, $lte: end } })
    .sort({ orderId: -1 })
    .select("orderId")
    .lean();
  const lastSeq = last?.orderId ? parseInt(last.orderId.split("-").pop() ?? "", 10) : 0;
  const seq2 = await bumpOrderSequenceTo(Number.isFinite(lastSeq) ? lastSeq : 0);
  const order = await Order.create({ ...doc, orderId: generateOrderId(seq2) });
  return { order };
}

// FIX5 — the diner's quote (buildRequestDoc) was priced against LIVE
// settings at submit time; an add-round bills against the TAB's own frozen
// GST snapshot (gstConfigFromOrder). If the two disagree, the cafe changed
// its GST config after the diner quoted but before staff accepted — the
// consented total is simply wrong, and no per-line price compare can catch
// it (GST is not a line field). Moved here from -core.ts (CR2.2d split)
// purely for the line budget — order-request-accept.ts is its only caller.
export function gstConfigDrifted(tabCfg: GstConfig, liveCfg: GstConfig): boolean {
  return (
    tabCfg.gstEnabled !== liveCfg.gstEnabled ||
    tabCfg.gstRate !== liveCfg.gstRate ||
    tabCfg.gstMode !== liveCfg.gstMode
  );
}

// Distinguishes a sourceRequestIds collision (a concurrent accept already
// folded THIS request into an order) from an orderId collision (the ordinary
// daily-counter race POST /api/orders already retries once) — both surface as
// the same E11000, but only the former calls for the step-7 repair lookup.
// Moved here from -core.ts (CR2.2d split) purely for the line budget — this
// file (applyAddRound/recoverOrderCreate above) is its only caller now.
export function isSourceRequestIdsDuplicate(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const kp = (e as { keyPattern?: unknown }).keyPattern;
  return typeof kp === "object" && kp !== null && "sourceRequestIds" in kp;
}
