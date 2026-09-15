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
} from "@/lib/order-request-accept-write";
import { acceptAddRoundBranch } from "@/lib/order-request-accept-addround";
import {
  resolveAcceptReward,
  claimAcceptReward,
  returnAcceptReward,
  acceptRewardSnapshot,
  REWARD_UNFUNDED_ERROR,
} from "@/lib/order-request-accept-reward";
import { shouldStoreDiscountKind } from "@pos/shared/reward-redemption";
import {
  PROMO_DRIFT_ERROR,
  PROMO_USED_ERROR,
  resolveAcceptPromoFor,
  promoNoteLine,
  claimPromoRedemption,
  backfillPromoRedemptionOrderId,
  promoIsClaimable,
} from "@/lib/order-request-accept-promo";
import { assignedRewardRefusal, markAssignedRewardUsed } from "@/lib/assigned-reward-gate";

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
      productId: String(it.productId),
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
    // The rest (promo, the three-kind discount resolution, KOT ticket, note,
    // the applyAddRound write) is -addround.ts's acceptAddRoundBranch
    // (CB-5B S7 split, ~300-line budget).
    return acceptAddRoundBranch(request, openTab, items, tabGstCfg, printCfg, requestId, ctx);
  }

  // "parcel" or "create" — mint a new Order, mirroring POST /api/orders.
  const tableNo = target === "create" ? request.tableNo : undefined;
  const tableResolved = await resolveTableCharge(tableNo);
  if ("error" in tableResolved)
    return guardedReject(requestId, ctx.actor, TABLE_STATE_CONFLICT_ERROR(tableNo ?? ""));

  // CR2.2c — promo re-resolved from LIVE Settings against the RECOMPUTED
  // subtotal, never trusting quotedDiscount as a money input.
  const subtotalProbe = computeOrderTotals({
    items, discount: 0, discountKind: undefined, charge: tableResolved.charge.amount, cfg: gstCfg,
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
  // CB-5D part 2 DEFECT FIX — the REAL fence: accept is where money actually
  // moves, so an assigned code's expiry must be checked here too, not only at
  // quote time. Same single-homed gate as the create/edit paths
  // (lib/assigned-reward-gate.ts), checked AFTER resolveAcceptPromo succeeds
  // so a drifted/invalid code still reports drift, never "expired".
  if (request.promoCode) {
    const expired = await assignedRewardRefusal(request.promoCode, request.mobile, Date.now());
    if (expired) return guardedReject(requestId, ctx.actor, expired);
  }

  // C4 + CB-5B D4 — WHICH kinds a diner order may originate. Restated because
  // this policy CHANGED: a comment still asserting the old blanket fence would
  // be a trap for the next reader.
  //
  // The "gst" preset stays STAFF-ONLY intent, exactly as before — it is an
  // operator decision about how to present a bill, and nothing a diner submits
  // may pick it.
  //
  // A REWARD claim, by contrast, IS diner-originatable by design (CB-5B, owner
  // decision D4). It is not a diner granting themselves money: they spend
  // their OWN stamp balance, against rungs the OWNER configured in Settings,
  // and every part of it is resolved and fenced server-side — the rung from
  // live Settings, the balance from the diner's own Customer row, the spend by
  // an atomic filtered update. The request carries ONE integer of intent
  // (`requestedRewardAt`, the rung's stamp cost) and never an amount, a kind,
  // or a dish. It also requires a signed-in diner session, checked at submit
  // (lib/order-request-reward.ts) — an anonymous QR order can never claim.
  //
  // The stamps are spent HERE, at accept, never at request-submit: a request
  // is pre-money, and a rejected one must cost no stamps.
  const rewardResolution = await resolveAcceptReward(
    request.requestedRewardAt,
    customerId,
    ctx.settings,
    // Priced WITHOUT the reward — the per-milestone minBill gate is about what
    // the customer is spending, not about what the reward is worth.
    computeOrderTotals({
      items, discount: promo.discount, discountKind: undefined, charge: tableResolved.charge.amount, cfg: gstCfg,
    }).total,
  );
  // A claimed item reward puts its free dish on the bill at its REAL price;
  // the subtotal reducer skips it, so the line is untotalled and untaxed (S12)
  // while the kitchen still sees a normal dish to make.
  const orderItems = rewardResolution?.line
    ? [...items, { ...rewardResolution.line, productId: String(rewardResolution.line.productId) }]
    : items;
  const rewardKind = rewardResolution ? ("reward" as const) : undefined;
  const totals = computeOrderTotals({
    items: orderItems,
    discount: promo.discount,
    discountKind: rewardKind,
    charge: tableResolved.charge.amount,
    cfg: gstCfg,
    ...(rewardResolution ? { reward: rewardResolution.reward } : {}),
  });
  // §1 — exact match, OR the one tolerated delta (createTotalsMatchQuote's
  // own comment, core.ts): a charge-less quote accepted FIRST among
  // same-table siblings legitimately picks up the table's one-time charge.
  //
  // CB-5B S8 — compared against the PRE-REWARD total, never `totals.total`. A
  // reward legitimately LOWERS the bill below what the diner was quoted, and
  // that is the entire point of it; treating that as price drift would reject
  // every rewarded order. The drift fence keeps doing its real job, because
  // the reward's amount is server-derived from a rung the server resolved
  // itself — it is not a number the diner sent.
  const quotedCheckTotals = rewardResolution
    ? computeOrderTotals({
        items: orderItems, discount: promo.discount, discountKind: undefined,
        charge: tableResolved.charge.amount, cfg: gstCfg,
      })
    : totals;
  if (!createTotalsMatchQuote(quotedCheckTotals.total, totals.charge, request.quotedTotal, request.quotedCharge))
    return guardedReject(requestId, ctx.actor, PRICE_DRIFT_ERROR);

  // SPEC P4 — once-per-customer fence, BEFORE the order write. "claimed"/
  // "replay" (this request repairing its own crashed accept) proceed;
  // "reject" means a DIFFERENT request already holds it.
  // CB-5D — `promo.claimed` (presence + a real benefit), NOT `discount > 0`:
  // an "item" promo is worth 0 RUPEES by construction (its benefit is the free
  // LINE), so the old amount-keyed test skipped the fence entirely and a
  // once-per-customer free-item code could be spent again and again.
  if (promo.oncePerCustomer && promoIsClaimable(promo.discount, request.promoCode, promo.kind)) {
    const fenceDecision = await claimPromoRedemption(request.promoCode, request.mobile, { kind: "request", id: requestId });
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
    // orderItems already carries a claimed item reward's free-dish line.
    items: orderItems.map((it) => ({ ...it, kotRound: 1 })),
    kotRounds: 1,
    subtotal: totals.subtotal,
    discount: totals.discount,
    // shouldStoreDiscountKind — the shared amount-gates-kind predicate with
    // its one named exception: a "reward" kind stores even at Rs 0, because an
    // item reward's derived amount is ALWAYS 0. Gating it on the amount would
    // $unset the kind — and with it the provenance of stamps already spent —
    // on exactly the orders that spent them.
    ...(shouldStoreDiscountKind(totals.discount, rewardKind) ? { discountKind: rewardKind } : {}),
    // The reward reprint snapshot, omit-empty (no keys at all when nothing
    // resolved) — the years-later contract: a reward is issued at a cost, and
    // that cost is STORED on the issued row, never re-derived from a ladder
    // the owner may since have retuned.
    ...acceptRewardSnapshot(rewardResolution),
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
  //
  // CLAIM ORDERING (CB-5B S8, mirroring POST /api/orders' own): the stamps are
  // spent BEFORE the create — the claimPromoRedemption shape — so a bill can
  // never be discounted by stamps that were not actually spent.
  //
  // The claim is keyed on the orderId this attempt ACTUALLY uses.
  // recoverOrderCreate RE-NUMBERS the order on a daily-counter collision, and
  // a claim left on the first id would sit where no order carries it: the
  // cancel path (S6) looks the refund up BY orderId and would find nothing,
  // and the `redeemedOrders: {$ne: orderId}` fence would stop recognising the
  // real order, so the same diner could redeem against it twice. So the
  // recovery is handed a re-key callback and moves the claim with the number.
  const seq = await nextOrderSequence();
  const firstOrderId = generateOrderId(seq);
  if (rewardResolution && !(await claimAcceptReward(rewardResolution, firstOrderId))) {
    // The balance moved between the submit-time courtesy check and this atomic
    // spend (another device redeemed the same stamps). A discounted bill whose
    // stamps were never spent must never be written, so this is a rejection
    // the staff member can act on — reject the request and let the diner
    // re-order. Never a silent full-price order: the diner consented to a
    // bill that had the reward on it.
    return guardedReject(requestId, ctx.actor, REWARD_UNFUNDED_ERROR);
  }
  let order: IOrder;
  try {
    order = await Order.create({ ...doc, orderId: firstOrderId });
  } catch (e) {
    let recovered;
    try {
      recovered = await recoverOrderCreate(e, doc, requestId, ctx.actor, {
        // Only a duplicate-key rejection ever reaches this callback
        // (recoverOrderCreate rethrows anything else untouched). That is a
        // SERVER RESPONSE proving nothing was written — the one DEFINITE
        // no-write outcome never-revert-on-write-throw permits a compensating
        // return under.
        onRekey: async (retryOrderId: string): Promise<boolean> => {
          if (!rewardResolution) return true;
          await returnAcceptReward(rewardResolution, firstOrderId);
          return claimAcceptReward(rewardResolution, retryOrderId);
        },
      });
    } catch (fatal) {
      // A throw recoverOrderCreate did not handle — it rethrows anything that
      // is not a duplicate key, so this is the AMBIGUOUS case: the insert may
      // have committed, or it may not.
      //
      // WHY THE CLAIM CANNOT SIMPLY BE LEFT (review of this slice, two HIGH
      // findings sharing one root cause). The claim marker is keyed on the
      // ORDER ID — the right key for the cancel path, which refunds by the
      // landed order's id — but this bridge is deliberately RE-ENTERABLE, and
      // nextOrderSequence burns a FRESH number on every attempt. Stamps left
      // spent against an orderId no order carries are therefore unreachable by
      // every recovery path there is: a resumed accept re-claims under a NEW
      // id (spending twice for one order), and a staff reject of the stranded
      // "accepting" row returns nothing, because reject() knows only the
      // requestId (which is why the promo fence, being requestId-keyed, CAN be
      // released there and this cannot). The diner would lose the stamps with
      // no order and no bill behind them.
      //
      // never-revert-on-write-throw is DIRECTIONAL and permits exactly this:
      // reverse only on a DEFINITE no-write. So the ambiguity is RESOLVED
      // rather than assumed — findByRequestId asks the database whether any
      // order carries this requestId (`sourceRequestIds`, the same
      // multikey-indexed read step 3's repair lookup uses). An order found
      // means the insert COMMITTED and the claim is correct where it is.
      // Nothing found is the definite no-write the rule allows a compensating
      // return under.
      //
      // The resolving read is itself best-effort: if IT throws too (the same
      // outage that failed the insert), the claim STAYS. Leaving stamps spent
      // is the safe side of an unresolvable ambiguity — returning them for an
      // order that did land would be a silent double-spend.
      if (rewardResolution) {
        try {
          const landed = await findByRequestId(requestId);
          if (!landed) await returnAcceptReward(rewardResolution, firstOrderId);
        } catch {
          /* unresolvable — keep the claim rather than risk crediting a landed order */
        }
      }
      throw fatal;
    }
    if ("replayed" in recovered) return recovered;
    if ("rewardUnfunded" in recovered) {
      // The re-claim lost the race against the re-numbered order. Same rule as
      // the first attempt, and the stamps for the first id are already back.
      return guardedReject(requestId, ctx.actor, REWARD_UNFUNDED_ERROR);
    }
    order = recovered.order;
  }

  // SPEC P4 — best-effort backfill of the winning order's id onto the
  // redemption claimed above (never blocking; see backfillPromoRedemptionOrderId).
  // CB-5D — `promo.claimed` (presence + a real benefit), NOT `discount > 0`:
  // an "item" promo is worth 0 RUPEES by construction (its benefit is the free
  // LINE), so the old amount-keyed test skipped the fence entirely and a
  // once-per-customer free-item code could be spent again and again.
  if (promo.oncePerCustomer && promoIsClaimable(promo.discount, request.promoCode, promo.kind)) {
    await backfillPromoRedemptionOrderId(request.promoCode, request.mobile, order.orderId);
  }
  // CB-5D part 2 (owner decision) — the ASSIGNED code is now SPENT, so it
  // leaves the diner's "my rewards" list. Best-effort, beside the backfill
  // and under the same rule: the fence claimed BEFORE the write is what
  // stops a second spend, so a failure here costs only a stale list row.
  if (request.promoCode) {
    await markAssignedRewardUsed(request.promoCode, request.mobile, order.orderId, new Date());
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
