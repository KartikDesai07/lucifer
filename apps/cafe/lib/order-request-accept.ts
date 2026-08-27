import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, type IOrder } from "@/models/Order";
import { OrderRequest, type IOrderRequest } from "@/models/OrderRequest";
import { Product } from "@/models/Product";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import type { ISettings } from "@/models/Settings";
import { nextOrderSequence, nextSlipSequence } from "@/models/Counter";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
import cache from "@/lib/cache";
import { generateOrderId } from "@/lib/utils";
import { computeOrderTotals, gstConfigFromOrder, gstConfigOfSettings } from "@/lib/receipt";
import { derivePayment, ledgerContribution } from "@/lib/order";
import { resolveTableCharge } from "@/lib/table-admin";
import { priceRequestItems, PRICE_DRIFT_ERROR, type PricedProductSource } from "@/lib/public-pricing";
import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import {
  REQUEST_REJECTED_ERROR,
  REQUEST_GONE_ERROR,
  TABLE_STATE_CONFLICT_ERROR,
  TAB_CHANGED_ERROR,
  REQUEST_TOO_OLD_ERROR,
  acceptGuardFilter,
  classifyTarget,
  buildAddRoundFilter,
  buildKotNumbers,
  isRequestTooOld,
  mergedNote,
  findByRequestId,
  finalizeAccept,
  replayAccepted,
  resolveOpenTabState,
  createTotalsMatchQuote,
} from "@/lib/order-request-accept-core";
import {
  guardedReject,
  createOrFindCustomer,
  recoverOrderCreate,
  gstConfigDrifted,
  acceptAddRoundBranch,
} from "@/lib/order-request-accept-write";
import {
  PROMO_DRIFT_ERROR,
  PROMO_USED_ERROR,
  resolveAcceptPromo,
  promoNoteLine,
  claimPromoRedemption,
  backfillPromoRedemptionOrderId,
} from "@/lib/order-request-accept-promo";

// CR2.2 SLICE 4 — the accept bridge (phase-CR2-public-ordering.md §0/§4): the
// ONE place a diner's OrderRequest becomes a real Order, mirroring (not
// importing) the SAME create/add-round money+numbering semantics as POST
// /api/orders and POST /api/orders/[id]/items. Pure/CAS helpers live in the
// sibling core.ts/-write.ts/-promo.ts (this file alone doesn't fit ~300
// lines) and are re-exported so every caller imports from ONE module. Every
// OrderRequest write is CAS-guarded on the expected status — never a blind $set.
export {
  REQUEST_REJECTED_ERROR,
  REQUEST_GONE_ERROR,
  TABLE_STATE_CONFLICT_ERROR,
  TAB_CHANGED_ERROR,
  REQUEST_TOO_OLD_ERROR,
  PROMO_DRIFT_ERROR,
  PROMO_USED_ERROR,
  acceptGuardFilter,
  classifyTarget,
  buildAddRoundFilter,
  buildKotNumbers,
  findByRequestId,
};
export type { AcceptTarget, ReplayDecision } from "@/lib/order-request-accept-core";
export { decideOnStatus } from "@/lib/order-request-accept-core";

export interface AcceptContext {
  actor: string;
  settings: ISettings | null; // nullable like readSettings() — degrades to defaults
  createCustomer: boolean;
}

// The bridge itself: resulting Order + resolved OrderRequest, or a rejection.
export async function acceptOrderRequest(
  requestId: string,
  ctx: AcceptContext,
): Promise<
  | { order: IOrder; request: IOrderRequest; replayed: boolean }
  | { error: string; status: 404 | 409 }
