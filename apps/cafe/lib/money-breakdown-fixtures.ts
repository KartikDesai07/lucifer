import { Types } from "mongoose";
import { computeOrderTotals, type GstConfig, type OrderTotalsInput } from "@/lib/receipt";
import type { DiscountKind } from "@/lib/constants";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import type { MoneyBreakdown } from "@/types";

// D10 S3 — fixture orders for money-breakdown.test.ts and
// scripts/verify-money-breakdown-live.ts. Every order's money fields
// (subtotal/discount/gstAmount/chargeAmount/total) are the REAL output of
// computeOrderTotals (lib/receipt.ts) — never hand-typed — so a fixture can
// never encode an impossible bill. `expected` is computed by HAND per case
// (one-line arithmetic comment each) and is what orderMoneyContribution /
// foldMoneyBreakdown must reproduce.

const INCLUSIVE_OFF: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };
const EXCLUSIVE_5: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
const EXCLUSIVE_18: GstConfig = { gstEnabled: true, gstRate: 18, gstMode: "exclusive" };
const INCLUSIVE_18: GstConfig = { gstEnabled: true, gstRate: 18, gstMode: "inclusive" };

const RECEIVER = "Fixture Verifier";

export interface MoneyFixtureItem {
  productId: Types.ObjectId;
  name: string;
  price: number;
  qty: number;
  modifiers: string[];
  instructions: string;
  kotRound: number;
  reward?: true;
  note?: string;
}

// The MoneyOrderView fields PLUS everything the real Order model requires to
// insertMany (models/Order.ts) — orderId is appended per-run by the live leg
// (randomUUID suffix), so it is deliberately absent here.
export interface MoneyFixtureOrder {
  label: string;
  customerName: string;
  items: MoneyFixtureItem[];
  subtotal: number;
  discount: number;
  discountKind?: DiscountKind;
  gstAmount: number;
  gstRate: number;
  gstMode: GstConfig["gstMode"];
  chargeAmount?: number;
  total: number;
  paidAmount: number;
  payment: "Cash";
  status: "Completed";
  receiver: string;
  expected: MoneyBreakdown;
}

