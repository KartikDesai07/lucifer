import { TABLE_CHARGE_MAX, type GstMode, type DiscountKind } from "@/lib/constants";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

// GST configuration as held in Settings — the only fields the calculations need.
export interface GstConfig {
  gstEnabled: boolean;
  gstRate: number; // percentage
  gstMode: GstMode; // "inclusive" | "exclusive"
}

// Client-side twin of `lib/settings.gstConfigOf` — same defaults, but accepts
// a possibly-still-loading (undefined) or partial Settings object, so client
// components can build a GstConfig straight from the TanStack Query hook
// without waiting on a fully-typed ISettings doc.
export function gstConfigOfSettings(
  settings: { gstEnabled?: boolean; gstRate?: number; gstMode?: GstMode } | undefined,
): GstConfig {
  return {
    gstEnabled: settings?.gstEnabled ?? false,
    gstRate: settings?.gstRate ?? 0,
    gstMode: settings?.gstMode ?? "inclusive",
  };
}

// POS-side: the GST to ADD on top of a (discounted) base when the cafe runs in
// exclusive mode. Inclusive mode adds nothing (tax is already in the price).
// Rounded to whole rupees to match the app's currency formatting.
export function computeExclusiveGst(base: number, cfg: GstConfig): number {
  if (!cfg.gstEnabled || cfg.gstMode !== "exclusive" || cfg.gstRate <= 0) {
    return 0;
  }
  return Math.round((base * cfg.gstRate) / 100);
}

const PERCENT = 100;

// The "GST Discount" preset (C1): the discount that makes the customer pay the
// pre-tax figure, while GST is still computed on the reduced base. Inclusive
// mode: the discount IS the GST component of the subtotal. Exclusive mode: the
// smallest integer discount whose re-taxed total is <= the pre-tax figure —
// never above it; a ±₹1 shortfall is unavoidable (S=1000 @18% has no integer
// discount that lands exactly on 1000). Deliberately re-uses the shipped
// `computeExclusiveGst` so this can never drift from the pipeline. Rounds the
// subtotal itself because `use-cart` does not and `computeOrderTotals` does.
export function gstEquivalentDiscount(subtotal: number, cfg: GstConfig): number {
  if (!cfg.gstEnabled || cfg.gstRate <= 0 || subtotal <= 0) return 0;
  const s = Math.max(0, Math.round(subtotal));
  const r = cfg.gstRate;
  if (cfg.gstMode === "inclusive") return s - Math.round(s / (1 + r / PERCENT));
  const seed = Math.round((s * r) / (PERCENT + r));
  const clamp = (d: number) => Math.min(Math.max(0, d), s);
  const candidates = [...new Set([clamp(seed - 1), clamp(seed), clamp(seed + 1)])].sort((a, b) => a - b);
  for (const d of candidates) {
    const base = s - d;
    if (base + computeExclusiveGst(base, cfg) <= s) return d;
  }
  return clamp(seed);
}

// Resolves the discount kind a re-pricing writer should use from what the client
// SENT and what the order STORES: `undefined` (key absent) = leave the stored
// kind alone, `null` = the operator cleared the preset (a manual discount now
// applies), "gst" = the preset. The explicit-null sentinel exists because
// `undefined` cannot clear a field over JSON (JSON.stringify drops the key).
export function resolveDiscountKind(
  supplied: DiscountKind | null | undefined,
  stored: DiscountKind | undefined,
): DiscountKind | undefined {
  if (supplied === undefined) return stored;
  // CB-5B — a stored "reward" is SERVER-OWNED and STICKY against a client
  // null. `null` means "the operator cleared the preset", which is a thing an
  // operator may do to a GST preset they applied; it is NOT a thing a client
  // may do to a redemption, because the diner's stamps are ALREADY SPENT and
  // no client request can un-spend them. Without this, a request carrying
  // `discountKind: null` plus a manual `discount` would swap a stamp-funded
  // reward for an arbitrary operator-chosen figure — the reward's money value
  // reinstated (or inflated) with no stamp check at all, while the order's own
  // reward snapshot still claimed the redemption. A reward is removed only by
  // cancelling the order (S6), which RETURNS the stamps as it goes.
  if (stored === "reward" && supplied === null) return stored;
  return supplied ?? undefined;
}

