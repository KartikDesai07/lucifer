import mongoose, { type FilterQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, type IOrder } from "@/models/Order";
import { Product } from "@/models/Product";
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
import { getSettings, gstConfigOf } from "@/lib/settings";
import { computeOrderTotals, gstConfigFromOrder, resolveDiscountKind } from "@/lib/receipt";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
import { nextSlipSequence } from "@/models/Counter";
import { voidGuardFilter } from "@/lib/order-void";
import { addItemsSchema } from "@/schemas";
import { checkItemVariations } from "@/lib/variations";
import {
  chargesFromOrder,
  applyExtraCharges,
  withTableCharge,
  splitChargeTotals,
  DEFAULT_TABLE_CHARGE_LABEL,
} from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";
import {
  resolveRewardClaimAndLine,
  rewardSnapshotFields,
  claimRewardStamps,
  returnRewardStamps,
  type RewardResolution,
} from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import {
  shouldStoreDiscountKind,
  rewardFromOrderSnapshot,
} from "@pos/shared/reward-redemption";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/items — fire another KOT round on an open tab: append the
// new items (stamped with the next round number), recompute money from the FULL
// item set using the tab's GST SNAPSHOT (so a tab opened earlier keeps its
// original tax), and bump the round counter. The tab stays Pending/Unpaid/unpaid.
//
// This is a read-modify-write, but the conditional update is guarded on the
// round we read (kotRounds) plus {status:Pending, payment:Unpaid}: a concurrent
// add from a second device, or a settle that landed first, makes the match fail
// → 409 (the client retries with its items intact / reopens), so a round is never
// silently lost and items can never be appended to an already-settled bill.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, addItemsSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();

    // A product sold by size must never reach the kitchen as a bare name, and a
    // variation the product does not have must never be printed as if it did.
    // One indexed query, and only when the payload could possibly be affected —
    // checked BEFORE the CAS write below, so a bad round never touches the tab.
    const productIds = parsed.data.items
      .map((it) => it.productId)
      .filter(mongoose.isValidObjectId);
    if (productIds.length) {
      const products = await Product.find({ _id: { $in: productIds } })
        .select("name variations")
        .lean();
      const bad = checkItemVariations(
        products.map((p) => ({ _id: String(p._id), name: p.name, variations: p.variations })),
        parsed.data.items,
      );
      if (bad) return failure(bad, 400);
    }

    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    if (old.status !== "Pending" || old.payment !== "Unpaid") {
      return failure("Can only add items to an open tab", 409);
    }

    const round = (old.kotRounds ?? 0) + 1;
    const newItems = parsed.data.items.map((it) => ({ ...it, kotRound: round }));
    let fullItems = [...old.items, ...newItems];

    // Recompute from the tab's GST snapshot, not live settings. An updated
    // discount may ride along (server re-clamps it to the new subtotal).
    const discount = parsed.data.discount ?? old.discount;
    // Absent = leave the tab's stored kind alone; null = the operator cleared
    // the preset; "gst" = (re-)apply it — same omit-unchanged discipline as discount.
    let discountKind = resolveDiscountKind(parsed.data.discountKind, old.discountKind);
    const settings = await getSettings();
    const gstCfg = gstConfigFromOrder(old, gstConfigOf(settings));
    // CB-CHG — charges[] is the source of truth (plan §4), upgraded in place
    // from the tab's legacy scalars if it predates this feature. The table
    // lane is carried forward untouched unless the operator deliberately
    // changed it (chargeAmount body override) — omitted means unchanged,
    // exactly like discount. Adding a round is never an occasion to RE-READ
    // the table: the charge was snapshotted when the tab opened, and an admin
    // editing the table mid-service must not re-price a bill the kitchen is
    // already cooking. The override now targets the TABLE ENTRY'S AMOUNT
    // ONLY (0 = waive the table charge) — extras are their own list, carried
    // through untouched by withTableCharge and replaced wholesale (present =
    // the complete new set) by applyExtraCharges when the body sends one.
    const oldCharges = chargesFromOrder(old);
    const oldTableCharge = oldCharges.find((c) => c.type === "table");
    const tableChargeAmount = parsed.data.chargeAmount ?? oldTableCharge?.amount ?? 0;
    const charges = applyExtraCharges(
      withTableCharge(
        oldCharges,
        tableChargeAmount > 0
          ? { label: oldTableCharge?.label ?? DEFAULT_TABLE_CHARGE_LABEL, amount: tableChargeAmount }
          : null,
      ),
      parsed.data.extraCharges ?? oldCharges.filter((c) => c.type === "extra"),
    );
    // CB-CHG — computeOrderTotals takes the table portion and the extras
    // portion SEPARATELY (the table charge keeps its shipped TABLE_CHARGE_MAX
    // ceiling; extras ride on top uncapped — decision 8).
    const { table: chargeForTab, extra: extraChargeForTab } = splitChargeTotals(charges);

    // CB-5B S4 — a reward claim on an add-round. Resolved against the OPEN
    // TAB's own customer (never a body customer: the tab's identity is
    // already fixed), against a billTotal priced from the FULL item set
    // WITHOUT the reward (the per-milestone minBill gate is about what the
    // customer is spending this round, not the reward's own dish).
    let resolvedClaim: Extract<RewardResolution, { ok: true }> | undefined;
    // CB-5D part 2 — captured ONCE, alongside resolvedClaim, and reused by the
    // single claimRewardStamps call below. Unlike the create route, an
    // add-round claims for an EXISTING, already-fixed orderId — there is no
    // renumber-retry here — but the assignment is still built from a single
    // `assignedAt` for the same reason: claimRewardStamps's $addToSet treats
    // the assignment as one whole element, so it must never be reconstructed
    // with a fresh Date at a second call site.
    let rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
    if (parsed.data.rewardAt !== undefined) {
      // A tab already carrying a reward must refuse a second one outright:
      // Order has ONE scalar + ONE kind, so a second claim would silently
      // overwrite the first snapshot while its stamps stayed spent.
      if (old.rewardAt !== undefined) {
        return failure("This tab already has a reward applied", 409);
      }
      const billTotal = computeOrderTotals({
        items: fullItems,
        discount,
        discountKind,
        charge: chargeForTab,
        extraCharge: extraChargeForTab,
        cfg: gstCfg,
      }).total;
      const resolved = await resolveRewardClaimAndLine(
        {
          settings,
          customerId: old.customerId ? String(old.customerId) : undefined,
          rewardAt: parsed.data.rewardAt,
          billTotal,
          // Order-taking writer (D9 permits an item reward here, same as create).
          refuseItemKind: false,
        },
        round,
      );
      if (!resolved.ok) return failure(resolved.message, 400);
      if (resolved.line) fullItems = [...fullItems, resolved.line];
      // A reward REPLACES the discountKind, same reasoning as the create route.
      discountKind = "reward";
      resolvedClaim = resolved.claim;
      // Same settings?.promoCodes source the QR accept path and the counter
      // create route resolve against — one place decides what a rung mints.
      rewardAssignment = buildRewardAssignment(resolved.claim.milestone, settings?.promoCodes, new Date());
    }

    // The reward this round must price against: a claim made RIGHT NOW, or the
    // one the tab is already carrying. Rebuilding the existing one from the
    // Order's own snapshot is load-bearing, not defensive: `discountKind`
    // carries forward as "reward" for a tab created with one, and
    // rewardDiscountAmount returns 0 for a MISSING reward (it fails closed).
    // So passing only a fresh claim here would silently re-price an existing
    // flat/percent reward to zero on every added round — the diner's stamps
    // would stay spent while the discount they bought quietly left the bill.
    // Rebuilt from the stored snapshot, never re-read from the live ladder,
    // so a rung the owner retunes mid-service cannot change an issued reward.
    const rewardForTotals = resolvedClaim?.reward ?? rewardFromOrderSnapshot(old);
    const totals = computeOrderTotals({
      items: fullItems,
      discount,
      discountKind,
      charge: chargeForTab,
      extraCharge: extraChargeForTab,
      cfg: gstCfg,
      reward: rewardForTotals,
    });
    // shouldStoreDiscountKind — the shared amount-gates-kind predicate, with
    // its one named exception: a "reward" kind stores even at ₹0 (an item
    // reward's derived amount is always 0; see reward-redemption.ts).
    const storeKind = shouldStoreDiscountKind(totals.discount, discountKind);

    // Guarded on still-open, the round we read, AND the void trail's length, so this
    // read-modify-write can't silently clobber a concurrent add (the loser 409s and
    // the client retries with its items intact) or append to a just-settled bill.
    // The trail term is NOT redundant: a void changes neither status nor kotRounds,
    // so without it a void committing inside this window is silently undone — the
    // `items` below re-appends the voided line from our stale read and re-bills it,
    // while voids[] still records it as voided (arbiter live-probe, CR1.3 review).
    // It mirrors the void route's own guard, so the two routes fence each other.
    const filter: FilterQuery<IOrder> = {
      _id: id,
      status: "Pending",
      payment: "Unpaid",
      kotRounds: old.kotRounds ?? 0,
      ...voidGuardFilter(old.voids?.length ?? 0),
    };
    // A waived charge is REMOVED, not stored as 0: the receipt keys its charge
    // line off the amount being present, so a 0 left beside the label would
    // print a named zero-rupee line on the customer's slip (same rule as the
    // settle route).
    // Every fired round is its own kitchen ticket, so every round draws its own
    // number. Written at kotNumbers[round - 1] so a REPRINT of round 2 shows the
    // ticket the kitchen is already holding rather than issuing a second number
    // for food that was ordered once. Allocated before the guarded write: if
    // that write loses its CAS race the number is spent, which costs a gap in
    // the series — strictly better than two rounds sharing one ticket number.
    const printCfg = printConfigOf(settings);
    const ticket = printCfg.kot.showNumber
      ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
      : undefined;
    // P4-A — this round's fire instant, stamped ONCE and reused for the whole
    // write so kotFiredAt[round-1] below and any other reader of "now" in this
    // request agree on the same millisecond.
    const firedAt = new Date();
    // Built POSITIONALLY, not appended. The slip is read back by index
    // (use-pos-print: kotNumbers[kotRounds - 1]), and a tab can carry a SHORT
    // array — every tab already open when numbering ships has none at all, and
    // any round fired while the toggle was off adds no entry. Appending would
    // then file this round's ticket under an earlier round's index: the slip
    // would print no number at all while the series still spent one, and the
    // stored array would claim a number for a round that was never numbered.
    // 0 is a safe "this round was never numbered" sentinel — printedSlipNumber
    // floors at PRINT_NUMBER_START_MIN (1), so 0 is not a printable number.
    const kotNumbers =
      ticket === undefined
        ? undefined
        : Array.from({ length: round }, (_, i) =>
            i === round - 1 ? ticket : (old.kotNumbers?.[i] ?? 0),
          );
    // P4-A — same positional idiom as kotNumbers immediately above: earlier
    // slots backfill from the tab's own prior stamp (or createdAt, for a round
    // fired before this field existed) so the Date array never carries holes,
    // and index round-1 gets THIS round's fire instant.
    const kotFiredAt = Array.from({ length: round }, (_, i) =>
      i === round - 1 ? firedAt : (old.kotFiredAt?.[i] ?? old.createdAt),
    );

    // CB-CHG — the ONE helper every charge writer uses (plan §4), so this
    // route can never hand-write the mirror or pick the wrong $set/$unset arm.
    const chargeFields = chargeWriteFields(charges);
    const update: Record<string, unknown> = {
      $set: {
        items: fullItems,
        subtotal: totals.subtotal,
        discount: totals.discount,
        gstAmount: totals.gstAmount,
        total: totals.total,
        kotRounds: round,
        kotFiredAt,
        ...(chargeFields.set ?? {}),
        // storeKind now covers "gst" AND "reward" (shouldStoreDiscountKind) —
        // the RESOLVED kind is stored, never the "gst" literal, so a reward
        // claim on this round writes discountKind:"reward" and its snapshot.
        ...(storeKind ? { discountKind } : {}),
        ...(kotNumbers ? { kotNumbers } : {}),
        ...(resolvedClaim ? rewardSnapshotFields(resolvedClaim.reward, resolvedClaim.cost) : {}),
      },
    };
    const unset: Record<string, ""> = { ...(chargeFields.unset ?? {}) };
    // A kind the operator cleared (null), or a preset that re-derives to ₹0,
    // must be REMOVED, not left beside a manual figure — the receipt labels
    // the line off this field. $unset on an absent field is a no-op, so
    // unconditionally unsetting when !storeKind is safe and keeps the $set/
    // $unset branches exclusive.
    if (!storeKind) unset.discountKind = "";
    if (Object.keys(unset).length > 0) update.$unset = unset;

    // CB-5B — claim BEFORE the CAS write, mirroring the create route: a
    // redeemed bill must never be written before its stamps are spent. Keyed
    // on the ORDER id (already fixed — this is an existing tab, not a new
    // one), so unlike create there is no orderId-minting subtlety here.
    if (resolvedClaim) {
      const claimed = await claimRewardStamps(String(old.customerId), old.orderId, resolvedClaim.cost, rewardAssignment);
      if (!claimed) return failure("Not enough stamps for that reward", 409);
    }
    const updated = await Order.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) {
      // A CAS MISS is the one DEFINITE no-write outcome this route has: the
      // filter matched nothing, so the round (and the reward on it) never
      // landed — the claimed stamps must go back before reporting the 409,
      // or a customer would lose stamps for a redemption that never happened.
      if (resolvedClaim) {
        await returnRewardStamps(String(old.customerId), old.orderId, resolvedClaim.cost, rewardAssignment);
      }
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // In-progress KPI value (Σ pending totals) grew — refresh today's summary.
    cache.del(orderSummaryCacheKey());
    return success(updated);
  } catch (error) {
    return serverError("Failed to add items", error);
  }
}