function item(opts: {
  name: string;
  price: number;
  qty: number;
  reward?: true;
  note?: string;
}): MoneyFixtureItem {
  return {
    productId: new Types.ObjectId(),
    name: opts.name,
    price: opts.price,
    qty: opts.qty,
    modifiers: [],
    instructions: "",
    kotRound: 1,
    ...(opts.reward ? { reward: opts.reward as true } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
}

// Builds one fixture order by running the REAL computeOrderTotals and
// wiring its output onto the Order fields — the only hand-typed part is
// `expected`, computed and commented per case below.
function buildFixture(opts: {
  label: string;
  items: MoneyFixtureItem[];
  discount: number;
  discountKind: DiscountKind | undefined;
  charge: number;
  cfg: GstConfig;
  reward?: RedeemedReward;
  expected: MoneyBreakdown;
  discountKindOnOrder?: DiscountKind;
  rewardFields?: {
    rewardKind: RedeemedReward["kind"];
    rewardValue: number;
    rewardAt: number;
  };
}): MoneyFixtureOrder {
  const input: OrderTotalsInput = {
    items: opts.items.map((i) => ({ price: i.price, qty: i.qty, reward: i.reward })),
    discount: opts.discount,
    discountKind: opts.discountKind,
    charge: opts.charge,
    cfg: opts.cfg,
    reward: opts.reward,
  };
  const totals = computeOrderTotals(input);
  return {
    label: opts.label,
    customerName: `Fixture — ${opts.label}`,
    items: opts.items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    discountKind: opts.discountKindOnOrder ?? opts.discountKind,
    gstAmount: totals.gstAmount,
    gstRate: opts.cfg.gstRate,
    gstMode: opts.cfg.gstMode,
    ...(totals.charge > 0 ? { chargeAmount: totals.charge } : {}),
    total: totals.total,
    paidAmount: totals.total,
    payment: "Cash",
    status: "Completed",
    receiver: RECEIVER,
    expected: opts.expected,
    ...(opts.rewardFields
      ? {
          rewardAt: opts.rewardFields.rewardAt,
          rewardKind: opts.rewardFields.rewardKind,
          rewardValue: opts.rewardFields.rewardValue,
        }
      : {}),
  } as MoneyFixtureOrder;
}

// (1) manual discount 50 on lines totalling 500, GST inclusive (off), no
// charge. computeOrderTotals: subtotal 500, discount 50, gst 0, total 450.
// gross = subtotal + 0 reward lines = 500; discount = 50 (not reward kind);
// reward = 0; gst = 0; charges = 0.
const CASE_1_MANUAL_DISCOUNT = buildFixture({
  label: "manual discount 50 on 500, inclusive GST off",
  items: [item({ name: "Manual Discount Dish", price: 500, qty: 1 })],
  discount: 50,
  discountKind: undefined,
  charge: 0,
  cfg: INCLUSIVE_OFF,
  expected: { gross: 500, discount: 50, reward: 0, gst: 0, charges: 0 },
});

// (2) discountKind "gst" preset, GST exclusive 5% on 500 — gstEquivalentDiscount
// (lib/receipt.ts) derives the discount that keeps the exclusive-mode total
// pinned at (or one rupee under) the plain subtotal: MEASURED via
// computeOrderTotals (not hand-derived — the seed/candidate search in that
// function is nontrivial) = { subtotal: 500, discount: 24, gstAmount: 24,
// total: 500 }.
// gross = 500 + 0 reward lines = 500; discount = 24 (server-derived, kind
// "gst" is not "reward" so it counts as discount); reward = 0 (discountKind
// is "gst", not "reward"); gst = 24; charges = 0.
const CASE_2_GST_PRESET = buildFixture({
  label: "gst-preset discount, exclusive 5% on 500",
  items: [item({ name: "GST Preset Dish", price: 500, qty: 1 })],
  discount: 0,
  discountKind: "gst",
  charge: 0,
  cfg: EXCLUSIVE_5,
  expected: { gross: 500, discount: 24, reward: 0, gst: 24, charges: 0 },
});

// (3) flat reward 100 on subtotal 500 (GST off): rewardDiscountAmount
// returns 100; total = 500 - 100 = 400.
// gross = 500 + 0 reward lines = 500; discount = 0 (discountKind IS
// "reward"); reward = 0 reward lines + 100 (the flat discount) = 100.
const CASE_3_FLAT_REWARD = buildFixture({
  label: "flat reward 100 on subtotal 500",
  items: [item({ name: "Flat Reward Dish", price: 500, qty: 1 })],
  discount: 0,
  discountKind: "reward",
  charge: 0,
  cfg: INCLUSIVE_OFF,
  reward: { at: 5, kind: "flat", value: 100, item: "" },
  rewardFields: { rewardAt: 5, rewardKind: "flat", rewardValue: 100 },
  expected: { gross: 500, discount: 0, reward: 100, gst: 0, charges: 0 },
});

// (4) percent reward 10% on subtotal 800 (GST off): rewardDiscountAmount
// returns round(800*10/100) = 80; total = 800 - 80 = 720.
// gross = 800; discount = 0; reward = 0 reward lines + 80 = 80.
const CASE_4_PERCENT_REWARD = buildFixture({
  label: "percent reward 10% on subtotal 800",
  items: [item({ name: "Percent Reward Dish", price: 800, qty: 1 })],
  discount: 0,
  discountKind: "reward",
  charge: 0,
  cfg: INCLUSIVE_OFF,
  reward: { at: 10, kind: "percent", value: 10, item: "" },
  rewardFields: { rewardAt: 10, rewardKind: "percent", rewardValue: 10 },
  expected: { gross: 800, discount: 0, reward: 80, gst: 0, charges: 0 },
});

// (5) item reward: one paid line (220x1) + one reward line (180x1, reward:
// true). discountKind "reward", kind "item" (value 0 -> rewardDiscountAmount
// returns 0 for item rewards). subtotal skips the reward line = 220;
// exclusive 5% gst on 220 = round(220*0.05) = 11; charge 40 clamped;
// total = 220 + 11 + 40 = 271.
// gross = subtotal 220 + rewardLines(180*1=180) = 400; discount = 0
// (discountKind reward); reward = rewardLines 180 + (item kind -> 0 extra
// discount) = 180; gst = 11; charges = 40.
const CASE_5_ITEM_REWARD = buildFixture({
  label: "item reward: paid 220 + free reward line 180, exclusive 5% + charge 40",
  items: [
    item({ name: "Paid Dish", price: 220, qty: 1 }),
    item({ name: "Reward Dish", price: 180, qty: 1, reward: true, note: "Reward — free" }),
  ],
  discount: 0,
  discountKind: "reward",
  charge: 40,
  cfg: EXCLUSIVE_5,
  reward: { at: 15, kind: "item", value: 0, item: "Reward Dish" },
  rewardFields: { rewardAt: 15, rewardKind: "item", rewardValue: 0 },
  expected: { gross: 400, discount: 0, reward: 180, gst: 11, charges: 40 },
});

// (6) no discount, GST exclusive 18% on 1000, charge 25: gst =
// round(1000*0.18) = 180; total = 1000 + 180 + 25 = 1205.
// gross = 1000; discount = 0; reward = 0; gst = 180; charges = 25.
const CASE_6_EXCLUSIVE_CHARGE = buildFixture({
  label: "no discount, exclusive 18% on 1000, charge 25",
  items: [item({ name: "Exclusive Charge Dish", price: 1000, qty: 1 })],
  discount: 0,
  discountKind: undefined,
  charge: 25,
  cfg: EXCLUSIVE_18,
  expected: { gross: 1000, discount: 0, reward: 0, gst: 180, charges: 25 },
});

// (7) GST inclusive 18%, no discount, no charge: inclusive mode never adds
// gstAmount on top (it's baked into the price already) and no discountKind
// means no server-derived discount either — total = subtotal = 1000.
// gross = 1000; discount = 0; reward = 0; gst = 0; charges = 0.
const CASE_7_INCLUSIVE_NO_DISCOUNT = buildFixture({
  label: "inclusive 18%, no discount, no charge",
  items: [item({ name: "Inclusive Plain Dish", price: 1000, qty: 1 })],
  discount: 0,
  discountKind: undefined,
  charge: 0,
  cfg: INCLUSIVE_18,
  expected: { gross: 1000, discount: 0, reward: 0, gst: 0, charges: 0 },
});

// (8) legacy bare order: subtotal + total only, discount 0, no
// discountKind, gstAmount 0, no chargeAmount, no gstMode/gstRate — the
// shape a pre-D10, pre-GST-snapshot order actually has in the DB. Not
// built through computeOrderTotals (there is no legacy writer left to call
// it the old way) — hand-built to model the historical row shape exactly,
// with subtotal/total kept consistent by construction (300 = 300, no
// money movement at all).
// gross = subtotal 300 + 0 reward lines = 300; discount = 0 (order.discount
// ?? 0, no discountKind so not reward-suppressed); reward = 0; gst = 0
// (gstAmount ?? 0); charges = 0 (chargeAmount ?? 0).
const CASE_8_LEGACY_BARE: MoneyFixtureOrder = {
  label: "legacy bare order (pre-D10 shape): subtotal+total only",
  customerName: "Fixture — legacy bare order",
  items: [item({ name: "Legacy Dish", price: 300, qty: 1 })],
  subtotal: 300,
  discount: 0,
  gstAmount: 0,
  gstRate: 0,
  gstMode: "inclusive",
  total: 300,
  paidAmount: 300,
  payment: "Cash",
  status: "Completed",
  receiver: RECEIVER,
  expected: { gross: 300, discount: 0, reward: 0, gst: 0, charges: 0 },
};

// (9) MIXED (review A2): a gst-equivalent preset AND an item-reward line on one
// order (reachable: a later write may supply discountKind "gst" over a stored
// "reward"). MEASURED via computeOrderTotals: subtotal 400, discount 19, gst 19,
// total 400. gross = 400 + 180 = 580; discount 19 (kind gst); reward 180 (the
// free line alone); gst 19; charges 0. Identity: 580 - 19 - 180 + 19 = 400.
const CASE_9_MIXED_PRESET_AND_REWARD_LINE = buildFixture({
  label: "mixed: gst-equivalent preset discount + an item-reward line",
  items: [
    item({ name: "Mixed Paid Dish", price: 400, qty: 1 }),
    item({ name: "Mixed Free Dish", price: 180, qty: 1, reward: true, note: "Reward - free" }),
  ],
  discount: 0,
  discountKind: "gst",
  charge: 0,
  cfg: EXCLUSIVE_5,
  expected: { gross: 580, discount: 19, reward: 180, gst: 19, charges: 0 },
});

export const MONEY_FIXTURE_ORDERS: ReadonlyArray<MoneyFixtureOrder> = [
  CASE_1_MANUAL_DISCOUNT,
  CASE_2_GST_PRESET,
  CASE_3_FLAT_REWARD,
  CASE_4_PERCENT_REWARD,
  CASE_5_ITEM_REWARD,
  CASE_6_EXCLUSIVE_CHARGE,
  CASE_7_INCLUSIVE_NO_DISCOUNT,
  CASE_8_LEGACY_BARE,
  CASE_9_MIXED_PRESET_AND_REWARD_LINE,
];