// ── Table charge ─────────────────────────────────────────────────────────────
// What a table is configured to add to a bill. ONE implementation, used by both
// sides: the POS reads it off the selected table to show the operator, and the
// order route re-reads it off the stored document to price the bill. If these
// two ever disagreed, the counter would show one figure and the customer would
// be charged another.

export interface TableChargeConfig {
  amount: number; // whole rupees; 0 = this table adds nothing
  label: string; // "" exactly when amount is 0
}

export const NO_TABLE_CHARGE: TableChargeConfig = { amount: 0, label: "" };

// A charge must be NAMED to be chargeable: an amount with no label would print
// as a bare rupee figure the customer cannot question, so an unnamed charge is
// treated as no charge at all rather than as a mystery line on the slip.
export function tableChargeOf(
  table: { chargeAmount?: number; chargeLabel?: string } | null | undefined,
): TableChargeConfig {
  const amount = Math.max(0, Math.round(table?.chargeAmount ?? 0));
  const label = (table?.chargeLabel ?? "").trim();
  if (amount <= 0 || !label) return NO_TABLE_CHARGE;
  return { amount, label };
}

// The authoritative bill math, derived from the item lines + the cafe's GST
// config. Used server-side so the persisted order can never disagree with its
// own items (and the same formula the POS shows). Discount is clamped to the
// subtotal; everything is whole rupees.
export interface OrderTotals {
  subtotal: number;
  discount: number;
  gstAmount: number;
  charge: number; // the table's extra charge, after clamping
  total: number;
}

export interface OrderTotalsInput {
  // `reward` marks a line given as a loyalty reward: priced, but worth 0 on the
  // bill (see the reducer below). Optional so every existing caller compiles
  // unchanged — an ordinary sold line simply omits it.
  items: ReadonlyArray<{ price: number; qty: number; reward?: boolean }>;
  discount: number;
  // Required-and-nullable, same reason as `charge` below: every re-pricing
  // writer has to state out loud whether the discount is the GST preset (then
  // `discount` is IGNORED and re-derived here) or a manual figure.
  discountKind: DiscountKind | undefined;
  // The table's extra charge, in rupees. REQUIRED, and an options object rather
  // than a fourth positional argument, both for the same reason: every writer
  // that re-prices a bill (create, add-a-round, settle) has to state out loud
  // what happens to the charge. Defaulting it to 0 would let a writer that
  // never heard of charges silently wipe one off a tab mid-service — the
  // reciprocal-guard failure CR1.3 hit when only one writer of a document knew
  // about a new field. Here the type checker is the guard.
  charge: number;
  // CB-CHG — the STAFF-ENTERED extra charges' total (takeaway box, delivery,
  // whatever the operator typed), in rupees. Kept SEPARATE from `charge` above
  // rather than summed into it, because the two obey different rules:
  // `charge` is an admin config bounded by TABLE_CHARGE_MAX (it rides onto
  // every bill of that table until changed, so a fat-fingered entry is
  // expensive), while this one is a per-bill operator decision the owner
  // explicitly chose to leave UNBOUNDED (decision 8, 2026-09-25). Summing them
  // into the clamped parameter would cap a legitimate bill AND leave the
  // stored `total` disagreeing with the stored `charges[]`/`chargeAmount`,
  // which chargeMirror does not clamp — the customer billed one figure while
  // the record says another.
  // OPTIONAL and defaulting to 0, unlike `charge`: an order with no extras is
  // the overwhelming majority, and the omission fails SAFE (no charge added)
  // rather than silently wiping a table charge, which is why `charge` is
  // required and this is not. Use splitChargeTotals() to fill both.
  extraCharge?: number;
  cfg: GstConfig;
  // CB-5B — the milestone a diner claimed, when `discountKind === "reward"`.
  // OPTIONAL, deliberately, where `discountKind`/`charge` above are required:
  // a reward can only ever ride on the handful of writers that resolve one, and
  // making it required would force ~20 call sites that can never carry a reward
  // to type `reward: undefined`. The cost is real — the type checker is NOT the
  // guard here, unlike `charge` — so the guard is that the omission fails
  // CLOSED: `rewardDiscountAmount` returns 0 for a missing reward, so a writer
  // that forgets it charges the customer FULL price (a visible, correctable
  // mistake) instead of granting an unfunded discount (money quietly lost).
  // Pinned both ways in gst-discount.test.ts.
  reward?: RedeemedReward;
}

