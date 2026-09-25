import mongoose, { type FilterQuery } from "mongoose";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { connectDB } from "@/lib/db";
import { Order, type IOrder } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { resolveSettleMoney, reconcileLedger, validCustomer } from "@/lib/order";
import { computeOrderTotals, gstConfigFromOrder, resolveDiscountKind } from "@/lib/receipt";
import { readSettings } from "@/lib/settings";
import { grantStampForSettledOrder } from "@/lib/diner-loyalty-earn";
import { voidGuardFilter } from "@/lib/order-void";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
import { nextSlipSequence } from "@/models/Counter";
import { settleOrderSchema } from "@/schemas";
import {
  resolveRewardClaim,
  rewardClaimMessage,
  rewardSnapshotFields,
  claimRewardStamps,
  returnRewardStamps,
} from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { shouldStoreDiscountKind, rewardFromOrderSnapshot } from "@pos/shared/reward-redemption";
import { chargeWriteFields } from "@/lib/order-charges-write";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/settle — take payment on an open tab and close it.
// Server-authoritative: paidAmount is derived from the order's stored total (or
// a settle-time discount recomputed against it) and the mode/collected-amount —
// see resolveSettleMoney. The customer ledger gets the order's full contribution
// applied now (a held tab contributed nothing at open), and the table is freed.
// Idempotent-safe: the update is conditional on the order still being Pending,
// so a double-fired settle applies the ledger delta exactly once.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, settleOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    // The Pending CAS below would 409 anyway, but with a message that sends the
    // operator looking for a phantom concurrent edit.
    if (old.status === "Cancelled") return failure("Order was cancelled", 409);
    if (old.status === "Completed") return failure("Order already settled", 409);

    // CB-5B S5 — a reward claimed AT SETTLE TIME. refuseItemKind: TRUE (D9,
    // owner decision): a free DISH has to reach the kitchen while the order
    // is being taken, never after payment — this path may only grant a
    // flat/percent money-off. An order that already carries a reward refuses
    // a second one outright, same one-scalar-one-kind reasoning as add-round.
    const settings = await getSettings();
    let claim: Extract<Awaited<ReturnType<typeof resolveRewardClaim>>, { ok: true }> | undefined;
    if (data.rewardAt !== undefined) {
      if (old.rewardAt !== undefined) {
        return failure("This tab already has a reward applied", 409);
      }
      // billTotal for the minBill gate: the bill WITHOUT the reward — any
      // settle-time discount/charge change rides along, mirroring what
      // resolveSettleMoney would price without a reward.
      const plainKind = resolveDiscountKind(data.discountKind, old.discountKind);
      const billTotal = computeOrderTotals({
        items: old.items,
        discount: data.discount ?? old.discount,
        discountKind: plainKind,
        charge: data.chargeAmount ?? old.chargeAmount ?? 0,
        cfg: gstConfigFromOrder(old, gstConfigOf(settings)),
      }).total;
      const resolved = await resolveRewardClaim({
        settings,
        customerId: old.customerId ? String(old.customerId) : undefined,
        rewardAt: data.rewardAt,
        billTotal,
        refuseItemKind: true,
      });
      if (!resolved.ok) return failure(rewardClaimMessage(resolved.reason), 400);
      claim = resolved;
    }
    // CB-5D part 2 — captured ONCE, alongside `claim`, and reused by the single
    // claimRewardStamps call below. Settle claims for an already-fixed
    // orderId (no renumber-retry), but the assignment is still built here
    // rather than inline in the call so `assignedAt` is pinned to one Date
    // even if a future change adds a retry path — claimRewardStamps's
    // $addToSet treats the assignment as one whole element, and a
    // reconstructed Date at a second call site would duplicate the reward.
    // Same settings?.promoCodes source every other reward-minting writer uses.
    const rewardAssignment = claim
      ? buildRewardAssignment(claim.milestone, settings?.promoCodes, new Date())
      : undefined;

    // No settle-time discount → price against the STORED total, exactly as
    // before. A supplied one recomputes from the tab's own items using the tab's
    // GST SNAPSHOT (same discipline as the items route), so a mid-tab GST change
    // can never retroactively alter an open tab's bill.
    const money = resolveSettleMoney({
      order: old,
      payment: data.payment,
      discount: data.discount,
      // Only the POS settle path sends this; omitted = leave the tab's stored
      // kind untouched. A resolved reward below OVERRIDES this — a reward and
      // a gst preset can never both be the stored kind (one scalar, one kind).
      discountKind: claim ? "reward" : data.discountKind,
      // Omitted = leave the tab's snapshotted table charge alone. Only the POS
      // settle path, where the operator can actually see and waive the charge,
      // ever sends this; the Orders-page settle never does, so it can never
      // silently drop a charge off a bill it was not showing.
      chargeAmount: data.chargeAmount,
      // CB-CHG (decision 6) — extras save on Send/Settle, like today's charge
      // waiver. Present = replace the whole extra set; absent = unchanged.
      extraCharges: data.extraCharges,
      paidAmount: data.paidAmount,
      splitCash: data.splitCash,
      splitOnline: data.splitOnline,
      liveGst: gstConfigOf(settings),
      // A settle-time claim, or the reward the tab has ALREADY been carrying
      // since it was created. The fallback is load-bearing: whenever this
      // settle re-prices at all (a settle-time discount, a charge waiver), a
      // tab whose stored kind is "reward" would otherwise recompute with NO
      // reward — and rewardDiscountAmount fails closed at 0, so the diner's
      // already-spent stamps would quietly stop discounting the bill they paid
      // for. Rebuilt from the order's OWN snapshot, never the live ladder.
      reward: claim?.reward ?? rewardFromOrderSnapshot(old),
    });
    if ("error" in money) return failure(money.error, 400);

    // A deliberate partial (paidAmount defined) was priced by the OPERATOR
    // against whatever total THEY saw client-side. If the server's freshly
    // recomputed total disagrees, that number means something different than
    // what they intended — reject rather than silently booking the wrong due.
    // The Pending+total CAS below can't catch this: it compares the server's
    // OWN fresh read (old.total) against the DB, not against what the
    // operator was looking at (CR1.2 regression: a stale snapshot on another
    // device let a short paidAmount get priced against a bill that had moved).
    if (
      data.paidAmount !== undefined &&
      data.total !== undefined &&
      data.total !== money.total
    ) {
      return failure("Tab changed — reopen it and try again", 409);
    }

    // The order's own customer is authoritative; the body may only ATTACH a
    // customer to a tab opened without one (never reassign an existing one).
    const attachId = !old.customerId ? validCustomer(data.customerId) : null;
    const isDeferred = data.payment === "Due" || data.payment === "Credit";

    // Resolve the attaching customer's name up front (snapshot server-side, never
    // trust a client-supplied name). attachName stays undefined if it was deleted.
    let attachName: string | undefined;
    if (attachId) {
      const cust = await Customer.findById(attachId).select("name").lean();
      attachName = cust?.name;
    }

    // Any settle that leaves a balance on the books — Due/Credit in full, or a
    // partial Cash/Online payment — parks that balance on a customer, so that
    // customer must EXIST — an ObjectId that's well-formed but deleted would
    // otherwise complete the order with the balance recorded against nobody
    // (money lost). A fully-discounted Rs 0 bill leaves no due at all and must
    // never demand one.
    if (money.leavesDue) {
      const carrierExists = old.customerId
        ? (await Customer.exists({ _id: old.customerId })) != null
        : !!attachName;
      if (!carrierExists) {
        return failure(
          isDeferred
            ? "Select an existing customer for Due or Credit orders"
            : "Select a customer — the unpaid remainder becomes their due",
          400,
        );
      }
    }

    // Built as an explicit $set (rather than bare paths Mongoose would wrap for
    // us) because a waived charge also needs a $unset alongside it, and mixing
    // bare paths with an operator in one update document is exactly the kind of
    // driver-semantics coin-flip this codebase does not gamble on.
    // The bill is being ISSUED right now, so this is where its number comes
    // from. Only if the tab has none yet — a re-settle attempt must never
    // renumber a bill the customer is already holding. An open tab that ran all
    // evening therefore takes the number of the moment it was paid, not the
    // moment it was opened, and a tab that gets cancelled instead never
    // consumes one, so the day's bill series has no gaps.
    const printCfg = printConfigOf(await getSettings());
    const billNumber =
      printCfg.bill.showNumber && old.billNumber === undefined
        ? printedSlipNumber(await nextSlipSequence("bill"), printCfg.bill.numberStart)
        : undefined;

    const set: Record<string, unknown> = {
      payment: data.payment,
      paidAmount: money.paidAmount,
      status: "Completed",
      ...(billNumber !== undefined ? { billNumber } : {}),
    };
    const unset: Record<string, ""> = {};
    if (money.totals) {
      set.subtotal = money.totals.subtotal;
      set.discount = money.totals.discount;
      set.gstAmount = money.totals.gstAmount;
      set.total = money.totals.total;
      // CB-CHG — the ONE helper every charge writer uses (plan §4): charges[]
      // is the source of truth, chargeAmount/chargeLabel its derived mirror.
      // $unset (never a stored 0) when nothing is left to charge — the
      // receipt keys its charge line off the amount being PRESENT, so a
      // stored 0 with the label still beside it would print a named ₹0 line
      // on the customer's slip.
      const chargeFields = chargeWriteFields(money.charges);
      Object.assign(set, chargeFields.set ?? {});
      Object.assign(unset, chargeFields.unset ?? {});
      // shouldStoreDiscountKind (the shared amount-gates-kind predicate, three-
      // way now: gst/reward/neither) — the RESOLVED kind is stored, never the
      // "gst" literal, so a reward claimed at settle writes discountKind:"reward".
      // Exclusive with the $set above (Mongo rejects a path in both operators).
      if (shouldStoreDiscountKind(money.totals.discount, money.discountKind)) {
        set.discountKind = money.discountKind;
      } else {
        unset.discountKind = "";
      }
    }
    if (data.payment === "Split") {
      set.splitCash = money.splitCash;
      set.splitOnline = money.splitOnline;
    }
    if (attachId && attachName) {
      set.customerId = attachId;
      set.customerName = attachName;
    }
    // CB-5B — the reward reprint snapshot, omit-empty (no keys when no claim).
    if (claim) Object.assign(set, rewardSnapshotFields(claim.reward, claim.cost));
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    // Conditional on still-Pending AND the total we priced against being
    // unchanged — that's the total we READ (old.total), not the total we WRITE
    // (which may be lower, since a settle-time discount can reduce it). This
    // makes a double-settle apply the ledger delta exactly once, AND prevents a
    // stale underpayment if a new KOT round raced in between the read and the
    // write (changed total → match fails → the staff reopens the now-larger
    // bill). The loser matches nothing and 409s.
    // The void-trail term covers the case the total term cannot see: on a fully
    // comped tab the total is already 0 and a void leaves it 0, so a void racing
    // this settle would pass the total check while `money` was priced from our
    // stale items — settling a bill that still charges the voided dish (arbiter
    // live-probe, CR1.3 review).
    const filter: FilterQuery<IOrder> = {
      _id: id,
      status: "Pending",
      total: old.total,
      ...voidGuardFilter(old.voids?.length ?? 0),
    };

    // CB-5B — claim the stamps BEFORE this CAS write, never after: a redeemed
    // bill must never be marked Completed before its stamps are spent (a
    // customer paying a discounted bill whose stamps were never debited is
    // money lost the next time that rung is priced). Unlike the earn-side
    // stamp grant below (fire-and-forget, swallowed), this is NOT best-effort
    // — earn never changes the bill being settled, so a missed grant costs a
    // counter conversation; a redemption changes the bill BEFORE money is
    // taken, so a failed claim must fail the settle closed.
    if (claim) {
      const claimed = await claimRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);
      if (!claimed) return failure("Not enough stamps for that reward", 409);
    }
    const updated = await Order.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) {
      // A CAS MISS is the one DEFINITE no-write outcome here (never-revert-
      // on-write-throw: only a confirmed non-write may reverse a claim) — the
      // settle never landed, so the stamps it would have spent must go back
      // before reporting the same 409 this route already returns.
      if (claim) await returnRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // Apply the full ledger effect now (the open tab contributed nothing at open).
    const touched = await reconcileLedger(old, updated);
    if (touched.size) cache.del("customers");

    // CB-4 — one loyalty stamp for this settled bill, at most once per order.
    // BEST-EFFORT and deliberately swallowed: the bill is already settled and
    // committed above, so a stamp that fails to land must never turn money
    // that was taken into a 409/500 for the operator. A missed stamp is a
    // counter conversation; a failed settle is a broken till. The write itself
    // is idempotent (a filter-predicate guard on stampOrders), so a retry of
    // this request cannot double-stamp either.
    try {
      const granted = await grantStampForSettledOrder(
        await readSettings(),
        updated.customerId ? String(updated.customerId) : null,
        updated.orderId,
        // RUPEES — models/Order.ts's total is a plain Number. Do NOT convert:
        // the Int32 paise shape is models/order.ledger.ts, which this route
        // never reads (see lib/diner-loyalty.ts's unit note).
        updated.total,
      );
      if (granted.granted) cache.del("customers");
    } catch {
      // Swallowed on purpose — see above. No console.* in app/lib code.
    }

    // Free the table only if it still points to this order.
    if (updated.tableNo) {
      await Table.findOneAndUpdate(
        { tableNo: updated.tableNo, currentOrderId: updated.orderId },
        { status: "Available", currentOrderId: "" },
      );
      cache.del("tables");
    }

    // Today's KPIs change (tab leaves In-progress; collected/sales/dues move).
    cache.del(orderSummaryCacheKey());
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    // The tab changed — nudge the POS pulse and the Kitchen board ahead of
    // their polls. publishCafeEvent defers it past the response and swallows
    // every failure, so it can never delay or fail this write; the polls stay
    // the fallback and the source of truth.
    publishCafeEvent("order-changed");
    return success(updated);
  } catch (error) {
    return serverError("Failed to settle order", error);
  }
}
