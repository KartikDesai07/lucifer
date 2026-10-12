import mongoose, { type FilterQuery } from "mongoose";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { connectDB } from "@/lib/db";
import { Order, type IOrder } from "@/models/Order";
import { Customer } from "@/models/Customer";
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
import { resolveSettleMoney, validCustomer } from "@/lib/order";
import {
  rewardBlocksDiscountKind,
  REWARD_BLOCKS_GST_DISCOUNT_MESSAGE,
  promoBlocksDiscountKind,
  PROMO_BLOCKS_GST_DISCOUNT_MESSAGE,
} from "@/lib/receipt";
import { voidGuardFilter } from "@/lib/order-void";
import { settleRefusal } from "@/lib/settle-guard";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { printConfigOf } from "@/lib/print";
import { issueBillNumbers, BILL_NUMBER_UNCONFIRMED } from "@/lib/slip-numbers";
import { billNumberingPlan, planHasWork } from "@/lib/gst-invoice";
import { runSettleFollowUps } from "@/lib/settle-followups";
import { billFirstPrintFresh, stampFirstBillPrint, withFirstBillPrint } from "@/lib/bill-first-print";
import { settledValue } from "@/lib/settled";
import { settleOrderSchema } from "@/schemas";
import {
  rewardSnapshotFields,
  claimRewardStamps,
  returnRewardStamps,
} from "@/lib/reward-claim";
import { resolveSettleReward } from "@/lib/settle-reward";
import { cardSnapshotFields, claimRewardCard, releaseRewardCard } from "@/lib/reward-card-claim";
import { rewardClaimOrderFence } from "@/lib/order-reward-fence";
import { CARD_NOT_USABLE } from "@pos/shared/reward-card-use";
import { shouldStoreDiscountKind, rewardFromOrderSnapshot } from "@pos/shared/reward-redemption";
import { chargeWriteFields } from "@/lib/order-charges-write";
import { createOrderPrintJobs, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/settle — take payment on an open tab and close it.
// Server-authoritative: paidAmount is derived from the order's stored total (or
// a settle-time discount recomputed against it) and the mode/collected-amount —
// see resolveSettleMoney. Idempotent-safe: the update is conditional on the
// order still being Pending, so a double-fired settle lands exactly once.
// Only the settle whose CAS LANDED takes the bill number (lib/slip-numbers.ts),
// so a refused, stale or losing settle never leaves a gap in the bill series,
// and the response carries the numbered doc the bill prints from. The ledger
// (the open tab contributed nothing at open), the loyalty stamp and the table
// free follow best-effort (lib/settle-followups.ts): a settle that landed
// answers 200 whatever they do; only an unconfirmed bill number answers 500.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, settleOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;
  // Printing Phase 1 (lib/print-order-jobs.ts): the bill prints from here only when this call site
  // says so (the POS settle does; the Orders-sheet settle never printed).
  const intent = printIntentOf(req);

  try {
    await connectDB();
    // Both reads start together; they are still CHECKED in the old order (a
    // missing or refused tab answers before a settings failure).
    const [oldR, settingsR] = await Promise.allSettled([Order.findById(id).lean(), getSettings()]);
    const old = settledValue(oldR);
    if (!old) return notFound("Order not found");
    // Cancelled, already settled, or not the tab the operator's bill was priced
    // from (the expectedTotal/expectedVoids echo) — lib/settle-guard.ts, shared
    // with the live-leg verifier so both refuse on the same rules.
    const refusal = settleRefusal(old, data);
    if (refusal) return failure(refusal, 409);
    // P4 (s87) — same refusal as add-round, before any claim or write.
    if (rewardBlocksDiscountKind(data.discountKind, old.discountKind)) {
      return failure(REWARD_BLOCKS_GST_DISCOUNT_MESSAGE, 409);
    }
    // O2 (s91) — and for a promo bill: its discount is the bill's money, a GST preset would replace it.
    if (promoBlocksDiscountKind(data.discountKind, old.promoCode, old.discountKind)) {
      return failure(PROMO_BLOCKS_GST_DISCOUNT_MESSAGE, 409);
    }
    const settings = settledValue(settingsR);

    // CB-5B S5 — a reward claimed at settle time (and the code it mints):
    // lib/settle-reward.ts (S5a split).
    const settleReward = await resolveSettleReward({
      old,
      settings,
      rewardAt: data.rewardAt,
      rewardCardId: data.rewardCardId,
      chargeAmount: data.chargeAmount,
      extraCharges: data.extraCharges,
    });
    if (!settleReward.ok) return failure(settleReward.message, settleReward.status);
    const { claim, card, rewardAssignment } = settleReward;

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
      discountKind: claim || card ? "reward" : data.discountKind,
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
      // A settle-time claim (stamp or card), or the reward the tab has ALREADY been carrying. The fallback is
      // load-bearing: a re-pricing settle (discount, charge waiver) of a "reward" tab would otherwise recompute
      // with NO reward, and rewardDiscountAmount fails closed at 0 — the spent reward would stop discounting.
      // Rebuilt from the order's OWN snapshot, never the live ladder.
      reward: claim?.reward ?? card?.reward ?? rewardFromOrderSnapshot(old),
    });
    if ("error" in money) return failure(money.error, 400);

    // A deliberate partial (paidAmount defined) was priced by the OPERATOR against the total THEY saw. If the
    // server's recomputed total disagrees, reject rather than silently book the wrong due. The Pending+total
    // CAS below can't catch this: it compares the server's OWN fresh read against the DB (CR1.2 regression:
    // a stale snapshot on another device priced a short paidAmount against a bill that had moved).
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

    // Any settle that leaves a balance on the books (Due/Credit, or a partial payment) parks it on a customer,
    // who must EXIST — a deleted-but-well-formed ObjectId would record the balance against nobody (money
    // lost). A fully-discounted Rs 0 bill leaves no due and must never demand one.
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

    // An explicit $set (not bare paths Mongoose would wrap): a waived charge also needs a $unset alongside
    // it, and mixing bare paths with an operator in one update document is a driver-semantics coin-flip.
    const set: Record<string, unknown> = {
      payment: data.payment,
      paidAmount: money.paidAmount,
      status: "Completed",
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
    // A card order stores the card snapshot and NEVER rewardAt / rewardStamps.
    if (card) Object.assign(set, cardSnapshotFields(card.reward));
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    // Conditional on still-Pending AND the total we priced against being unchanged — the total we READ
    // (old.total), not the one we WRITE (a settle-time discount can lower it). A double-settle applies the
    // ledger delta once, and a new KOT round racing in (changed total) misses instead of underpaying.
    // The void-trail term covers what the total term cannot see: on a fully comped tab a void leaves the
    // total at 0, so a racing void would pass while `money` was priced from our stale items (arbiter
    // live-probe, CR1.3 review).
    const filter: FilterQuery<IOrder> = {
      _id: id,
      status: "Pending",
      total: old.total,
      // P1 (s87) — the round we read, the SAME term the items and void routes
      // fence on: an add-round that leaves the total unchanged (a ₹100 dish
      // under a ₹100 reward) passes the total term, and this settle — priced
      // from our stale items — would complete the bill with that round unbilled.
      kotRounds: old.kotRounds ?? 0,
      ...voidGuardFilter(old.voids?.length ?? 0),
      // P2 — a claiming settle also fences the bill's reward/promo state and customer (see order-reward-fence).
      ...(claim || card ? rewardClaimOrderFence(old) : {}),
    };

    // CB-5B — claim the stamps BEFORE this CAS write, never after: a redeemed bill must never be marked
    // Completed before its stamps are spent. Unlike the earn-side grant (lib/settle-followups.ts, swallowed),
    // this is NOT best-effort: a redemption changes the bill BEFORE money is taken, so a failed claim fails
    // the settle closed.
    if (claim) {
      const claimed = await claimRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);
      if (!claimed) return failure("Not enough stamps for that reward", 409);
    }
    // The card: same discipline, claimed before the CAS and released only on its definite miss below.
    if (card && !(await claimRewardCard(String(old.customerId), card.id, old.orderId, card.now))) {
      return failure(CARD_NOT_USABLE, 409);
    }
    const updated = await Order.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) {
      // A CAS MISS is the one DEFINITE no-write outcome here (never-revert-on-write-throw: only a confirmed
      // non-write may reverse a claim): the settle never landed, so the stamps / card go back before the 409.
      if (claim) await returnRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);
      if (card) await releaseRewardCard(String(old.customerId), card.id, old.orderId);
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // The settle LANDED. Only now is the bill ISSUED, so only now does it take
    // its numbers (the daily bill number; a GST bill's invoice serial, S10) — and
    // only those it has none of (a re-settle never renumbers a bill the customer
    // holds). A cancelled tab never takes one. The follow-ups run alongside;
    // allSettled, so neither can turn this landed settle into a throw.
    const numbering = billNumberingPlan(updated, printConfigOf(settings).bill);
    // The bill's first print is this settle when the call prints it and the stored
    // stamp is not for this bill's total (never printed, or the total changed since):
    // stamp the moment the pay QR's "Valid till" counts from. A SEPARATE guarded write on purpose
    // (lib/bill-first-print.ts): folding it into the settle CAS above could overwrite
    // a stamp a racing print-jobs enqueue just wrote, or let a print 409 a settle that
    // is otherwise valid. allSettled keeps a stamp failure from touching the settle.
    const stamping = intent?.bill === true && !billFirstPrintFresh(updated);
    const [numbered, followUps, stamped] = await Promise.allSettled([
      planHasWork(numbering) ? issueBillNumbers(id, numbering) : Promise.resolve(updated),
      runSettleFollowUps(old, updated, settings),
      stamping ? stampFirstBillPrint(id, Date.now()) : Promise.resolve(null),
    ]);
    if (followUps.status === "rejected" || followUps.value.customersTouched) cache.del("customers");
    if (updated.tableNo) cache.del("tables");

    // Today's KPIs change (tab leaves In-progress; collected/sales/dues move).
    cache.del(orderSummaryCacheKey());
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    // The tab changed — nudge the POS pulse and the Kitchen board ahead of
    // their polls. publishCafeEvent sends it at once (after() only keeps the invocation alive — which is why it sits after every follow-up) and swallows
    // every failure, so it can never delay or fail this write; the polls stay
    // the fallback and the source of truth.
    publishCafeEvent("order-changed");
    // Paid, but the number is unknown (the counter or the set failed): a 5xx
    // sends the client to Check, which prints from the stored doc.
    if (numbered.status === "rejected") return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);
    // The order exactly as answered: numbered, and carrying the first-print stamp. When this
    // settle stamped, a failed stamp is "no stamp" (the slip counts from its own print time),
    // never the stale stamp of another total, which would leave the QR off the paid bill.
    const base = numbered.value ?? updated;
    const answer = stamping ? withFirstBillPrint(base, stamped.status === "fulfilled" ? stamped.value : null) : base;
    // Printing Phase 1 (spec §7.4): the numbered bill, made from the order exactly as answered.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: answer,
          slips: intent.bill ? [{ kind: "bill" }] : [],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return success(withPrintJobs(answer, printJobs));
  } catch (error) {
    return serverError("Failed to settle order", error);
  }
}
