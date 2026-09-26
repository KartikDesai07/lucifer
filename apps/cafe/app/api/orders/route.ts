import mongoose from "mongoose";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import { Table } from "@/models/Table";
import { nextOrderSequence, bumpOrderSequenceTo, nextSlipSequence } from "@/models/Counter";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
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
import { derivePayment, ledgerContribution } from "@/lib/order";
import { parseListCursor, applyCursor } from "@/lib/order-query";
import { createOrderSchema } from "@/schemas";
import { resolveTableCharge } from "@/lib/table-admin";
import { withTableCharge, applyExtraCharges, splitChargeTotals } from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";
import { checkItemVariations } from "@/lib/variations";
import {
  resolveRewardClaimAndLine,
  rewardSnapshotFields,
  claimRewardStamps,
  returnRewardStamps,
  type RewardResolution,
} from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { shouldStoreDiscountKind } from "@pos/shared/reward-redemption";
import {
  resolveAcceptPromo,
  claimPromoRedemption,
  releasePromoRedemption,
  backfillPromoRedemptionOrderId,
  promoIsClaimable,
  promoNoteLine,
  PROMO_USED_ERROR,
} from "@/lib/order-request-accept-promo";
import { REWARD_PROMO_EXCLUSIVE, type PromoKind } from "@pos/shared/public";
import { mintedPromoCodes } from "@pos/shared/loyalty-rules";
import { mergedNote } from "@/lib/order-request-accept-core";
import { markAssignedRewardUsed, assignedRewardRefusal } from "@/lib/assigned-reward-gate";

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

  try {
    await connectDB();

    // A product sold by size must never reach the kitchen as a bare name, and a
    // variation the product does not have must never be printed as if it did.
    // One indexed query, and only when the payload could possibly be affected —
    // checked BEFORE any pricing/write below, so a bad payload costs nothing.
    const productIds = data.items
      .map((it) => it.productId)
      .filter(mongoose.isValidObjectId);
    if (productIds.length) {
      const products = await Product.find({ _id: { $in: productIds } })
        .select("name variations")
        .lean();
      const bad = checkItemVariations(
        products.map((p) => ({ _id: String(p._id), name: p.name, variations: p.variations })),
        data.items,
      );
      if (bad) return failure(bad, 400);
    }

    // Resolves the table's configured extra charge AND doubles as the existence
    // check, so this is still one query rather than two.
    const table = await resolveTableCharge(data.tableNo);
    if ("error" in table) return failure(table.error, 400);

    // Money is server-authoritative — recompute from the items + the cafe's GST
    // config; never persist the client's subtotal/gst/total verbatim. paidAmount
    // may assert what was actually COLLECTED (derivePayment clamps it to the total).
    const settings = await getSettings();
    const gstCfg = gstConfigOf(settings);
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
      // Rejected BEFORE anything is written or a slip number is burned (moved
      // above the kot/bill allocation below) — a bad claim must cost the
      // till nothing, not even a gap in the ticket series.
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

    // Slip numbers come from their OWN daily counters, separate from the order
    // sequence: one tab issues several kitchen tickets but exactly one bill, so
    // the three series cannot share a counter. Each allocation is a single
    // atomic $inc, so two tills ringing up at the same instant can never be
    // handed the same number. Allocated once here and reused by the
    // duplicate-key retry below — a retry must not consume a second number.
    // A reward claim is resolved (and can fail) ABOVE this point, so a
    // rejected claim never burns a kot/bill number.
    const printCfg = printConfigOf(settings);
    const issuesBill = printCfg.bill.showNumber && data.status === "Completed";
    const kotNumber = printCfg.kot.showNumber
      ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
      : 0;
    const billNumber = issuesBill
      ? printedSlipNumber(await nextSlipSequence("bill"), printCfg.bill.numberStart)
      : 0;

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

    const doc = {
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
      // Printed slip numbers, resolved against the cafe's configured daily
      // start and STORED — a reprint reproduces the paper, it never recomputes
      // it. The opening items are round 1, hence the single-element array.
      // A bill number is issued only when a BILL is: an order created as an
      // open tab ("Pending") gets none, so a tab that runs all evening — or is
      // cancelled — never burns a number out of the day's bill series.
      kotNumbers: printCfg.kot.showNumber ? [kotNumber] : undefined,
      billNumber: issuesBill ? billNumber : undefined,
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
    const unclaimFor = async (oid: string): Promise<void> => {
      if (resolvedClaim) await returnRewardStamps(customerId!, oid, resolvedClaim.cost);
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
      return failure("Not enough stamps for that reward", 409);
    }
    // After the stamp claim so the two compensations nest in one order: if the
    // fence refuses, the stamps claimed just above are returned before the
    // 409, leaving the customer exactly as they started.
    if (!(await fencePromoFor(orderId))) {
      await unclaimFor(orderId);
      return failure(PROMO_USED_ERROR, 409);
    }
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
        throw retryError;
      }
    }

    // CB-5D part 2 — the fence's trace, best-effort AFTER the write landed
    // (never blocking, failure swallowed inside the helper): which order
    // actually consumed this code. The claim above IS the fence; this only
    // makes it readable to staff/ops, so a failure here must never undo an
    // order that already exists (never-revert-on-write-throw).
    if (promoFenceMobile && promoIsClaimable(promoDiscount, data.promoCode, promoKind)) {
      await backfillPromoRedemptionOrderId(data.promoCode, promoFenceMobile, order.orderId);
    }
    // CB-5D part 2 (owner decision) — the ASSIGNED code is now SPENT, so it
    // leaves the diner's "my rewards" list. Best-effort, beside the backfill
    // and under the same rule: the fence claimed BEFORE the write is what
    // stops a second spend, so a failure here costs only a stale list row.
    // Keyed on the customer's own stored mobile, resolved earlier for the
    // fence; a counter order with no customer has no assigned code to spend.
    if (data.promoCode && promoFenceMobile) {
      await markAssignedRewardUsed(data.promoCode, promoFenceMobile, order.orderId, new Date());
    }

    // The order row is now the source of truth. The ledger + table updates are
    // best-effort follow-ups: a failure here must NOT fail the request (that
    // would invite a retry → duplicate order). Any drift is repairable via the
    // customer reconcile endpoint.
    if (customerId) {
      // A held "Unpaid" open tab contributes nothing yet (ledgerContribution → 0);
      // its visit/spend/due land at settlement. Every other order contributes now.
      const c = ledgerContribution({
        payment: data.payment,
        total: totals.total,
        paidAmount: pay.paidAmount,
        status: data.status,
      });
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

    // Occupy the table ONLY if it is currently free, so two staff can't claim
    // the same table and overwrite each other's currentOrderId.
    if (data.tableNo) {
      try {
        await Table.findOneAndUpdate(
          { tableNo: data.tableNo, status: "Available" },
          { status: "Occupied", currentOrderId: order.orderId },
        );
        cache.del("tables");
      } catch {
        /* best-effort */
      }
    }

    cache.del(orderSummaryCacheKey());
    // The tab changed — nudge the POS pulse and the Kitchen board ahead of
    // their polls. publishCafeEvent defers it past the response and swallows
    // every failure, so it can never delay or fail this write; the polls stay
    // the fallback and the source of truth.
    publishCafeEvent("order-changed");
    return created(order);
  } catch (error) {
    return serverError("Failed to create order", error);
  }
}