// CB-5B — the money a claimed milestone is worth on THIS subtotal. The reward
// twin of `gstEquivalentDiscount` above, and the reason `discountKind` is an
// enum rather than a free label: for BOTH presets the server re-derives the
// amount and the client's number is ignored.
//
// `item` rewards derive 0 DELIBERATELY, and this branch IS reached on every
// item reward in production (D5 was REVERSED 2026-09-13: `kind:"item"` is now
// a normal, redeemable rung — REWARD_REDEEMABLE_KINDS includes it). Returning
// 0 is the DESIGNED answer, not a fallback for an unreachable case: the free
// dish is given as its own line on the bill at full price (S12's
// priced-but-untotalled `OrderItem.reward` line), not as rupees off the
// total, so this function's job for an item reward is to contribute NOTHING
// to the discount — the money benefit lives entirely in the subtotal reducer
// skipping that one line, not here.
export function rewardDiscountAmount(
  subtotal: number,
  reward: RedeemedReward | undefined,
): number {
  if (!reward || subtotal <= 0) return 0;
  const s = Math.max(0, Math.round(subtotal));
  if (reward.kind === "percent") {
    const pct = Math.min(Math.max(0, reward.value), PERCENT);
    return Math.round((s * pct) / PERCENT);
  }
  if (reward.kind === "flat") return Math.max(0, Math.round(reward.value));
  return 0;
}

export function computeOrderTotals({
  items,
  discount,
  discountKind,
  charge,
  extraCharge = 0,
  cfg,
  reward,
}: OrderTotalsInput): OrderTotals {
  // A reward line carries its dish's REAL price (so the bill shows the customer
  // what they got and what it was worth) but contributes NOTHING to the money.
  // This one skip is the whole mechanism: `base` below is derived from this
  // subtotal and the GST from that base, so "not totalled" and "not taxed" both
  // follow from here — there is no second place for the two to drift apart.
  const subtotal = Math.round(
    items.reduce((sum, i) => sum + (i.reward ? 0 : i.price * i.qty), 0),
  );
  // Both presets are SERVER-DERIVED; only a manual discount uses the supplied
  // figure. A new kind added to DISCOUNT_KINDS without a branch here would fall
  // through to `discount` and silently trust the client's number — which is why
  // a source pin asserts every kind is named above the fallback.
  const rawDiscount =
    discountKind === "gst"
      ? gstEquivalentDiscount(subtotal, cfg)
      : discountKind === "reward"
        ? rewardDiscountAmount(subtotal, reward)
        : discount;
  const clampedDiscount = Math.min(Math.max(0, Math.round(rawDiscount)), subtotal);
  const base = subtotal - clampedDiscount;
  const gstAmount = computeExclusiveGst(base, cfg);
  // The charge rides on TOP of the taxed bill and is not part of the taxable
  // base (owner decision, 2026-08-16) — which is why GST is computed above it,
  // not after. It is also outside the discount: a percentage off the food does
  // not quietly become a percentage off the cover charge.
  // The TABLE charge keeps its shipped ceiling (an admin config that rides onto
  // every bill of that table). The staff-entered extras ride on top UNCAPPED —
  // owner decision 8, 2026-09-25: "hame hamari panel me aesi koi limitation
  // nahi rakhni hai". Summing them before the clamp would cap a legitimate
  // bill and leave `total` disagreeing with the stored charges[]/chargeAmount,
  // which chargeMirror does not clamp.
  const clampedCharge = Math.min(Math.max(0, Math.round(charge)), TABLE_CHARGE_MAX);
  const clampedExtra = Math.max(0, Math.round(extraCharge));
  const totalCharge = clampedCharge + clampedExtra;
  return {
    subtotal,
    discount: clampedDiscount,
    gstAmount,
    charge: totalCharge,
    total: base + gstAmount + totalCharge,
  };
}