> {
  await connectDB();

  // 1. Load the request and short-circuit on a terminal status.
  if (!mongoose.isValidObjectId(requestId)) return { error: REQUEST_GONE_ERROR, status: 404 };
  let request = await OrderRequest.findById(requestId);
  if (!request) return { error: REQUEST_GONE_ERROR, status: 404 };
  if (request.status === "accepted") return replayAccepted(requestId, request);
  if (request.status === "rejected") return { error: REQUEST_REJECTED_ERROR, status: 409 };

  // 1b. FIX4 — age gate BEFORE the claim CAS, scoped to "pending" ONLY: an
  // "accepting" row skips to step 2/3, where repair gets first say.
  if (request.status === "pending" && isRequestTooOld(request.createdAt, Date.now())) {
    return { error: REQUEST_TOO_OLD_ERROR, status: 409 };
  }

  // 2. CAS entry into "accepting". Re-enterable ON PURPOSE — a retried accept
  // must RESUME a crashed one, never be locked out by it.
  const claimed = await OrderRequest.findOneAndUpdate(
    { _id: requestId, status: { $in: ["pending", "accepting"] } },
    { $set: { status: "accepting" } },
    { new: true },
  );
  if (!claimed) {
    const reread = await OrderRequest.findById(requestId);
    if (!reread) return { error: REQUEST_GONE_ERROR, status: 404 };
    return reread.status === "accepted" ? replayAccepted(requestId, reread) : { error: REQUEST_REJECTED_ERROR, status: 409 };
  }
  request = claimed;

  // 3. Repair lookup FIRST (ordering pinned) — a crash between the order
  // write and the request mark must be repaired, never double-billed.
  const repaired = await findByRequestId(requestId);
  if (repaired) return finalizeAccept(repaired, requestId, ctx.actor, true);

  // The age gate for an "accepting" row applies ONLY here, after repair found
  // nothing to resume — a row abandoned past 12h still 409s (never reverted).
  if (isRequestTooOld(request.createdAt, Date.now())) {
    return { error: REQUEST_TOO_OLD_ERROR, status: 409 };
  }

  // 4. Re-validate against LIVE products — isActive only (hidden-from-menu stays POS-orderable).
  const productIds = request.items.map((it) => it.productId).filter(mongoose.isValidObjectId);
  const products = (await Product.find({ _id: { $in: productIds }, isActive: true })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const priced = priceRequestItems(
    products,
    request.items.map((it) => ({
      productId: it.productId,
      variation: it.variation,
      modifiers: it.modifiers,
      instructions: it.instructions,
      qty: it.qty,
    })),
  );
  if ("error" in priced) return guardedReject(requestId, ctx.actor, priced.error);
  const drifted = priced.lines.some((line, i) => line.price !== request!.items[i]?.price);
  if (drifted) return guardedReject(requestId, ctx.actor, PRICE_DRIFT_ERROR);

  // The ORDER's items are the STORED request lines, never `priced.lines`
  // (which exist only to CHECK for drift above).
  const items = request.items.map((it) => ({
    productId: it.productId,
    name: it.name,
    price: it.price,
    qty: it.qty,
    ...(it.variation ? { variation: it.variation } : {}),
    modifiers: it.modifiers,
    instructions: it.instructions,
  }));

  // 5. Customer attach (§10.2) — existing Customer used AS-IS (its name wins);
  // absent+ctx.createCustomer mints one; absent+auto mints nothing.
  const existingCustomer = await Customer.findOne({ mobile: request.mobile });
  const customer =
    existingCustomer ??
    (ctx.createCustomer ? await createOrFindCustomer(request.name, request.mobile) : null);
  const customerName = customer?.name ?? request.name;
  const customerId = customer ? String(customer._id) : undefined;

  const gstCfg = gstConfigOfSettings(ctx.settings ?? undefined);
  const printCfg = printConfigOf(ctx.settings);

  // 6. Branch on target + live open-tab/table-free state.
  const { openTab, tableFree } = await resolveOpenTabState(request);
  const target = classifyTarget(request.targetKind, openTab != null, tableFree);

  // Mirroring the POS's silent claim here would open a SECOND bill on an
  // occupied table — the one thing an accept must never do.
  if (target === "table-conflict")
    return guardedReject(requestId, ctx.actor, TABLE_STATE_CONFLICT_ERROR(request.tableNo ?? ""));

  if (target === "add-round" && openTab) {
    // Recomputed from the TAB's own GST snapshot, never live settings.
    const tabGstCfg = gstConfigFromOrder(openTab, gstCfg);
    // FIX5 — this round bills the tab's own frozen GST snapshot.
    if (gstConfigDrifted(tabGstCfg, gstCfg)) return guardedReject(requestId, ctx.actor, PRICE_DRIFT_ERROR);
    // The rest (promo, KOT ticket, note, the applyAddRound write) is
    // -write.ts's acceptAddRoundBranch (CR2.2d split, ~300-line budget).
    return acceptAddRoundBranch(request, openTab, items, tabGstCfg, printCfg, requestId, ctx);
  }

  // "parcel" or "create" — mint a new Order, mirroring POST /api/orders.
  const tableNo = target === "create" ? request.tableNo : undefined;
  const tableResolved = await resolveTableCharge(tableNo);
  if ("error" in tableResolved)
    return guardedReject(requestId, ctx.actor, TABLE_STATE_CONFLICT_ERROR(tableNo ?? ""));

  // CR2.2c — promo re-resolved from LIVE Settings against the RECOMPUTED
  // subtotal, never trusting quotedDiscount as a money input.
  const subtotalProbe = computeOrderTotals({ items, discount: 0, charge: tableResolved.charge.amount, cfg: gstCfg });
  const promo = resolveAcceptPromo(request.promoCode, request.quotedDiscount, ctx.settings?.promoCodes, subtotalProbe.subtotal);
  if ("error" in promo) return guardedReject(requestId, ctx.actor, promo.error);

  const totals = computeOrderTotals({ items, discount: promo.discount, charge: tableResolved.charge.amount, cfg: gstCfg });
  // §1 — exact match, OR the one tolerated delta (createTotalsMatchQuote's
  // own comment, core.ts): a charge-less quote accepted FIRST among
  // same-table siblings legitimately picks up the table's one-time charge.
  if (!createTotalsMatchQuote(totals.total, totals.charge, request.quotedTotal, request.quotedCharge))
    return guardedReject(requestId, ctx.actor, PRICE_DRIFT_ERROR);

  // SPEC P4 — once-per-customer fence, BEFORE the order write. "claimed"/
  // "replay" (this request repairing its own crashed accept) proceed;
  // "reject" means a DIFFERENT request already holds it.
  if (promo.oncePerCustomer && promo.discount > 0 && request.promoCode) {
    const fenceDecision = await claimPromoRedemption(request.promoCode, request.mobile, requestId);
    if (fenceDecision === "reject") return guardedReject(requestId, ctx.actor, PROMO_USED_ERROR);
  }

  const pay = derivePayment("Unpaid", totals.total);
  const paidAmount = "error" in pay ? 0 : pay.paidAmount; // Unpaid never errors

  const kotNumber = printCfg.kot.showNumber
    ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
    : 0;
  // FIX6 — the diner's note plus a staff-actionable promo line (CR2.2c),
  // through the EXISTING mergedNote helper so it composes, never replaces.
  const promoLine = promoNoteLine(request.promoCode, promo.discount);
  const doc = {
    customerName,
    customerId,
    items: items.map((it) => ({ ...it, kotRound: 1 })),
    kotRounds: 1,
    subtotal: totals.subtotal,
    discount: totals.discount,
    gstAmount: totals.gstAmount,
    gstRate: gstCfg.gstEnabled ? gstCfg.gstRate : 0,
    gstMode: gstCfg.gstMode,
    chargeAmount: totals.charge > 0 ? totals.charge : undefined,
    chargeLabel: totals.charge > 0 ? tableResolved.charge.label : undefined,
    total: totals.total,
    kotNumbers: printCfg.kot.showNumber ? [kotNumber] : undefined,
    notes: mergedNote(mergedNote(undefined, request.note), promoLine),
    paidAmount,
    payment: "Unpaid" as const,
    status: "Pending" as const,
    receiver: ctx.actor,
    tableNo,
    source: SELF_ORDER_SOURCE,
    sourceRequestIds: [requestId],
  };

  // Same atomic per-day counter as POST /api/orders; the day-rollover retry
  // + dup-key repair live in recoverOrderCreate (-write.ts).
  const seq = await nextOrderSequence();
  let order: IOrder;
  try {
    order = await Order.create({ ...doc, orderId: generateOrderId(seq) });
  } catch (e) {
    const recovered = await recoverOrderCreate(e, doc, requestId, ctx.actor);
    if ("replayed" in recovered) return recovered;
    order = recovered.order;
  }

  // SPEC P4 — best-effort backfill of the winning order's id onto the
  // redemption claimed above (never blocking; see backfillPromoRedemptionOrderId).
  if (promo.oncePerCustomer && promo.discount > 0 && request.promoCode) {
    await backfillPromoRedemptionOrderId(request.promoCode, request.mobile, order.orderId);
  }

  // Ledger contribution — best-effort, mirrors POST /api/orders exactly.
  if (customerId) {
    const c = ledgerContribution({ payment: "Unpaid", total: totals.total, paidAmount, status: "Pending" });
    if (c.visits || c.spend || c.due) {
      try {
        await Customer.findByIdAndUpdate(customerId, {
          $inc: { visits: c.visits, totalSpend: c.spend, totalDue: c.due },
        });
        cache.del("customers");
      } catch {
        /* best-effort — recoverable via reconcile */
      }
    }
  }

  // Claim the table only if still free (same guard as POST /api/orders) — a parcel claims nothing.
  if (target === "create" && tableNo) {
    try {
      await Table.findOneAndUpdate(
        { tableNo, status: "Available" },
        { status: "Occupied", currentOrderId: order.orderId },
      );
      cache.del("tables");
    } catch {
      /* best-effort */
    }
  }

  return finalizeAccept(order, requestId, ctx.actor, false);
}
