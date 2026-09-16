/**
 * CB-5B S16 — reward-order invariants for verifySeed, split out of
 * finalize.ts (that file's own ~300-line budget) the same way
 * finalize-census.ts already is. Pure: takes one already-fetched Order
 * document (lean) plus the GST config verifySeed itself received, returns
 * verdict lines in the SAME {pass, message} shape finalize.ts's own `check`
 * pushes — the caller folds them into its own `lines` array.
 *
 * The hard constraint this seed plants ONLY item rewards
 * (orders-plan-assemble.ts's REWARD_ORDER_CHANCE comment): an item reward's
 * discount recomputes to 0 either way (the free dish's value lives in the
 * untotalled line, never in `discount`), so the ordinary total-recompute
 * check in finalize.ts never fires for one — a flat/percent reward order
 * would fail THAT check instead, so this seed never plants one.
 */
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import type { DiscountKind } from "@/lib/constants";
import { Customer } from "@/models/Customer";

// The stored shape of the one Settings path the reward checks read. Every
// field is optional ON PURPOSE: these checks exist to catch the case where
// Mongoose's `strict: true` dropped one, so a type that guaranteed presence
// would defeat their whole purpose.
interface StoredLoyaltyRules {
  milestones?: ReadonlyArray<{ at?: number; kind?: string; item?: string; itemProductId?: string; qty?: number }>;
}

export interface RewardCheckLine {
  pass: boolean;
  message: string;
}

// Structurally what finalize.ts's `dbOrders` lean documents look like — kept
// minimal (only the fields these checks read) so this module never needs to
// import the Order model/types directly.
export interface RewardCheckableOrder {
  orderId: string;
  items: ReadonlyArray<{ productId: unknown; price: number; qty: number; reward?: boolean; note?: string }>;
  discount: number;
  discountKind?: DiscountKind;
  chargeAmount?: number;
  total: number;
  gstRate?: number;
  gstMode?: GstConfig["gstMode"];
  rewardAt?: number;
  rewardKind?: string;
  rewardValue?: number;
  rewardItem?: string;
  rewardItemProductId?: string;
  rewardQty?: number;
  rewardStamps?: number;
}

/** One order's reward invariants. Returns `isRewardOrder` too, so the caller
 *  can tally a plan-wide "at least one reward order" count without
 *  re-deriving the same `discountKind === "reward"` test. */
export function rewardChecksOf(order: RewardCheckableOrder, gst: GstConfig): { isRewardOrder: boolean; lines: RewardCheckLine[] } {
  const lines: RewardCheckLine[] = [];
  const rewardLines = order.items.filter((item) => item.reward === true);
  const isRewardOrder = order.discountKind === "reward";

  if (!isRewardOrder) {
    if (rewardLines.length > 0) {
      lines.push({ pass: false, message: `order ${order.orderId}: carries a reward item line but discountKind is not "reward"` });
    }
    return { isRewardOrder, lines };
  }

  const hasAllSnapshotFields =
    order.rewardAt !== undefined &&
    order.rewardKind !== undefined &&
    order.rewardValue !== undefined &&
    order.rewardItem !== undefined &&
    order.rewardItemProductId !== undefined &&
    order.rewardQty !== undefined &&
    order.rewardStamps !== undefined;
  lines.push({ pass: hasAllSnapshotFields, message: `order ${order.orderId}: discountKind "reward" must carry all 7 reward snapshot fields` });

  lines.push({
    pass: rewardLines.length === 1 && !!rewardLines[0]?.note,
    message: `order ${order.orderId}: a reward order must carry exactly one items[].reward===true line with a note (found ${rewardLines.length})`,
  });

  // The stored total must EXCLUDE the reward line's own price — recomputed
  // over the SAME items with that one line dropped, discount/charge/gst
  // otherwise unchanged, so the only variable is whether the free dish's
  // price entered the subtotal at all.
  const withoutRewardLine = order.items.filter((item) => !item.reward);
  const totalWithoutReward = computeOrderTotals({
    items: withoutRewardLine,
    discount: order.discount,
    discountKind: order.discountKind,
    charge: order.chargeAmount ?? 0,
    cfg: { gstEnabled: (order.gstRate ?? 0) > 0, gstRate: order.gstRate ?? 0, gstMode: order.gstMode ?? gst.gstMode },
  });
  lines.push({
    pass: totalWithoutReward.total === order.total,
    message: `order ${order.orderId}: stored total ${order.total} must equal the bill recomputed WITHOUT the reward line (${totalWithoutReward.total})`,
  });

  return { isRewardOrder, lines };
}