// Rebuild the GstConfig that was in effect when an order was created, from the
// rate/mode snapshotted on the order — so recomputing money while adding items
// to an open tab uses the tab's original tax, not whatever the cafe set later.
// Pre-snapshot legacy orders (gstMode == null) fall back to the live config;
// those are always already-Completed historical orders, never open tabs (POST
// writes a snapshot on every order).
export function gstConfigFromOrder(
  order: { gstRate?: number; gstMode?: GstMode },
  liveFallback: GstConfig,
): GstConfig {
  if (order.gstMode == null) return liveFallback;
  return {
    gstEnabled: (order.gstRate ?? 0) > 0,
    gstRate: order.gstRate ?? 0,
    gstMode: order.gstMode,
  };
}

// Receipt-side: the GST breakdown to display for a placed order.
export interface GstBreakdown {
  show: boolean;
  inclusive: boolean; // tax already in the total (vs added on top)
  taxable: number; // value before GST
  gstAmount: number; // GST portion
  rate: number;
}

export function receiptGst(
  order: {
    total: number;
    gstAmount?: number;
    gstRate?: number;
    gstMode?: GstMode;
    // The table charge folded into `total`. It is NOT taxed, so both branches
    // below have to lift it back out before they reason about tax: exclusive
    // mode would otherwise report it as taxable value, and inclusive mode would
    // back-calculate GST out of money that never carried any — inventing tax on
    // a cover charge and under-reporting the food's own.
    chargeAmount?: number;
  },
  cfg: GstConfig,
): GstBreakdown {
  // Prefer the GST config snapshotted on the order (the tax actually charged at
  // sale time) so old receipts stay correct after the cafe changes its rate or
  // mode. Orders placed before snapshots existed fall back to current settings.
  const eff: GstConfig =
    order.gstMode != null
      ? {
          gstEnabled: (order.gstRate ?? 0) > 0,
          gstRate: order.gstRate ?? 0,
          gstMode: order.gstMode,
        }
      : cfg;

  const base = { show: false, inclusive: true, taxable: 0, gstAmount: 0, rate: eff.gstRate };
  if (!eff.gstEnabled || eff.gstRate <= 0) return base;

  // The billed total minus the untaxed table charge — i.e. the part of what the
  // customer pays that tax has anything to do with.
  const taxedTotal = order.total - (order.chargeAmount ?? 0);

  if (eff.gstMode === "exclusive") {
    // Only orders that actually had GST added carry a gstAmount; older orders
    // (placed before GST was enabled) show no tax line.
    const gst = order.gstAmount ?? 0;
    if (gst <= 0) return base;
    return {
      show: true,
      inclusive: false,
      taxable: taxedTotal - gst,
      gstAmount: gst,
      rate: eff.gstRate,
    };
  }

  // Inclusive: back-calculate the GST component out of the taxed portion.
  const taxable = Math.round(taxedTotal / (1 + eff.gstRate / 100));
  return {
    show: true,
    inclusive: true,
    taxable,
    gstAmount: taxedTotal - taxable,
    rate: eff.gstRate,
  };
}
