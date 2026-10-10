import mongoose from "mongoose";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import { nextOrderSequence, bumpOrderSequenceTo } from "@/models/Counter";
import { printConfigOf } from "@/lib/print";
import { allocateOpeningSlips, BILL_NUMBER_UNCONFIRMED } from "@/lib/slip-numbers";
import { billNumberingPlan } from "@/lib/gst-invoice";
import { runCreateFollowUps } from "@/lib/order-create-followups";
import { settledValue } from "@/lib/settled";
import { createReplayResponse, createReplayVerdict, findCreateReplay, isIdemKeyDuplicate } from "@/lib/order-idem";
import { withKitchenFlags } from "@/lib/kitchen-lines-server";
import { createOrderPrintJobs, openingSlipsOf, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";
import cache from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAuth,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import {
  generateOrderId,
  dayRange,
  orderSummaryCacheKey,
  escapeRegex,
} from "@/lib/utils";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { computeOrderTotals } from "@/lib/receipt";
import { derivePayment } from "@/lib/order";
import { parseListCursor, applyCursor } from "@/lib/order-query";
import { createOrderSchema } from "@/schemas";
import { resolveTableCharge } from "@/lib/table-admin";
import { withTableCharge, applyExtraCharges, splitChargeTotals } from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";
import { checkItemVariations, checkItemRemovedModifiers } from "@/lib/variations";
import { orderLinesRefusal, MENU_REFUSAL_STATUS } from "@/lib/order-availability";
import {
  resolveRewardClaimAndLine,
  rewardSnapshotFields,
  claimRewardStamps,
  returnRewardStamps,
  type RewardResolution,
} from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { firstBillPrintInsertFields } from "@/lib/bill-first-print";
import { shouldStoreDiscountKind } from "@pos/shared/reward-redemption";
import {
  resolveAcceptPromo,
  claimPromoRedemption,
  releasePromoRedemption,
  promoIsClaimable,
  promoNoteLine,
  PROMO_USED_ERROR,
} from "@/lib/order-request-accept-promo";
import { REWARD_PROMO_EXCLUSIVE, type PromoKind } from "@pos/shared/public";
import { mintedPromoCodes } from "@pos/shared/loyalty-rules";
import { mergedNote } from "@/lib/order-request-accept-core";
import { assignedRewardRefusal } from "@/lib/assigned-reward-gate";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/orders — always fresh (NO cache). Filters: status, tableNo, date,
// limit, before (cursor pagination: createdAt of the oldest row already seen)
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const tableNo = sp.get("tableNo");
  const payment = sp.get("payment");
  const customerId = sp.get("customerId");
  const phone = sp.get("phone")?.trim(); // search orders by the customer's mobile
  const date = sp.get("date"); // YYYY-MM-DD
  const beforeParam = sp.get("before"); // cursor: createdAt of the last row already seen
  const limitParam = Number(sp.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  let cursor: Date | null = null;
  if (beforeParam) {
    cursor = parseListCursor(beforeParam);
    if (!cursor) return failure("Invalid `before` cursor", 400);
  }

  try {
    await connectDB();
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (tableNo) query.tableNo = tableNo;
    if (payment) query.payment = payment;
    if (customerId && mongoose.isValidObjectId(customerId)) {
      query.customerId = customerId;
    }
    // Phone search: orders don't store a phone, so reverse-look-up the matching
    // customers and filter by their ids. An explicit customerId param wins (the
    // UI never sends both). No match → an empty list (not "all orders").
    if (phone && query.customerId === undefined) {
      const matches = await Customer.find({
        mobile: new RegExp(escapeRegex(phone), "i"),
      })
        .select("_id")
        .limit(50)
        .lean();
      if (matches.length === 0) return success([]);
      query.customerId = { $in: matches.map((c) => c._id) };
    }
    if (date) {
      const { start, end } = dayRange(new Date(date));
      query.createdAt = { $gte: start, $lte: end };
    }
    if (cursor) applyCursor(query, cursor);

    // Near-full projection is DELIBERATE (F2.10 audit): the detail sheet,
    // settle modal, and both receipts render from these list rows without a
    // per-order refetch, so every field except `updatedAt` is consumed
    // client-side. Only the one truly-unused field is excluded.
    const orders = await Order.find(query)
      .select("-updatedAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return success(orders);
  } catch (error) {
    return serverError("Failed to fetch orders", error);
  }
}

// POST /api/orders — create order, update customer stats + table status
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);

  try {
    await connectDB();

    // The independent reads start together and are CHECKED in order. First the
    // send key (F5): a re-send whose first try already landed answers with that
    // order (200) before anything else — no 400 on a product edited since, no
    // sequence, no claim, no publish, and no slip number unless it finishes a
    // stale unnumbered bill (createReplayVerdict).
    const productIds = data.items
      .map((it) => it.productId)
      .filter(mongoose.isValidObjectId);
    const [replayR, productsR, tableR, settingsR] = await Promise.allSettled([
      data.idemKey ? findCreateReplay(data.idemKey) : Promise.resolve(null),
      // One indexed query, only when the payload could possibly be affected.
      productIds.length
        ? Product.find({ _id: { $in: productIds } })
            .select("name variations modifiers modifiersPreselected price discount available isActive")
            .lean()
        : Promise.resolve([]),
      // The table's configured extra charge, doubling as its existence check.
      resolveTableCharge(data.tableNo),
      getSettings(),
    ]);
    // The replay reads the settings only for the bill numbering: a Pay Now sale
    // with no number stored yet answers a retryable 503 while young, and is
    // numbered by the replay once past BILL_NUMBER_SETTLE_MS. Awaited, so a
    // throw inside it still lands in this route's catch.
    const replayed = settledValue(replayR);
    if (replayed) return await createReplayVerdict(replayed, data.items, printConfigOf(settledValue(settingsR)).bill);

    // A product sold by size must never reach the kitchen as a bare name, and a
    // variation the product does not have must never be printed as if it did —
    // refused BEFORE any pricing/write below, so a bad payload writes nothing.
    const products = settledValue(productsR);
    const bad = checkItemVariations(
      products.map((p) => ({ _id: String(p._id), name: p.name, variations: p.variations })),
      data.items,
    );
    if (bad) return failure(bad, 400);

    // "Modifiers come ticked" (owner, 2026-09-29) — a removal is legal only on
    // an item whose modifiers come ticked and must name one of that item's
    // own modifiers; refused here too, before any pricing/write.
    const badRemovals = checkItemRemovedModifiers(
      products.map((p) => ({
        _id: String(p._id),
        name: p.name,
        modifiers: p.modifiers,
        modifiersPreselected: p.modifiersPreselected,
      })),
      data.items,
    );
    if (badRemovals) return failure(badRemovals, 400);

    const table = settledValue(tableR);
    if ("error" in table) return failure(table.error, 400);

    // Money is server-authoritative — recompute from the items + the cafe's GST
    // config; never persist the client's subtotal/gst/total verbatim. paidAmount
    // may assert what was actually COLLECTED (derivePayment clamps it to the total).
    const settings = settledValue(settingsR);
    // Bound here, before lateReplay below can first run (it reads printCfg).
    const printCfg = printConfigOf(settings);
    const gstCfg = gstConfigOf(settings);
    // F5 — an overlap twin with the same send key may have landed while this
    // request was between its read wave and here: before refusing (or after
    // losing the insert on the key), answer with the order the twin made.
    const lateReplay = async () => (data.idemKey ? createReplayResponse(data.idemKey, data.items, printCfg.bill) : null);
    // B2 - menu re-check: refuse a line whose item is gone, out of stock,
    // re-priced or renamed since the cashier picked it, before any pricing,
    // number, claim or write. lateReplay runs first so a twin of this send
    // that already landed answers 200. It narrows, does not close, the race:
    // a first try still in flight can land after this 409 (same class as the
    // stamps and promo 409s below).
    const menuRefusal = orderLinesRefusal(products, data.items);
    if (menuRefusal) return (await lateReplay()) ?? failure(menuRefusal, MENU_REFUSAL_STATUS);
    // An OMITTED chargeAmount means "whatever this table charges" — safe to omit
    // because the server just re-derived it, and safer than echoing: the POS
    // caches tables for 30s, so an echo could re-apply a charge an admin has
    // already lowered. A NUMBER is the operator deliberately waiving or
    // adjusting it for this bill (0 = waived). Either way it is bounded, and a
    // table with no configured charge yields nothing at all.
    const tableChargeAmount =
      table.charge.amount > 0 ? (data.chargeAmount ?? table.charge.amount) : 0;
    // CB-CHG — charges[] is the source of truth (plan §4): the table lane via
    // withTableCharge (fence: never touches an extra), the staff-entered
    // extras via applyExtraCharges (fence: never touches the table entry).
    // `data.extraCharges` absent = no extras on this new order.
    const charges = applyExtraCharges(
      withTableCharge(
        [],
        tableChargeAmount > 0 ? { label: table.charge.label, amount: tableChargeAmount } : null,
      ),
      data.extraCharges ?? [],
    );
    // CB-CHG — computeOrderTotals takes the table portion and the extras
    // portion SEPARATELY: the table charge keeps its shipped TABLE_CHARGE_MAX
    // ceiling, the extras ride on top uncapped (decision 8) — summing them
    // first would silently cap a legitimate bill and disagree with the
    // stored charges[]/chargeAmount mirror, which does not clamp.
    const { table: charge, extra: extraCharge } = splitChargeTotals(charges);

    // Resolved BEFORE totals (CB-5B S4) so a reward claim can be validated
    // against the plain bill (no reward yet) and, if it resolves, folded into
    // the SAME totals computation the rest of the route already trusts —
    // there is no second money path for a redeemed order.
    const customerId =
      data.customerId && mongoose.isValidObjectId(data.customerId)
        ? data.customerId
        : undefined;

    // Plain totals — no reward — priced ONLY to give resolveRewardClaim a
    // billTotal to gate a milestone's own minBill against. Never written or
    // returned; a reward, once resolved, replaces this with the real totals.
    const plainTotals = computeOrderTotals({
      items: data.items,
      discount: data.discount,
      discountKind: data.discountKind ?? undefined,
      charge,
      extraCharge,
      cfg: gstCfg,
    });

    let rewardItems = data.items;
    let effectiveDiscountKind = data.discountKind ?? undefined;
    let resolvedClaim: Extract<RewardResolution, { ok: true }> | undefined;
    // CB-5D part 2 — the promo-code assignment a claimed rung mints (or
    // undefined, the overwhelmingly common case). Built ONCE here, alongside
    // resolvedClaim, and reused by every claim attempt below (including the
    // duplicate-key retry's re-claim against the renumbered orderId):
    // claimRewardStamps de-dupes a retry via $addToSet, whose element equality
    // is WHOLE-DOCUMENT, so a fresh `new Date()` on a retry would make that
    // retry's element unequal to the first attempt's and append the reward a
    // SECOND time. Capturing assignedAt once and passing the SAME assignment
    // object into both claimFor(orderId) and claimFor(retryOrderId) is what
    // prevents that duplicate.
    let rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
    if (data.rewardAt !== undefined) {
      // KOT_ROUND_OPENING (1) — the opening items are always round 1, so a
      // resolved item-reward's dish line is stamped the same way.
      const resolved = await resolveRewardClaimAndLine(
        {
          settings,
          customerId,
          rewardAt: data.rewardAt,
          billTotal: plainTotals.total,
          // Order-taking writer — an item reward IS allowed here (D9: the
          // free dish must reach the kitchen at order-taking time, so this is
          // exactly the writer that is allowed to grant one).
          refuseItemKind: false,
        },
        1,
      );
      // Rejected BEFORE anything is written or a slip number is burned (the
      // KOT number is taken only after every refusal, the bill number only by
      // the insert that won) — a bad claim must cost the till nothing.
      if (!resolved.ok) return failure(resolved.message, 400);

      // Appended to the priced items so it reaches BOTH computeOrderTotals
      // (untotalled/untaxed via the reward skip) and the stored doc. productId
      // is re-stringified: resolveRewardItemLine resolves a real ObjectId
      // (it queried Product by it), but every OTHER element in this array is
      // the Zod-parsed `data.items` shape, whose productId is a plain string
      // (Order.create casts either spelling the same way).
      if (resolved.line) {
        rewardItems = [...data.items, { ...resolved.line, productId: String(resolved.line.productId) }];
      }
      // A reward REPLACES the discountKind — Order carries one scalar + one
      // kind, so a reward and a gst preset can never both be the stored kind.
      effectiveDiscountKind = "reward";
      resolvedClaim = resolved.claim;
      // Same settings?.promoCodes source the QR accept path resolves against
      // (order-request-accept-reward.ts) — one place decides what a rung
      // mints, so the two surfaces can never disagree about a code.
      rewardAssignment = buildRewardAssignment(resolved.claim.milestone, settings?.promoCodes, new Date());
    }

    // ── CB-5D part 2 — COUNTER-SIDE PROMO CODES ──────────────────────────
    // The same code a diner can type on the QR surface must work at the till.
    // Resolved through the SAME helper the accept path uses (resolveAcceptPromo)
    // rather than a second counter-only money path: one place decides what a
    // code is worth, so the two surfaces can never disagree about a bill.
    //
    // INTENT ONLY, like `rewardAt`: the staff send a CODE, never an amount,
    // and `quotedDiscount` is undefined here because a counter has no earlier
    // quote to drift against — the server's own resolution is the only figure.
    let promoDiscount = 0;
    let promoLine: string | undefined;
    // The fence identity. Resolved ONCE here and reused by every claim attempt
    // below, so the renumber retry cannot fence against a different key.
    let promoFenceMobile: string | undefined;
    let promoKind: PromoKind | undefined;
    if (data.promoCode) {
      // A reward and a promo are mutually exclusive on ONE bill — the same
      // rule the diner surface states (REWARD_PROMO_EXCLUSIVE) and the
      // add-round writer enforces (resolveAddRoundKind). An Order carries one
      // discount scalar and one kind, so allowing both would silently drop
      // whichever lost. Checked BEFORE anything is claimed or written.
      if (resolvedClaim) return failure(REWARD_PROMO_EXCLUSIVE, 400);

      const promo = resolveAcceptPromo(
        data.promoCode,
        // NULL, not undefined: "there was no quote". The counter types a code
        // onto a live bill, so the server's own resolution is the only figure
        // and there is nothing for it to have drifted from. Passing undefined
        // here would compare against 0 and refuse every code worth money.
        null,
        settings?.promoCodes,
        plainTotals.subtotal,
        // CB-5D part 2 FINAL — a milestone-minted code is single-use
        // regardless of its Settings row's own tick.
        mintedPromoCodes(settings?.loyaltyRules?.milestones),
      );
      if ("error" in promo) return failure(promo.error, 400);
      promoDiscount = promo.discount;
      promoKind = promo.kind;
      promoLine = promoNoteLine(data.promoCode, promo.discount);

      // THE HAZARD THIS BLOCK EXISTS TO CLOSE (owner-flagged): the fence must
      // key on the CUSTOMER'S MOBILE, never the customerId. PromoRedemption's
      // unique index is {code, mobile}, and the diner surface — which knows
      // only a mobile — writes the canonical form of it. Keying a counter
      // claim on the id instead would give ONE person two independent fences,
      // so a once-per-customer code could be spent once from the QR surface
      // and once again at the till. The mobile is not on the Order, so it is
      // read from the Customer row here; canonicalPromoMobile (inside
      // claimPromoRedemption) then collapses +91/0 re-typings to one key.
      //
      // Hoisted to run whenever a promoCode is present (not merely when
      // oncePerCustomer's fence needs it): the counter-expiry defect fix below
      // needs this SAME mobile to check an ASSIGNED code's validDays, and an
      // assigned code is by definition attached to a customer (it lives on
      // Customer.rewards[], never on an anonymous till sale) — so a walk-in
      // with no customer selected can never be carrying one, and refusing to
      // resolve a mobile for them is correct, not merely incidental. Reusing
      // ONE lookup for both purposes also avoids a second indexed query on the
      // same order.
      let promoMobile: string | undefined;
      if (customerId) {
        const carrier = await Customer.findById(customerId).select("mobile").lean();
        promoMobile = carrier?.mobile;
      }

      // CB-5D part 2 DEFECT FIX — the counter never checked an ASSIGNED code's
      // expiry (validDays), only marked it spent (markAssignedRewardUsed,
      // below). Run AFTER resolveAcceptPromo succeeds — so a code that is
      // merely invalid/drifted still reports THAT, never "expired" — and
      // BEFORE any fence claim, so an expired code is refused before anything
      // is claimed. A code with no matching assigned-reward row (an ordinary
      // Settings promo, never assigned to anyone) is untouched by this gate
      // (assignedRewardRefusal's own contract). A walk-in with no resolved
      // mobile cannot be holding an assigned code at all, so this is skipped
      // rather than refused — refusing here would 400 every anonymous, non-
      // assigned promo redemption at the till.
      if (promoMobile) {
        const refusal = await assignedRewardRefusal(data.promoCode, promoMobile, Date.now());
        if (refusal) return failure(refusal, 400);
      }

      if (promo.oncePerCustomer && promoIsClaimable(promo.discount, data.promoCode, promo.kind)) {
        if (!customerId) {
          return failure("Select a customer — this code is limited to one use per customer", 400);
        }
        if (!promoMobile) {
          return failure("Select a customer — this code is limited to one use per customer", 400);
        }
        promoFenceMobile = promoMobile;
      }
    }

    const totals = resolvedClaim
      ? computeOrderTotals({
          items: rewardItems,
          discount: data.discount,
          discountKind: effectiveDiscountKind,
          charge,
          extraCharge,
          cfg: gstCfg,
          reward: resolvedClaim.reward,
        })
      : data.promoCode
        ? // A promo REPLACES the operator's manual discount figure: the code's
          // own resolved value is the discount, and `discountKind` stays
          // whatever the operator set (a promo is not a "kind" on this model —
          // the note line is what records it, exactly as on the diner path).
          computeOrderTotals({
            items: data.items,
            discount: promoDiscount,
            discountKind: effectiveDiscountKind,
            charge,
            extraCharge,
            cfg: gstCfg,
          })
        : plainTotals;
    const pay = derivePayment(
      data.payment,
      totals.total,
      data.splitCash,
      data.splitOnline,
      data.paidAmount,
    );
    if ("error" in pay) return failure(pay.error, 400);

    // A held "Unpaid" open tab is unpaid by definition and must NEVER require a
    // customer — the exclusion below is essential, don't "simplify" it away.
    // Every other mode that leaves a remainder uncollected parks that remainder
    // on a customer's due, so the carrier must EXIST (not merely be present) —
    // an ObjectId that's well-formed but deleted would otherwise complete the
    // sale with the due recorded against nobody, invisible to the dues KPI.
    // Existence costs a query only on a sale that actually leaves a due.
    if (data.payment !== "Unpaid" && pay.paidAmount < totals.total) {
      const carrierExists = customerId
        ? (await Customer.exists({ _id: customerId })) != null
        : false;
      if (!carrierExists) {
        return failure("Select a customer — the unpaid remainder becomes their due", 400);
      }
    }

    // Skip-KOT: stamp the opening lines the menu never sends to the kitchen BEFORE the number draw and
    // the doc below read them (fails open: an unreadable menu stamps nothing, prints as before).
    const kot = await withKitchenFlags(rewardItems);
    rewardItems = kot.lines;

    // Pay Now's bill: the SAME condition under which this route makes the server's bill job
    // below, named once so the stamp and the job can never drift apart.
    const printsBillNow = intent?.bill === true && data.status === "Completed";
    const unnumberedDoc = {
      customerName: data.customerName,
      customerId,
      // The opening items are KOT round 1 (sent to the kitchen at creation —
      // whether a held tab or a one-shot paid order). Later rounds bump kotRounds.
      // rewardItems already carries the claimed free-dish line (if any),
      // itself stamped kotRound 1 above — mapping again here is a no-op for it.
      items: rewardItems.map((it) => ({ ...it, kotRound: 1 })),
      kotRounds: 1,
      subtotal: totals.subtotal,
      discount: totals.discount,
      // shouldStoreDiscountKind (the repo-wide amount-gates-kind rule, with
      // its one named exception): a "reward" kind stores even at ₹0 — an item
      // reward's derived amount is ALWAYS 0, so gating it like "gst" would
      // $unset the snapshot (and the stamps-spent provenance) on exactly the
      // orders that spent them.
      discountKind: shouldStoreDiscountKind(totals.discount, effectiveDiscountKind)
        ? effectiveDiscountKind
        : undefined,
      gstAmount: totals.gstAmount,
      // Snapshot the GST config in effect now, so this order's receipt reflects
      // the tax actually charged even after a later rate/mode change.
      gstRate: gstCfg.gstEnabled ? gstCfg.gstRate : 0,
      gstMode: gstCfg.gstMode,
      // CB-CHG — charges[] is the source of truth; chargeAmount/chargeLabel
      // become its derived mirror (chargeWriteFields), never hand-written.
      // Both omitted (via the $unset-shaped `unset` branch, spread as nothing
      // for a plain create doc) when there is nothing to charge.
      ...(chargeWriteFields(charges).set ?? {}),
      total: totals.total,
      paidAmount: pay.paidAmount,
      payment: data.payment,
      splitCash: pay.splitCash,
      splitOnline: pay.splitOnline,
      status: data.status,
      receiver: authed.session.user?.name ?? data.receiver, // trust the session, not the client
      staffId: authed.session.user.id,
      tableNo: data.tableNo,
      // Omit-empty: only ever stored when true, so no existing order's
      // meaning changes and a dine-in tab carries no field at all.
      ...(data.parcel ? { parcel: true } : {}),
      // CB-5D part 2 — the promo's staff-actionable line composes onto the
      // operator's own note rather than replacing it, through the SAME
      // mergedNote helper the diner accept path uses. The Order model stores
      // no promo field (the fence row is the durable record), so this line is
      // what makes a promo visible on the bill and the reprint.
      notes: mergedNote(data.notes, promoLine),
      // CB-5B — the reward reprint snapshot, omit-empty (no keys at all when
      // no reward resolved).
      ...(resolvedClaim ? rewardSnapshotFields(resolvedClaim.reward, resolvedClaim.cost) : {}),
      // F5 — the send key, omit-empty (never null: the partial unique index
      // counts null). A second insert with the same key is refused by the index.
      ...(data.idemKey ? { idemKey: data.idemKey } : {}),
      // Printing Phase 1 — round 1 is the server's to print, so the repair sweep may re-create it.
      ...(intent ? { kotPrintDevices: [intent.deviceId] } : {}),
      // The bill's first print is NOW (the server prints it below), so the pay QR's
      // "Valid till" anchor rides the insert itself — no extra write, and the
      // duplicate-key retry re-sends this same doc, stamp included. A bill this
      // call does not print is stamped later by settle / the print-jobs enqueue.
      ...firstBillPrintInsertFields(printsBillNow, Date.now(), totals.total),
    };

    // Order number from an atomic per-day counter (no read-max race). On the
    // rare collision with orders predating the counter, reseed from the day's
    // max once — the unique index on orderId is the safety net.
    //
    // CLAIM ORDERING (CB-5B S4): the stamp claim keys its marker on the
    // orderId (claimRewardStamps -> redeemedOrders), and the claim happens
    // BEFORE the create — the claimPromoRedemption shape — so a bill can
    // never be discounted by stamps that were not actually spent.
    //
    // The claim is therefore bound to the orderId the order is ACTUALLY
    // created with, not merely to the first one we minted. The duplicate-key
    // retry below re-numbers the order (seq2), so claiming once against the
    // first orderId would leave the spend recorded against an orderId no
    // order carries: the cancel path (S6) looks the redemption up BY orderId
    // and would find nothing, so the stamps could never be returned, and the
    // `redeemedOrders: {$ne: orderId}` fence would no longer recognise the
    // real order — the same diner could redeem against it a second time.
    // Each attempt claims for its own orderId, and a failed attempt returns
    // what it claimed before the next one begins.
    const claimFor = async (oid: string): Promise<boolean> =>
      resolvedClaim ? claimRewardStamps(customerId!, oid, resolvedClaim.cost, rewardAssignment) : true;
    // The undo passes the SAME assignment the claim minted (O10): whatever a
    // claim writes, its compensation must unwrite — without it the stamps came
    // back and the rung's promo code stayed live with the diner.
    const unclaimFor = async (oid: string): Promise<void> => {
      if (resolvedClaim) await returnRewardStamps(customerId!, oid, resolvedClaim.cost, rewardAssignment);
    };

    // CB-5D part 2 — the promo fence, claimed per ORDER ID for exactly the
    // reason the stamp claim above is: the duplicate-key retry re-numbers the
    // order, and a fence claimed against the first orderId would record the
    // spend against an id no order carries. The claimant is {kind:"order"},
    // the counter's own key — a REPLAY of the same orderId resumes rather
    // than being told the code is used against itself, while any OTHER
    // claimant (including this customer's own earlier QR request) is a
    // genuine collision and refuses. Claimed BEFORE the create, released only
    // on a DEFINITE no-write, exactly like the diner path.
    const fencePromoFor = async (oid: string): Promise<boolean> => {
      if (!promoFenceMobile || !promoIsClaimable(promoDiscount, data.promoCode, promoKind)) return true;
      const decision = await claimPromoRedemption(data.promoCode, promoFenceMobile, {
        kind: "order",
        id: oid,
      });
      return decision !== "reject";
    };
    const unfencePromoFor = async (oid: string): Promise<void> => {
      if (!promoFenceMobile || !promoIsClaimable(promoDiscount, data.promoCode, promoKind)) return;
      await releasePromoRedemption({ kind: "order", id: oid });
    };

    const seq = await nextOrderSequence();
    const orderId = generateOrderId(seq);
    if (!(await claimFor(orderId))) {
      return (await lateReplay()) ?? failure("Not enough stamps for that reward", 409);
    }
    // After the stamp claim so the two compensations nest in one order: if the
    // fence refuses, the stamps claimed just above are returned before the
    // 409, leaving the customer exactly as they started.
    if (!(await fencePromoFor(orderId))) {
      await unclaimFor(orderId);
      return (await lateReplay()) ?? failure(PROMO_USED_ERROR, 409);
    }

    // Slip numbers come from their OWN daily counters (one tab, several kitchen
    // tickets, exactly one bill), each a single atomic $inc. The opening KOT
    // number is taken HERE — after every refusal above, so a refused create
    // costs the ticket series nothing — and reused by the duplicate-key retry.
    // Losing it to a failed insert is an accepted burn. The order's TOKEN (when
    // tokens are on) is drawn right here with it, on the same terms: one token
    // per order, reused by the retry through `doc`, burned by a refused insert. The BILL number is not
    // taken here at all: only the insert that WON takes it (below), so a Pay
    // Now twin that loses on the send key can never leave a gap in the bills.
    let slips: Awaited<ReturnType<typeof allocateOpeningSlips>>;
    try {
      slips = await allocateOpeningSlips(printCfg, { kitchen: kot.kitchen });
    } catch (slipError) {
      // No insert has run, so this is a DEFINITE no-order: both claims go back.
      await Promise.allSettled([unclaimFor(orderId), unfencePromoFor(orderId)]);
      throw slipError;
    }
    const doc = { ...unnumberedDoc, ...slips };
    let order;
    try {
      order = await Order.create({ ...doc, orderId });
    } catch (e) {
      // ONLY a duplicate-key error reverses the claim. An E11000 is a SERVER
      // RESPONSE: the server received this insert, rejected it on the unique
      // index, and wrote nothing — a DEFINITE no-write outcome, the one
      // condition never-revert-on-write-throw permits a compensating return
      // under. Any OTHER throw (socket timeout, primary step-down) may well
      // accompany an insert that actually COMMITTED, and returning stamps
      // there would credit the diner for a reward the landed order still
      // carries — a silent double-spend. So a bare throw propagates with the
      // claim intact: the stamps stay spent against an order that exists.
      if (!isDuplicateKeyError(e)) throw e;
      await unclaimFor(orderId);
      // The fence is released on the SAME definite-no-write outcome as the
      // stamps, and for the same reason: this orderId will never exist, so a
      // fence row pointing at it would burn the customer's single use on an
      // order they were never billed for.
      await unfencePromoFor(orderId);
      // F5 — the send key collided, not the orderId: our own twin's insert
      // landed first. Adopt its order (its claims stand, ours just went back);
      // renumbering would make the second order this key exists to prevent.
      if (isIdemKeyDuplicate(e)) {
        const won = await lateReplay();
        if (won) return won;
        throw e;
      }
      const { start, end } = dayRange();
      const last = await Order.findOne({ createdAt: { $gte: start, $lte: end } })
        .sort({ orderId: -1 })
        .select("orderId")
        .lean();
      const lastSeq = last?.orderId
        ? parseInt(last.orderId.split("-").pop() ?? "", 10)
        : 0;
      const seq2 = await bumpOrderSequenceTo(Number.isFinite(lastSeq) ? lastSeq : 0);
      const retryOrderId = generateOrderId(seq2);
      // Re-claim against the RE-NUMBERED order, so the marker matches the row
      // that actually lands. A diner who spent their last stamps on the first
      // attempt still has them (returned just above), so this re-claim fails
      // only if another device genuinely took them in between — and then the
      // bill must not be discounted, exactly as on the first attempt.
      if (!(await claimFor(retryOrderId))) {
        return failure("Not enough stamps for that reward", 409);
      }
      // Re-fenced against the RE-NUMBERED order, mirroring the re-claim above:
      // the released row is gone, so this claim lands fresh unless another
      // surface genuinely took the code in between — and then the bill must
      // not carry the discount, exactly as on the first attempt.
      if (!(await fencePromoFor(retryOrderId))) {
        await unclaimFor(retryOrderId);
        return failure(PROMO_USED_ERROR, 409);
      }
      try {
        order = await Order.create({ ...doc, orderId: retryOrderId });
      } catch (retryError) {
        // Same rule as the first attempt: only a duplicate-key rejection is a
        // definite no-write. A bare throw here may have committed, so the
        // claim stands rather than risk crediting a reward an order carries.
        if (isDuplicateKeyError(retryError)) {
          await unclaimFor(retryOrderId);
          await unfencePromoFor(retryOrderId);
        }
        const won = isIdemKeyDuplicate(retryError) ? await lateReplay() : null;
        if (won) return won;
        throw retryError;
      }
    }

    // The order row is now the source of truth. Everything below is a
    // best-effort follow-up that must NOT fail the request (that would invite
    // a retry → duplicate order), so all of it settles together: any drift is
    // repairable via the customer reconcile endpoint.
    const landed = order;
    const numbering = billNumberingPlan(landed, printCfg.bill); // a paid sale's bill number + GST invoice serial
    // The five writes (bill number, promo trace + spent, ledger, table) settle
    // together inside lib/order-create-followups.ts; the promo gates stay here
    // because they read the route's fence state.
    const { numbered } = await runCreateFollowUps({
      landed,
      settings,
      numbering,
      customerId,
      tableNo: data.tableNo,
      ledger: { payment: data.payment, total: totals.total, paidAmount: pay.paidAmount, status: data.status },
      promoTrace:
        promoFenceMobile && promoIsClaimable(promoDiscount, data.promoCode, promoKind)
          ? { code: data.promoCode, mobile: promoFenceMobile }
          : null,
      promoSpent: data.promoCode && promoFenceMobile ? { code: data.promoCode, mobile: promoFenceMobile } : null,
    });

    cache.del(orderSummaryCacheKey());
    // The tab changed — nudge the POS pulse and the Kitchen board ahead of
    // their polls. publishCafeEvent sends it at once (after() only keeps the invocation alive — which is why it sits after every follow-up) and swallows
    // every failure, so it can never delay or fail this write; the polls stay
    // the fallback and the source of truth.
    publishCafeEvent("order-changed");
    // The order exists but its bill number is unknown: a 5xx sends the client
    // to Send again. Within BILL_NUMBER_SETTLE_MS (30 s) that replay answers
    // "still saving" (503); after it, the replay issues the number itself
    // (guarded, never a second one) and answers with the numbered order.
    if (numbered.status === "rejected") return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);
    // Printing Phase 1 (spec §7.4): the opening round's KOT (+ its token slip, S7), and Pay Now's bill when
    // this call site prints it, made from the order exactly as answered. Never throws.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: numbered.value ?? landed,
          slips: [...openingSlipsOf(numbered.value ?? landed, 1), ...(printsBillNow ? [{ kind: "bill" as const }] : [])],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return created(withPrintJobs(numbered.value ?? landed, printJobs));
  } catch (error) {
    return serverError("Failed to create order", error);
  }
}