/**
 * CB-5B S16 — the SETTINGS + CUSTOMER half of the reward invariants, read
 * back from the DB. `rewardChecksOf` above proves each reward ORDER; this
 * proves the loyalty data those orders were claimed against actually landed.
 *
 * WHY IT EXISTS (reviewer-found gap): `seedLoyaltyRules` returns its rung from
 * in-memory constants and never re-reads what was stored, so a Mongoose
 * `strict: true` drop on any `loyaltyRules` path — the exact failure mode the
 * sibling live legs were written for — would leave every planted reward order
 * referencing a rung absent from Settings, with the seed reporting success.
 * Every check here therefore reads the STORED document, never the planner's
 * own values.
 */
export async function rewardSettingsChecksOf(
  // Only the one path these checks read, not the whole model: verifySeed hands
  // us a LEAN document, whose Mongoose type (`FlattenMaps<ISettings> & …`) is
  // not assignable to `ISettings`. Narrowing here keeps the caller free of a
  // cast, and the field is read defensively below in any case — the point of
  // these checks is that it may legitimately be MISSING.
  settings: { loyaltyRules?: StoredLoyaltyRules } | null,
  orders: ReadonlyArray<RewardCheckableOrder & { customerId?: unknown }>,
): Promise<RewardCheckLine[]> {
  const lines: RewardCheckLine[] = [];
  const rewardOrders = orders.filter((o) => o.discountKind === "reward");

  const milestones = settings?.loyaltyRules?.milestones ?? [];
  lines.push({
    pass: milestones.length > 0,
    message: `Settings.loyaltyRules stores a milestone ladder (${milestones.length} rungs) — a strict-schema drop would read as 0 here`,
  });

  const itemRungs = milestones.filter((m) => m.kind === "item");
  lines.push({
    pass: itemRungs.length >= 1,
    message: `Settings.loyaltyRules stores at least one kind:"item" rung (${itemRungs.length}) — the rung every seeded reward order claims`,
  });
  // The dish reference is the field D8 added and session 33 saw silently
  // dropped, so it is asserted on the STORED rung specifically.
  lines.push({
    pass: itemRungs.every((m) => typeof m.itemProductId === "string" && m.itemProductId.length > 0 && typeof m.qty === "number"),
    message: `every stored item rung carries itemProductId + qty (the D8 fields strict:true drops silently)`,
  });

  // THE JOIN: every reward order's rewardAt must name a rung that really
  // exists in the stored ladder. This is the check that catches a ladder the
  // planner believed in but the DB never received.
  const storedAts = new Set(milestones.map((m) => m.at));
  const orphaned = rewardOrders.filter((o) => !storedAts.has(o.rewardAt));
  lines.push({
    pass: orphaned.length === 0,
    message: `every reward order's rewardAt names a rung that EXISTS in stored Settings (${orphaned.length} orphaned)`,
  });

  // The claim side: each reward order's customer must carry the spend in
  // `redeemedOrders`. `select: false` on that path means it must be asked for
  // explicitly — a check that forgot to would read undefined and pass emptily,
  // so the projection is named here.
  let missingClaims = 0;
  let stampsUnset = 0;
  for (const order of rewardOrders) {
    if (!order.customerId) continue;
    const customer = await Customer.findById(order.customerId).select("+redeemedOrders stamps").lean();
    if (!customer?.redeemedOrders?.includes(order.orderId)) missingClaims += 1;
    if (typeof customer?.stamps !== "number") stampsUnset += 1;
  }
  lines.push({
    pass: missingClaims === 0,
    message: `every reward order is recorded in its customer's redeemedOrders (${missingClaims} missing)`,
  });
  lines.push({
    pass: stampsUnset === 0,
    message: `every reward order's customer carries a numeric stamps balance (${stampsUnset} unset)`,
  });

  // Non-vacuity: at least one customer anywhere holds stamps, so a seed that
  // silently stopped writing them cannot pass by having nothing to check.
  const stampedCustomers = await Customer.countDocuments({ stamps: { $gt: 0 } });
  lines.push({
    pass: stampedCustomers > 0,
    message: `at least one customer holds a stamp balance (${stampedCustomers}) — the loyalty screens have data to show`,
  });

  // The demo must be DEMONSTRABLE: at least one customer can actually afford
  // the cheapest rung right now. Reviewer-found (S16) — the first cut capped
  // every balance below the rung's cost, so `decideRedemption` answered
  // "insufficient-stamps" for all 40 customers and the owner could not ring up
  // a reward at all. A ladder nobody can reach is a broken demo, not a seed.
  const cheapestAt = milestones.reduce<number | undefined>(
    (min, m) => (typeof m.at === "number" && (min === undefined || m.at < min) ? m.at : min),
    undefined,
  );
  if (cheapestAt !== undefined) {
    const redeemReady = await Customer.countDocuments({ stamps: { $gte: cheapestAt } });
    lines.push({
      pass: redeemReady > 0,
      message: `at least one customer can afford the cheapest rung (${cheapestAt} stamps): ${redeemReady} redeem-ready — a demo nobody can claim in is a broken demo`,
    });
  }

  return lines;
}
